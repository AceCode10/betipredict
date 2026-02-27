import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'
import { requireAdmin } from '@/lib/admin-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admins or the market creator can resolve
    const market = await prisma.market.findUnique({ where: { id }, select: { creatorId: true, marketType: true } })
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    const adminSession = await requireAdmin()
    const isAdmin = !!adminSession
    if (!isAdmin && market.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Only admins or the market creator can resolve this market' }, { status: 403 })
    }

    const { outcome } = await request.json()

    const validOutcomes = market.marketType === 'TRI_OUTCOME'
      ? ['HOME', 'DRAW', 'AWAY']
      : ['YES', 'NO']

    if (!outcome || !validOutcomes.includes(outcome)) {
      return NextResponse.json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}` }, { status: 400 })
    }

    const result = await MarketResolver.resolveMarket(id, outcome)

    return NextResponse.json(result)

  } catch (error) {
    console.error('Error resolving market:', error)
    return NextResponse.json(
      { error: 'Failed to resolve market' },
      { status: 500 }
    )
  }
}
