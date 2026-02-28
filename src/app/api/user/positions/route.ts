import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const positions = await prisma.position.findMany({
      where: { userId: session.user.id },
      include: {
        market: {
          select: {
            id: true,
            title: true,
            question: true,
            yesPrice: true,
            noPrice: true,
            drawPrice: true,
            marketType: true,
            status: true,
            winningOutcome: true,
            resolveTime: true,
            category: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Calculate current value and PnL for each position
    const enrichedPositions = positions.map(pos => {
      let currentPrice: number
      if (pos.outcome === 'YES' || pos.outcome === 'HOME') currentPrice = pos.market.yesPrice
      else if (pos.outcome === 'NO' || pos.outcome === 'AWAY') currentPrice = pos.market.noPrice
      else if (pos.outcome === 'DRAW') currentPrice = pos.market.drawPrice ?? 0
      else currentPrice = pos.market.noPrice
      const currentValue = pos.size * currentPrice
      const costBasis = pos.size * pos.averagePrice
      const unrealizedPnl = currentValue - costBasis
      const pnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0

      return {
        ...pos,
        currentPrice,
        currentValue,
        costBasis,
        unrealizedPnl,
        pnlPercent
      }
    })

    return NextResponse.json({ positions: enrichedPositions })
  } catch (error) {
    console.error('Error fetching positions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch positions' },
      { status: 500 }
    )
  }
}
