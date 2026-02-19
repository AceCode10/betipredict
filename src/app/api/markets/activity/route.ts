import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Returns recent trading activity across all markets
// Public endpoint - no auth required, only exposes public data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
    const marketId = searchParams.get('marketId')

    const where: any = { status: 'FILLED' }
    if (marketId && typeof marketId === 'string') {
      where.marketId = marketId
    }

    const recentOrders = await prisma.order.findMany({
      where,
      select: {
        id: true,
        side: true,
        outcome: true,
        price: true,
        amount: true,
        createdAt: true,
        marketId: true,
        user: { select: { username: true } },
        market: { select: { title: true, question: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Mask usernames for privacy (show first 3 chars + ***)
    const activity = recentOrders.map(order => ({
      id: order.id,
      side: order.side,
      outcome: order.outcome,
      price: order.price,
      amount: order.amount,
      createdAt: order.createdAt,
      marketId: order.marketId,
      username: order.user.username.slice(0, 3) + '***',
      marketTitle: order.market.title,
    }))

    return NextResponse.json({ activity })
  } catch (error) {
    console.error('Error fetching activity:', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }
}
