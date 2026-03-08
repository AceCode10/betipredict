import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/markets/[id]/dispute - Submit a dispute for a resolved market
 * GET  /api/markets/[id]/dispute - Get disputes for a market
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Dispute filing temporarily disabled for public users (v2 feature)
  return NextResponse.json(
    { error: 'Dispute filing is temporarily unavailable. Contact support if you believe a market was resolved incorrectly.' },
    { status: 403 }
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const disputes = await prisma.marketDispute.findMany({
      where: { marketId: id },
      include: {
        disputer: { select: { id: true, username: true } },
        resolvedBy: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ disputes })
  } catch (error) {
    console.error('[Dispute] Error fetching disputes:', error)
    return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 })
  }
}
