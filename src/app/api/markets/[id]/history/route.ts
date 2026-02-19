import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Returns price history for a market based on filled orders
// Supports time ranges: 1h, 1d, 1w, 1m, max
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || '1w'

    // Calculate date cutoff
    const now = new Date()
    let since: Date
    switch (range) {
      case '1h': since = new Date(now.getTime() - 60 * 60 * 1000); break
      case '1d': since = new Date(now.getTime() - 24 * 60 * 60 * 1000); break
      case '1w': since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break
      case '1m': since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break
      case 'max': since = new Date(0); break
      default: since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    }

    // Verify market exists
    const market = await prisma.market.findUnique({
      where: { id },
      select: { id: true, yesPrice: true, noPrice: true, createdAt: true },
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    // Get filled orders as price points
    const orders = await prisma.order.findMany({
      where: {
        marketId: id,
        status: 'FILLED',
        createdAt: { gte: since },
      },
      select: {
        price: true,
        outcome: true,
        createdAt: true,
        amount: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })

    // Build price history from orders
    // Each order represents a price point after that trade
    const history: { time: string; yesPrice: number; noPrice: number; volume: number }[] = []

    // Add market creation as first data point
    if (market.createdAt >= since) {
      history.push({
        time: market.createdAt.toISOString(),
        yesPrice: 0.5,
        noPrice: 0.5,
        volume: 0,
      })
    }

    let runningYes = 0.5
    let runningNo = 0.5

    for (const order of orders) {
      if (order.outcome === 'YES') {
        runningYes = Math.max(0.01, Math.min(0.99, order.price))
        runningNo = Math.max(0.01, 1 - runningYes)
      } else {
        runningNo = Math.max(0.01, Math.min(0.99, order.price))
        runningYes = Math.max(0.01, 1 - runningNo)
      }

      history.push({
        time: order.createdAt.toISOString(),
        yesPrice: runningYes,
        noPrice: runningNo,
        volume: order.amount,
      })
    }

    // Always end with current price
    history.push({
      time: now.toISOString(),
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      volume: 0,
    })

    return NextResponse.json({
      marketId: id,
      range,
      history,
      currentYesPrice: market.yesPrice,
      currentNoPrice: market.noPrice,
    })
  } catch (error) {
    console.error('Error fetching price history:', error)
    return NextResponse.json({ error: 'Failed to fetch price history' }, { status: 500 })
  }
}
