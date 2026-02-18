import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TradeRequest } from '@/types'
import { initializePool, calculateSharesForAmount, getPrices } from '@/lib/cpmm'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const trade: TradeRequest = await request.json()
    const { marketId, outcome, side, type, amount, price } = trade

    // Validate trade request
    if (!marketId || !outcome || !side || !type || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid trade parameters' },
        { status: 400 }
      )
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Get market
    const market = await prisma.market.findUnique({
      where: { id: marketId }
    })

    if (!market) {
      return NextResponse.json(
        { error: 'Market not found' },
        { status: 404 }
      )
    }

    if (market.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Market is not active for trading' },
        { status: 400 }
      )
    }

    // Calculate trade price
    const tradePrice = type === 'MARKET' 
      ? (outcome === 'YES' ? market.yesPrice : market.noPrice)
      : (price || 0.5)

    const totalCost = amount * tradePrice

    // Check user balance for BUY orders
    if (side === 'BUY' && user.balance < totalCost) {
      return NextResponse.json(
        { error: 'Insufficient balance' },
        { status: 400 }
      )
    }

    // Create order
    const order = await prisma.order.create({
      data: {
        type,
        side,
        outcome,
        price: tradePrice,
        amount,
        remaining: amount,
        userId: session.user.id,
        marketId
      }
    })

    // Simple order matching (for MVP)
    // In production, this would be more sophisticated
    await matchOrders(marketId, outcome)

    // Update user balance for BUY orders
    if (side === 'BUY') {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          balance: user.balance - totalCost
        }
      })

      // Create transaction record
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          amount: -totalCost,
          description: `Buy ${amount} ${outcome} shares in ${market.question}`,
          status: 'COMPLETED',
          userId: session.user.id,
          metadata: JSON.stringify({ orderId: order.id, marketId, outcome, amount, price: tradePrice })
        }
      })
    }

    // Update or create user position
    await updatePosition(session.user.id, marketId, outcome, amount, tradePrice, side)

    // Update market prices using CPMM
    const pool = initializePool(market.liquidity || 1000, market.yesPrice)
    const { newPool } = calculateSharesForAmount(pool, outcome as 'YES' | 'NO', totalCost)
    const newPrices = getPrices(newPool)

    // Update market liquidity, volume, and prices
    await prisma.market.update({
      where: { id: marketId },
      data: {
        volume: market.volume + totalCost,
        liquidity: market.liquidity + (side === 'BUY' ? totalCost : -totalCost),
        yesPrice: Math.max(0.01, Math.min(0.99, newPrices.yesPrice)),
        noPrice: Math.max(0.01, Math.min(0.99, newPrices.noPrice))
      }
    })

    return NextResponse.json({
      success: true,
      order,
      newBalance: side === 'BUY' ? user.balance - totalCost : user.balance,
      newYesPrice: newPrices.yesPrice,
      newNoPrice: newPrices.noPrice,
      shares: amount
    })

  } catch (error) {
    console.error('Error executing trade:', error)
    return NextResponse.json(
      { error: 'Failed to execute trade' },
      { status: 500 }
    )
  }
}

async function matchOrders(marketId: string, outcome: 'YES' | 'NO') {
  // Simple order matching logic
  // In production, this would be a proper order book matching engine
  
  const buyOrders = await prisma.order.findMany({
    where: {
      marketId,
      outcome,
      side: 'BUY',
      status: 'OPEN',
      remaining: { gt: 0 }
    },
    orderBy: { price: 'desc' }
  })

  const sellOrders = await prisma.order.findMany({
    where: {
      marketId,
      outcome,
      side: 'SELL',
      status: 'OPEN',
      remaining: { gt: 0 }
    },
    orderBy: { price: 'asc' }
  })

  // Match orders where buy price >= sell price
  for (const buyOrder of buyOrders) {
    for (const sellOrder of sellOrders) {
      if (buyOrder.price >= sellOrder.price && buyOrder.remaining > 0 && sellOrder.remaining > 0) {
        const matchAmount = Math.min(buyOrder.remaining, sellOrder.remaining)
        
        // Update orders
        await prisma.order.update({
          where: { id: buyOrder.id },
          data: {
            filled: buyOrder.filled + matchAmount,
            remaining: buyOrder.remaining - matchAmount,
            status: buyOrder.remaining - matchAmount === 0 ? 'FILLED' : 'OPEN'
          }
        })

        await prisma.order.update({
          where: { id: sellOrder.id },
          data: {
            filled: sellOrder.filled + matchAmount,
            remaining: sellOrder.remaining - matchAmount,
            status: sellOrder.remaining - matchAmount === 0 ? 'FILLED' : 'OPEN'
          }
        })
      }
    }
  }
}

async function updatePosition(
  userId: string,
  marketId: string,
  outcome: 'YES' | 'NO',
  amount: number,
  price: number,
  side: 'BUY' | 'SELL'
) {
  const existingPosition = await prisma.position.findUnique({
    where: {
      userId_marketId_outcome: {
        userId,
        marketId,
        outcome
      }
    }
  })

  if (existingPosition) {
    if (side === 'BUY') {
      // Add to existing position
      const newTotalAmount = existingPosition.size + amount
      const newAveragePrice = ((existingPosition.averagePrice * existingPosition.size) + (price * amount)) / newTotalAmount
      
      await prisma.position.update({
        where: { id: existingPosition.id },
        data: {
          size: newTotalAmount,
          averagePrice: newAveragePrice
        }
      })
    } else {
      // Reduce position (simplified)
      const newSize = Math.max(0, existingPosition.size - amount)
      await prisma.position.update({
        where: { id: existingPosition.id },
        data: {
          size: newSize,
          isClosed: newSize === 0
        }
      })
    }
  } else if (side === 'BUY') {
    // Create new position
    await prisma.position.create({
      data: {
        userId,
        marketId,
        outcome,
        size: amount,
        averagePrice: price
      }
    })
  }
}
