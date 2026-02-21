import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
    const period = searchParams.get('period') || 'all' // all, week, month

    // Calculate date filter
    let dateFilter: Date | undefined
    if (period === 'week') {
      dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    } else if (period === 'month') {
      dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    }

    // Get users with their realized PnL from closed positions
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        avatar: true,
        positions: {
          where: {
            isClosed: true,
            ...(dateFilter ? { updatedAt: { gte: dateFilter } } : {}),
          },
          select: {
            realizedPnl: true,
            size: true,
            averagePrice: true,
          }
        },
        _count: {
          select: {
            orders: {
              where: {
                status: 'FILLED',
                ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
              }
            }
          }
        }
      }
    })

    // Calculate stats and rank
    const leaderboard = users
      .map(user => {
        const totalPnl = user.positions.reduce((sum, p) => sum + p.realizedPnl, 0)
        const totalInvested = user.positions.reduce((sum, p) => sum + (p.size * p.averagePrice), 0)
        const roi = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0
        return {
          userId: user.id,
          username: user.username,
          avatar: user.avatar,
          totalPnl: Math.round(totalPnl * 100) / 100,
          roi: Math.round(roi * 10) / 10,
          trades: user._count.orders,
          marketsTraded: user.positions.length,
        }
      })
      .filter(u => u.trades > 0) // Only show users who have traded
      .sort((a, b) => b.totalPnl - a.totalPnl)
      .slice(0, limit)
      .map((u, i) => ({ ...u, rank: i + 1 }))

    return NextResponse.json({ leaderboard })
  } catch (error) {
    console.error('Error fetching leaderboard:', error)
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 })
  }
}
