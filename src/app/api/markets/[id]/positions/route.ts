import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/markets/[id]/positions — returns all positions for a market with PnL
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params
    const { searchParams } = new URL(request.url)
    const outcomeFilter = searchParams.get('outcome') // YES, NO, or null for all
    const sortDir = searchParams.get('sort') === 'asc' ? 'asc' as const : 'desc' as const

    if (!marketId) {
      return NextResponse.json({ error: 'Market ID required' }, { status: 400 })
    }

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: { yesPrice: true, noPrice: true, status: true, winningOutcome: true }
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    const where: any = { marketId, size: { gt: 0 } }
    if (outcomeFilter && ['YES', 'NO'].includes(outcomeFilter)) {
      where.outcome = outcomeFilter
    }

    const positions = await prisma.position.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, fullName: true }
        }
      },
      orderBy: { size: sortDir }
    })

    const enriched = positions.map(pos => {
      const currentPrice = pos.outcome === 'YES' ? market.yesPrice : market.noPrice
      const currentValue = pos.size * currentPrice
      const costBasis = pos.size * pos.averagePrice
      const unrealizedPnl = pos.isClosed ? pos.realizedPnl : currentValue - costBasis

      return {
        id: pos.id,
        userId: pos.user.id,
        username: pos.user.username || pos.user.fullName || 'Anonymous',
        outcome: pos.outcome,
        shares: Math.round(pos.size * 100) / 100,
        avgPrice: Math.round(pos.averagePrice * 100) / 100,
        currentPrice: Math.round(currentPrice * 100) / 100,
        pnl: Math.round(unrealizedPnl * 100) / 100,
        isClosed: pos.isClosed,
      }
    })

    return NextResponse.json({
      positions: enriched,
      total: enriched.length,
    })
  } catch (error) {
    console.error('Error fetching market positions:', error)
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 })
  }
}
