import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/markets/[id]/holders — returns top holders and positions for a market
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params

    if (!marketId) {
      return NextResponse.json({ error: 'Market ID required' }, { status: 400 })
    }

    // Fetch all open positions for this market, grouped by outcome
    const positions = await prisma.position.findMany({
      where: { marketId, isClosed: false, size: { gt: 0 } },
      include: {
        user: {
          select: { id: true, username: true, fullName: true }
        }
      },
      orderBy: { size: 'desc' }
    })

    // Split into YES and NO holders
    const yesHolders = positions
      .filter(p => p.outcome === 'YES')
      .map(p => ({
        userId: p.user.id,
        username: p.user.username || p.user.fullName || 'Anonymous',
        shares: Math.round(p.size * 100) / 100,
        avgPrice: Math.round(p.averagePrice * 100) / 100,
        pnl: Math.round((p.size * (1 - p.averagePrice)) * 100) / 100, // potential PnL if YES wins
      }))

    const noHolders = positions
      .filter(p => p.outcome === 'NO')
      .map(p => ({
        userId: p.user.id,
        username: p.user.username || p.user.fullName || 'Anonymous',
        shares: Math.round(p.size * 100) / 100,
        avgPrice: Math.round(p.averagePrice * 100) / 100,
        pnl: Math.round((p.size * (1 - p.averagePrice)) * 100) / 100,
      }))

    return NextResponse.json({
      yesHolders: yesHolders.slice(0, 20),
      noHolders: noHolders.slice(0, 20),
      totalYesHolders: yesHolders.length,
      totalNoHolders: noHolders.length,
    })
  } catch (error) {
    console.error('Error fetching market holders:', error)
    return NextResponse.json({ error: 'Failed to fetch holders' }, { status: 500 })
  }
}
