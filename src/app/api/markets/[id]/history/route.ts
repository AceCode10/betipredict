import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Returns price history for a market based on filled orders
// Supports time ranges: 1h, 1d, 1w, 1m, max
// For TRI_OUTCOME markets, returns homePrice/drawPrice/awayPrice alongside yesPrice/noPrice
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
      select: {
        id: true, yesPrice: true, noPrice: true, drawPrice: true,
        marketType: true, homeTeam: true, awayTeam: true, createdAt: true,
      },
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    const isTri = market.marketType === 'TRI_OUTCOME'

    // Get filled orders as price points
    const orders = await prisma.order.findMany({
      where: {
        marketId: id,
        status: { in: ['FILLED', 'PARTIALLY_FILLED'] },
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
    interface HistoryPoint {
      time: string
      yesPrice: number
      noPrice: number
      homePrice?: number
      drawPrice?: number
      awayPrice?: number
      volume: number
    }
    const history: HistoryPoint[] = []

    // Initial prices from market creation
    const initHome = market.yesPrice  // yesPrice stores HOME price for tri markets
    const initAway = market.noPrice   // noPrice stores AWAY price for tri markets
    const initDraw = market.drawPrice ?? 0.28

    // Add market creation as first data point
    if (market.createdAt >= since) {
      const point: HistoryPoint = {
        time: market.createdAt.toISOString(),
        yesPrice: initHome,
        noPrice: initAway,
        volume: 0,
      }
      if (isTri) {
        point.homePrice = initHome
        point.drawPrice = initDraw
        point.awayPrice = initAway
      }
      history.push(point)
    }

    let runningHome = initHome
    let runningAway = initAway
    let runningDraw = initDraw

    for (const order of orders) {
      const p = Math.max(0.01, Math.min(0.99, order.price))

      if (isTri) {
        // TRI_OUTCOME: each outcome has its own independent price
        if (order.outcome === 'HOME') runningHome = p
        else if (order.outcome === 'DRAW') runningDraw = p
        else if (order.outcome === 'AWAY') runningAway = p
      } else {
        // BINARY: YES + NO ≈ 1.00
        if (order.outcome === 'YES') {
          runningHome = p
          runningAway = Math.max(0.01, 1 - p)
        } else {
          runningAway = p
          runningHome = Math.max(0.01, 1 - p)
        }
      }

      const point: HistoryPoint = {
        time: order.createdAt.toISOString(),
        yesPrice: runningHome,
        noPrice: runningAway,
        volume: order.amount,
      }
      if (isTri) {
        point.homePrice = runningHome
        point.drawPrice = runningDraw
        point.awayPrice = runningAway
      }
      history.push(point)
    }

    // Always end with current price
    const endPoint: HistoryPoint = {
      time: now.toISOString(),
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      volume: 0,
    }
    if (isTri) {
      endPoint.homePrice = market.yesPrice
      endPoint.drawPrice = market.drawPrice ?? runningDraw
      endPoint.awayPrice = market.noPrice
    }
    history.push(endPoint)

    return NextResponse.json({
      marketId: id,
      range,
      history,
      isTri,
      homeTeam: market.homeTeam,
      awayTeam: market.awayTeam,
      currentYesPrice: market.yesPrice,
      currentNoPrice: market.noPrice,
      currentDrawPrice: market.drawPrice,
    })
  } catch (error) {
    console.error('Error fetching price history:', error)
    return NextResponse.json({ error: 'Failed to fetch price history' }, { status: 500 })
  }
}
