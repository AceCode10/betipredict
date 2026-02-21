import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = ADMIN_EMAILS.includes(session.user.email.toLowerCase())
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Fetch stats in parallel
    const [
      totalUsers,
      totalMarkets,
      activeMarkets,
      resolvedMarkets,
      disputedMarkets,
      volumeResult,
      revenueResult,
      pendingSuggestions,
      openDisputes,
      revenueByType,
      pendingPayments,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.market.count(),
      prisma.market.count({ where: { status: 'ACTIVE' } }),
      prisma.market.count({ where: { status: { in: ['RESOLVED', 'FINALIZED'] } } }),
      prisma.market.count({ where: { status: 'DISPUTED' } }),
      prisma.market.aggregate({ _sum: { volume: true } }),
      prisma.platformRevenue.aggregate({ _sum: { amount: true } }),
      prisma.marketSuggestion.count({ where: { status: 'PENDING' } }),
      prisma.marketDispute.count({ where: { status: 'OPEN' } }),
      prisma.platformRevenue.groupBy({
        by: ['feeType'],
        _sum: { amount: true },
        _count: true,
      }),
      prisma.mobilePayment.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    ])

    const revenueBreakdown = revenueByType.reduce((acc: Record<string, { total: number; count: number }>, item: any) => {
      acc[item.feeType] = {
        total: item._sum.amount || 0,
        count: item._count,
      }
      return acc
    }, {})

    return NextResponse.json({
      totalUsers,
      newUsersLast7Days: recentUsers,
      totalMarkets,
      activeMarkets,
      resolvedMarkets,
      disputedMarkets,
      totalVolume: volumeResult._sum.volume || 0,
      totalRevenue: revenueResult._sum.amount || 0,
      revenueBreakdown,
      pendingSuggestions,
      openDisputes,
      pendingPayments,
    })
  } catch (error) {
    console.error('Error fetching admin stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}
