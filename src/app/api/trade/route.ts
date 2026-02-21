import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TradeRequest } from '@/types'
import { initializePool, calculateSharesForAmount, calculateBuyCost, calculateSellProceeds, getPrices } from '@/lib/cpmm'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { calculateTradeFee, FEES } from '@/lib/fees'

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
    if (!['YES', 'NO'].includes(outcome)) {
      return NextResponse.json({ error: 'Outcome must be YES or NO' }, { status: 400 })
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

    // Initialize CPMM pool from current market state
    const pool = initializePool(market.liquidity || 1000, market.yesPrice)

    if (side === 'BUY') {
      // For BUY: `amount` = Kwacha the user wants to spend (gross)
      const grossAmount = amount
      const fee = calculateTradeFee(grossAmount)
      const kwachaToSpend = fee.netAmount // Amount after fee deduction

      // Check balance BEFORE any DB writes (user pays gross amount)
      if (user.balance < grossAmount) {
        return NextResponse.json(
          { error: `Insufficient balance. You have ${user.balance.toFixed(2)} but need ${grossAmount.toFixed(2)}` },
          { status: 400 }
        )
      }

      // Calculate shares received via CPMM (using net amount after fee)
      const { shares, newPool, avgPrice } = calculateSharesForAmount(pool, outcome as 'YES' | 'NO', kwachaToSpend)
      const newPrices = getPrices(newPool)

      if (shares <= 0) {
        return NextResponse.json({ error: 'Trade amount too small' }, { status: 400 })
      }

      // Execute everything atomically
      const result = await prisma.$transaction(async (tx) => {
        // 1. Deduct balance (re-check inside transaction for safety)
        const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
        if (!freshUser || freshUser.balance < grossAmount) {
          throw new Error('Insufficient balance')
        }

        const updatedUser = await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { decrement: grossAmount } }
        })

        // 2. Create order record
        const order = await tx.order.create({
          data: {
            type,
            side: 'BUY',
            outcome,
            price: avgPrice,
            amount: shares,
            filled: shares,
            remaining: 0,
            status: 'FILLED',
            userId: session.user.id,
            marketId
          }
        })

        // 3. Create transaction record (with fee tracking)
        await tx.transaction.create({
          data: {
            type: 'TRADE',
            amount: -grossAmount,
            feeAmount: fee.feeAmount,
            description: `Bought ${shares.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(avgPrice * 100).toFixed(1)}% (fee: K${fee.feeAmount.toFixed(2)})`,
            status: 'COMPLETED',
            userId: session.user.id,
            metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares, avgPrice, spent: grossAmount, fee: fee.feeAmount, netSpent: kwachaToSpend })
          }
        })

        // 3b. Record platform revenue from trading fee
        if (fee.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              feeType: 'TRADE_FEE',
              amount: fee.feeAmount,
              description: `Trade fee on BUY ${outcome} in "${market.title}"`,
              sourceType: 'TRADE',
              sourceId: order.id,
              userId: session.user.id,
            }
          })
        }

        // 4. Update or create position
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

        // 5. Update market prices and volume
        const updatedMarket = await tx.market.update({
          where: { id: marketId },
          data: {
            volume: { increment: kwachaToSpend },
            liquidity: { increment: kwachaToSpend },
            yesPrice: Math.max(0.01, Math.min(0.99, newPrices.yesPrice)),
            noPrice: Math.max(0.01, Math.min(0.99, newPrices.noPrice))
          }
        })

        return { updatedUser, order, updatedMarket, shares, avgPrice, newPrices }
      })

      return NextResponse.json({
        success: true,
        order: result.order,
        newBalance: result.updatedUser.balance,
        newYesPrice: result.newPrices.yesPrice,
        newNoPrice: result.newPrices.noPrice,
        shares: result.shares,
        avgPrice: result.avgPrice,
        spent: grossAmount,
        fee: fee.feeAmount,
        feeRate: FEES.TRADE_FEE_RATE,
      })

    } else {
      // SELL: `amount` = number of shares to sell
      const sharesToSell = amount

      // Pre-check (non-authoritative — real check is inside transaction)
      const positionPreCheck = await prisma.position.findUnique({
        where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
      })

      if (!positionPreCheck || positionPreCheck.size < sharesToSell) {
        return NextResponse.json(
          { error: `Insufficient shares. You have ${positionPreCheck?.size.toFixed(2) || '0'} but want to sell ${sharesToSell.toFixed(2)}` },
          { status: 400 }
        )
      }

      // Calculate proceeds via CPMM (proper sell-side computation)
      const { proceeds: grossProceeds, newPool: sellPool, avgPrice: sellAvgPrice } = calculateSellProceeds(pool, outcome as 'YES' | 'NO', sharesToSell)
      const newPrices = getPrices(sellPool)

      if (grossProceeds <= 0) {
        return NextResponse.json({ error: 'Sell amount too small' }, { status: 400 })
      }

      // Apply trading fee on sell proceeds
      const sellFee = calculateTradeFee(grossProceeds)
      const netProceeds = sellFee.netAmount

      // Execute atomically — re-check position inside transaction to prevent race
      const result = await prisma.$transaction(async (tx) => {
        // 1. Re-check position inside transaction (prevents double-sell race)
        const position = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
        })

        if (!position || position.size < sharesToSell) {
          throw new Error(`Insufficient shares. You have ${position?.size.toFixed(2) || '0'} but want to sell ${sharesToSell.toFixed(2)}`)
        }

        // 2. Credit balance (net of fee)
        const updatedUser = await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { increment: netProceeds } }
        })

        // 3. Create order
        const order = await tx.order.create({
          data: {
            type,
            side: 'SELL',
            outcome,
            price: sellAvgPrice,
            amount: sharesToSell,
            filled: sharesToSell,
            remaining: 0,
            status: 'FILLED',
            userId: session.user.id,
            marketId
          }
        })

        // 4. Create transaction (with fee tracking)
        await tx.transaction.create({
          data: {
            type: 'TRADE',
            amount: netProceeds,
            feeAmount: sellFee.feeAmount,
            description: `Sold ${sharesToSell.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(sellAvgPrice * 100).toFixed(1)}% (fee: K${sellFee.feeAmount.toFixed(2)})`,
            status: 'COMPLETED',
            userId: session.user.id,
            metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares: sharesToSell, price: sellAvgPrice, grossProceeds, fee: sellFee.feeAmount, netProceeds })
          }
        })

        // 4b. Record platform revenue from trading fee
        if (sellFee.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              feeType: 'TRADE_FEE',
              amount: sellFee.feeAmount,
              description: `Trade fee on SELL ${outcome} in "${market.title}"`,
              sourceType: 'TRADE',
              sourceId: order.id,
              userId: session.user.id,
            }
          })
        }

        // 5. Reduce position
        const newSize = position.size - sharesToSell
        await tx.position.update({
          where: { id: position.id },
          data: { size: Math.max(0, newSize), isClosed: newSize <= 0 }
        })

        // 6. Update market prices and liquidity (read fresh inside tx)
        const freshMarket = await tx.market.findUnique({ where: { id: marketId }, select: { liquidity: true } })
        const currentLiquidity = freshMarket?.liquidity || 0
        const updatedMarket = await tx.market.update({
          where: { id: marketId },
          data: {
            volume: { increment: grossProceeds },
            liquidity: Math.max(0, currentLiquidity - grossProceeds),
            yesPrice: Math.max(0.01, Math.min(0.99, newPrices.yesPrice)),
            noPrice: Math.max(0.01, Math.min(0.99, newPrices.noPrice)),
          }
        })

        return { updatedUser, order, updatedMarket, newPrices }
      })

      return NextResponse.json({
        success: true,
        order: result.order,
        newBalance: result.updatedUser.balance,
        newYesPrice: result.newPrices.yesPrice,
        newNoPrice: result.newPrices.noPrice,
        shares: sharesToSell,
        proceeds: netProceeds,
        grossProceeds,
        fee: sellFee.feeAmount,
        feeRate: FEES.TRADE_FEE_RATE,
      })
    }

  } catch (error: any) {
    console.error('Error executing trade:', error)
    const message = error?.message === 'Insufficient balance' 
      ? 'Insufficient balance' 
      : 'Failed to execute trade'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
