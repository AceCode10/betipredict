import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TradeRequest } from '@/types'
import { initializePool, calculateSharesForAmount, calculateBuyCost, getPrices } from '@/lib/cpmm'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      // For BUY: `amount` = Kwacha the user wants to spend
      const kwachaToSpend = amount

      // Check balance BEFORE any DB writes
      if (user.balance < kwachaToSpend) {
        return NextResponse.json(
          { error: `Insufficient balance. You have ${user.balance.toFixed(2)} but need ${kwachaToSpend.toFixed(2)}` },
          { status: 400 }
        )
      }

      // Calculate shares received via CPMM
      const { shares, newPool, avgPrice } = calculateSharesForAmount(pool, outcome as 'YES' | 'NO', kwachaToSpend)
      const newPrices = getPrices(newPool)

      if (shares <= 0) {
        return NextResponse.json({ error: 'Trade amount too small' }, { status: 400 })
      }

      // Execute everything atomically
      const result = await prisma.$transaction(async (tx) => {
        // 1. Deduct balance (re-check inside transaction for safety)
        const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
        if (!freshUser || freshUser.balance < kwachaToSpend) {
          throw new Error('Insufficient balance')
        }

        const updatedUser = await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { decrement: kwachaToSpend } }
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

        // 3. Create transaction record
        await tx.transaction.create({
          data: {
            type: 'TRADE',
            amount: -kwachaToSpend,
            description: `Bought ${shares.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(avgPrice * 100).toFixed(1)}%`,
            status: 'COMPLETED',
            userId: session.user.id,
            metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares, avgPrice, spent: kwachaToSpend })
          }
        })

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
        spent: kwachaToSpend
      })

    } else {
      // SELL: `amount` = number of shares to sell
      const sharesToSell = amount

      // Check user has enough shares
      const position = await prisma.position.findUnique({
        where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
      })

      if (!position || position.size < sharesToSell) {
        return NextResponse.json(
          { error: `Insufficient shares. You have ${position?.size.toFixed(2) || '0'} but want to sell ${sharesToSell.toFixed(2)}` },
          { status: 400 }
        )
      }

      // Calculate proceeds via CPMM (selling is the reverse of buying)
      const currentPrice = outcome === 'YES' ? market.yesPrice : market.noPrice
      const proceeds = sharesToSell * currentPrice
      const newPrices = getPrices(pool) // Simplified: selling has inverse price effect

      // Execute atomically
      const result = await prisma.$transaction(async (tx) => {
        // 1. Credit balance
        const updatedUser = await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { increment: proceeds } }
        })

        // 2. Create order
        const order = await tx.order.create({
          data: {
            type,
            side: 'SELL',
            outcome,
            price: currentPrice,
            amount: sharesToSell,
            filled: sharesToSell,
            remaining: 0,
            status: 'FILLED',
            userId: session.user.id,
            marketId
          }
        })

        // 3. Create transaction
        await tx.transaction.create({
          data: {
            type: 'TRADE',
            amount: proceeds,
            description: `Sold ${sharesToSell.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(currentPrice * 100).toFixed(1)}%`,
            status: 'COMPLETED',
            userId: session.user.id,
            metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares: sharesToSell, price: currentPrice, proceeds })
          }
        })

        // 4. Reduce position
        const newSize = position.size - sharesToSell
        await tx.position.update({
          where: { id: position.id },
          data: { size: Math.max(0, newSize), isClosed: newSize <= 0 }
        })

        // 5. Update market
        const updatedMarket = await tx.market.update({
          where: { id: marketId },
          data: {
            volume: { increment: proceeds },
            liquidity: { decrement: proceeds }
          }
        })

        return { updatedUser, order, updatedMarket }
      })

      return NextResponse.json({
        success: true,
        order: result.order,
        newBalance: result.updatedUser.balance,
        newYesPrice: market.yesPrice,
        newNoPrice: market.noPrice,
        shares: sharesToSell,
        proceeds
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
