import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TradeRequest } from '@/types'
import { initializePool, calculateSharesForAmount, calculateBuyCost, calculateSellProceeds, getPrices, initializeTriPool, calculateTriSharesForAmount, calculateTriSellProceeds, getTriPrices, TriOutcome, TriPoolState } from '@/lib/cpmm'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { calculateTradeFee, FEES } from '@/lib/fees'
import { sendTradeConfirmation } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Rate limit: 30 trades per minute per user
    const rl = checkRateLimit(`trade:${session.user.id}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many trades. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
      )
    }

    const trade: TradeRequest = await request.json()
    const { marketId, outcome, side, type, price } = trade
    const amount = Number(trade.amount)

    // Validate trade request
    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
    }
    if (!['YES', 'NO', 'HOME', 'DRAW', 'AWAY'].includes(outcome)) {
      return NextResponse.json({ error: 'Outcome must be YES, NO, HOME, DRAW, or AWAY' }, { status: 400 })
    }
    if (!['BUY', 'SELL'].includes(side)) {
      return NextResponse.json({ error: 'Side must be BUY or SELL' }, { status: 400 })
    }
    if (!['MARKET', 'LIMIT'].includes(type)) {
      return NextResponse.json({ error: 'Type must be MARKET or LIMIT' }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return NextResponse.json({ error: 'Amount must be between K0.01 and K1,000,000' }, { status: 400 })
    }
    if (amount < 0.01) {
      return NextResponse.json({ error: 'Minimum trade amount is K0.01' }, { status: 400 })
    }

    // Get user with fresh balance
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get market
    const market = await prisma.market.findUnique({
      where: { id: marketId }
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    if (market.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Market is not active for trading' }, { status: 400 })
    }

    // Block trading if the market's resolve time has already passed
    if (new Date(market.resolveTime) <= new Date()) {
      return NextResponse.json({ error: 'This market has passed its resolve time and is no longer tradable' }, { status: 400 })
    }

    // Block trading if the linked game is already finished
    const linkedGame = await prisma.scheduledGame.findFirst({
      where: { marketId, status: 'FINISHED' },
      select: { id: true },
    })
    if (linkedGame) {
      return NextResponse.json({ error: 'The linked match has ended. Trading is closed.' }, { status: 400 })
    }

    // Determine market type and validate outcome
    const isTri = market.marketType === 'TRI_OUTCOME'
    if (isTri && !['HOME', 'DRAW', 'AWAY'].includes(outcome)) {
      return NextResponse.json({ error: 'This is a 3-outcome market. Outcome must be HOME, DRAW, or AWAY' }, { status: 400 })
    }
    if (!isTri && !['YES', 'NO'].includes(outcome)) {
      return NextResponse.json({ error: 'This is a binary market. Outcome must be YES or NO' }, { status: 400 })
    }

    if (side === 'BUY') {
      const grossAmount = amount
      const fee = calculateTradeFee(grossAmount)
      const kwachaToSpend = fee.netAmount

      if (user.balance < grossAmount) {
        return NextResponse.json(
          { error: `Insufficient balance. You have ${user.balance.toFixed(2)} but need ${grossAmount.toFixed(2)}` },
          { status: 400 }
        )
      }

      // Calculate shares via appropriate CPMM engine
      let shares: number, newPool: any, avgPrice: number, newPriceData: any

      if (isTri) {
        // 3-outcome CPMM
        let triPool: TriPoolState
        if (market.poolHomeShares != null && market.poolDrawShares != null && market.poolAwayShares != null && market.poolTriK != null) {
          triPool = { homeShares: market.poolHomeShares, drawShares: market.poolDrawShares, awayShares: market.poolAwayShares, k: market.poolTriK }
        } else {
          triPool = initializeTriPool(market.liquidity || 10000)
        }
        const result = calculateTriSharesForAmount(triPool, outcome as TriOutcome, kwachaToSpend)
        shares = result.shares; newPool = result.newPool; avgPrice = result.avgPrice
        newPriceData = getTriPrices(result.newPool)
      } else {
        // Binary CPMM
        let pool
        if (market.poolYesShares != null && market.poolNoShares != null && market.poolK != null) {
          pool = { yesShares: market.poolYesShares, noShares: market.poolNoShares, k: market.poolK }
        } else {
          pool = initializePool(market.liquidity || 1000, market.yesPrice)
        }
        const result = calculateSharesForAmount(pool, outcome as 'YES' | 'NO', kwachaToSpend)
        shares = result.shares; newPool = result.newPool; avgPrice = result.avgPrice
        newPriceData = getPrices(result.newPool)
      }

      if (shares <= 0) {
        return NextResponse.json({ error: 'Trade amount too small' }, { status: 400 })
      }

      const result = await prisma.$transaction(async (tx) => {
        const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
        if (!freshUser || freshUser.balance < grossAmount || (freshUser.balance - grossAmount) < -0.001) {
          throw new Error('Insufficient balance')
        }

        const updatedUser = await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { decrement: grossAmount } }
        })

        const order = await tx.order.create({
          data: {
            type, side: 'BUY', outcome, price: avgPrice,
            amount: shares, filled: shares, remaining: 0, status: 'FILLED',
            userId: session.user.id, marketId
          }
        })

        await tx.transaction.create({
          data: {
            type: 'TRADE', amount: -grossAmount, feeAmount: fee.feeAmount,
            description: `Bought ${shares.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(avgPrice * 100).toFixed(1)}% (fee: K${fee.feeAmount.toFixed(2)})`,
            status: 'COMPLETED', userId: session.user.id,
            metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares, avgPrice, spent: grossAmount, fee: fee.feeAmount, netSpent: kwachaToSpend })
          }
        })

        if (fee.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              feeType: 'TRADE_FEE', amount: fee.feeAmount,
              description: `Trade fee on BUY ${outcome} in "${market.title}"`,
              sourceType: 'TRADE', sourceId: order.id, userId: session.user.id,
            }
          })
        }

        const existingPosition = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
        })

        if (existingPosition) {
          const newSize = existingPosition.size + shares
          const newAvgPrice = ((existingPosition.averagePrice * existingPosition.size) + (avgPrice * shares)) / newSize
          await tx.position.update({
            where: { id: existingPosition.id },
            data: { size: newSize, averagePrice: newAvgPrice, isClosed: false }
          })
        } else {
          await tx.position.create({
            data: { userId: session.user.id, marketId, outcome, size: shares, averagePrice: avgPrice }
          })
        }

        // Update market prices and pool state
        const marketUpdateData: any = {
          volume: { increment: grossAmount },
        }

        if (isTri) {
          const tp = newPriceData as { homePrice: number; drawPrice: number; awayPrice: number }
          marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, tp.homePrice))
          marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, tp.awayPrice))
          marketUpdateData.drawPrice = Math.max(0.01, Math.min(0.99, tp.drawPrice))
          marketUpdateData.liquidity = newPool.homeShares + newPool.drawShares + newPool.awayShares
          marketUpdateData.poolHomeShares = newPool.homeShares
          marketUpdateData.poolDrawShares = newPool.drawShares
          marketUpdateData.poolAwayShares = newPool.awayShares
          marketUpdateData.poolTriK = newPool.k
        } else {
          marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, newPriceData.yesPrice))
          marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, newPriceData.noPrice))
          marketUpdateData.liquidity = newPool.yesShares + newPool.noShares
          marketUpdateData.poolYesShares = newPool.yesShares
          marketUpdateData.poolNoShares = newPool.noShares
          marketUpdateData.poolK = newPool.k
        }

        const updatedMarket = await tx.market.update({
          where: { id: marketId },
          data: marketUpdateData,
        })

        return { updatedUser, order, updatedMarket, shares, avgPrice, newPriceData }
      })

      if (user.email) {
        sendTradeConfirmation(user.email, {
          side: 'BUY', outcome, amount: grossAmount, shares: result.shares, market: market.title,
        }).catch(() => {})
      }

      const responseData: any = {
        success: true, order: result.order,
        newBalance: result.updatedUser.balance,
        newVolume: result.updatedMarket.volume,
        newLiquidity: result.updatedMarket.liquidity,
        shares: result.shares, avgPrice: result.avgPrice,
        spent: grossAmount, fee: fee.feeAmount, feeRate: FEES.TRADE_FEE_RATE,
      }
      if (isTri) {
        responseData.newHomePrice = result.newPriceData.homePrice
        responseData.newDrawPrice = result.newPriceData.drawPrice
        responseData.newAwayPrice = result.newPriceData.awayPrice
      } else {
        responseData.newYesPrice = result.newPriceData.yesPrice
        responseData.newNoPrice = result.newPriceData.noPrice
      }
      return NextResponse.json(responseData)

    } else {
      // SELL
      const sharesToSell = amount

      const positionPreCheck = await prisma.position.findUnique({
        where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
      })

      if (!positionPreCheck || positionPreCheck.size < sharesToSell) {
        return NextResponse.json(
          { error: `Insufficient shares. You have ${positionPreCheck?.size.toFixed(2) || '0'} but want to sell ${sharesToSell.toFixed(2)}` },
          { status: 400 }
        )
      }

      let grossProceeds: number, sellPool: any, sellAvgPrice: number, newPriceData: any

      if (isTri) {
        let triPool: TriPoolState
        if (market.poolHomeShares != null && market.poolDrawShares != null && market.poolAwayShares != null && market.poolTriK != null) {
          triPool = { homeShares: market.poolHomeShares, drawShares: market.poolDrawShares, awayShares: market.poolAwayShares, k: market.poolTriK }
        } else {
          triPool = initializeTriPool(market.liquidity || 10000)
        }
        const result = calculateTriSellProceeds(triPool, outcome as TriOutcome, sharesToSell)
        grossProceeds = result.proceeds; sellPool = result.newPool; sellAvgPrice = result.avgPrice
        newPriceData = getTriPrices(result.newPool)
      } else {
        let pool
        if (market.poolYesShares != null && market.poolNoShares != null && market.poolK != null) {
          pool = { yesShares: market.poolYesShares, noShares: market.poolNoShares, k: market.poolK }
        } else {
          pool = initializePool(market.liquidity || 1000, market.yesPrice)
        }
        const result = calculateSellProceeds(pool, outcome as 'YES' | 'NO', sharesToSell)
        grossProceeds = result.proceeds; sellPool = result.newPool; sellAvgPrice = result.avgPrice
        newPriceData = getPrices(result.newPool)
      }

      if (grossProceeds <= 0) {
        return NextResponse.json({ error: 'Sell amount too small' }, { status: 400 })
      }

      const sellFee = calculateTradeFee(grossProceeds)
      const netProceeds = sellFee.netAmount

      const result = await prisma.$transaction(async (tx) => {
        const position = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
        })

        if (!position || position.size < sharesToSell) {
          throw new Error(`Insufficient shares. You have ${position?.size.toFixed(2) || '0'} but want to sell ${sharesToSell.toFixed(2)}`)
        }

        const updatedUser = await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { increment: netProceeds } }
        })

        const order = await tx.order.create({
          data: {
            type, side: 'SELL', outcome, price: sellAvgPrice,
            amount: sharesToSell, filled: sharesToSell, remaining: 0, status: 'FILLED',
            userId: session.user.id, marketId
          }
        })

        await tx.transaction.create({
          data: {
            type: 'TRADE', amount: netProceeds, feeAmount: sellFee.feeAmount,
            description: `Sold ${sharesToSell.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(sellAvgPrice * 100).toFixed(1)}% (fee: K${sellFee.feeAmount.toFixed(2)})`,
            status: 'COMPLETED', userId: session.user.id,
            metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares: sharesToSell, price: sellAvgPrice, grossProceeds, fee: sellFee.feeAmount, netProceeds })
          }
        })

        if (sellFee.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              feeType: 'TRADE_FEE', amount: sellFee.feeAmount,
              description: `Trade fee on SELL ${outcome} in "${market.title}"`,
              sourceType: 'TRADE', sourceId: order.id, userId: session.user.id,
            }
          })
        }

        const newSize = position.size - sharesToSell
        await tx.position.update({
          where: { id: position.id },
          data: { size: Math.max(0, newSize), isClosed: newSize <= 0 }
        })

        const marketUpdateData: any = {
          volume: { increment: grossProceeds },
        }

        if (isTri) {
          const tp = newPriceData as { homePrice: number; drawPrice: number; awayPrice: number }
          marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, tp.homePrice))
          marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, tp.awayPrice))
          marketUpdateData.drawPrice = Math.max(0.01, Math.min(0.99, tp.drawPrice))
          marketUpdateData.liquidity = sellPool.homeShares + sellPool.drawShares + sellPool.awayShares
          marketUpdateData.poolHomeShares = sellPool.homeShares
          marketUpdateData.poolDrawShares = sellPool.drawShares
          marketUpdateData.poolAwayShares = sellPool.awayShares
          marketUpdateData.poolTriK = sellPool.k
        } else {
          marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, newPriceData.yesPrice))
          marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, newPriceData.noPrice))
          marketUpdateData.liquidity = sellPool.yesShares + sellPool.noShares
          marketUpdateData.poolYesShares = sellPool.yesShares
          marketUpdateData.poolNoShares = sellPool.noShares
          marketUpdateData.poolK = sellPool.k
        }

        const updatedMarket = await tx.market.update({
          where: { id: marketId },
          data: marketUpdateData,
        })

        return { updatedUser, order, updatedMarket, newPriceData }
      })

      if (user.email) {
        sendTradeConfirmation(user.email, {
          side: 'SELL', outcome, amount: grossProceeds, shares: sharesToSell, market: market.title,
        }).catch(() => {})
      }

      const responseData: any = {
        success: true, order: result.order,
        newBalance: result.updatedUser.balance,
        newVolume: result.updatedMarket.volume,
        newLiquidity: result.updatedMarket.liquidity,
        shares: sharesToSell, proceeds: netProceeds, grossProceeds,
        fee: sellFee.feeAmount, feeRate: FEES.TRADE_FEE_RATE,
      }
      if (isTri) {
        responseData.newHomePrice = result.newPriceData.homePrice
        responseData.newDrawPrice = result.newPriceData.drawPrice
        responseData.newAwayPrice = result.newPriceData.awayPrice
      } else {
        responseData.newYesPrice = result.newPriceData.yesPrice
        responseData.newNoPrice = result.newPriceData.noPrice
      }
      return NextResponse.json(responseData)
    }

  } catch (error: any) {
    console.error('Error executing trade:', error)
    const msg = error?.message || ''
    // Pass through known user-facing error messages
    const userMessage = 
      msg.includes('Insufficient balance') ? 'Insufficient balance' :
      msg.includes('Insufficient shares') ? msg :
      'Failed to execute trade'
    return NextResponse.json({ error: userMessage }, { status: 500 })
  }
}
