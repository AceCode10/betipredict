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
      volumeResult,
      revenueResult,
      pendingSuggestions
    ] = await Promise.all([
      prisma.user.count(),
      prisma.market.count(),
      prisma.market.count({ where: { status: 'ACTIVE' } }),
      prisma.market.aggregate({ _sum: { volume: true } }),
      prisma.platformRevenue.aggregate({ _sum: { amount: true } }),
      prisma.marketSuggestion.count({ where: { status: 'PENDING' } })
    ])

    return NextResponse.json({
      totalUsers,
      totalMarkets,
      activeMarkets,
      totalVolume: volumeResult._sum.volume || 0,
      totalRevenue: revenueResult._sum.amount || 0,
      pendingSuggestions
    })
  } catch (error) {
    console.error('Error fetching admin stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}
