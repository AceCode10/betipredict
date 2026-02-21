import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/markets/[id]/dispute - Submit a dispute for a resolved market
 * GET  /api/markets/[id]/dispute - Get disputes for a market
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const market = await prisma.market.findUnique({
      where: { id },
      include: { positions: { where: { userId: user.id } } }
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    // Only allow disputes on RESOLVED markets within the dispute window
    if (market.status !== 'RESOLVED') {
      return NextResponse.json(
        { error: 'Market is not in a disputable state' },
        { status: 400 }
      )
    }

    // Check dispute window
    const disputeDeadline = market.disputeDeadline
    if (disputeDeadline && new Date() > new Date(disputeDeadline)) {
      return NextResponse.json(
        { error: 'Dispute window has closed' },
        { status: 400 }
      )
    }

    // User must have a position in the market to dispute
    if (!market.positions || market.positions.length === 0) {
      return NextResponse.json(
        { error: 'You must have a position in this market to file a dispute' },
        { status: 403 }
      )
    }

    // Check if user already has an open dispute for this market
    const existingDispute = await prisma.marketDispute.findFirst({
      where: { marketId: id, disputerId: user.id, status: 'OPEN' }
    })

    if (existingDispute) {
      return NextResponse.json(
        { error: 'You already have an open dispute for this market' },
        { status: 409 }
      )
    }

    const body = await request.json()
    const { reason, evidence } = body

    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return NextResponse.json(
        { error: 'Dispute reason must be at least 10 characters' },
        { status: 400 }
      )
    }

    if (reason.length > 2000) {
      return NextResponse.json(
        { error: 'Dispute reason must be under 2000 characters' },
        { status: 400 }
      )
    }

    const dispute = await prisma.marketDispute.create({
      data: {
        reason: reason.trim(),
        evidence: evidence?.trim() || null,
        marketId: id,
        disputerId: user.id,
      }
    })

    // Update market status to DISPUTED
    await prisma.market.update({
      where: { id },
      data: { status: 'DISPUTED' }
    })

    // Notify admins about the dispute
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
    if (adminEmails.length > 0) {
      const admins = await prisma.user.findMany({
        where: { email: { in: adminEmails } },
        select: { id: true }
      })

      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map(admin => ({
            type: 'MARKET_RESOLVED',
            title: 'Market Dispute Filed',
            message: `A dispute has been filed for "${market.title}" by ${user.username}. Reason: ${reason.trim().slice(0, 100)}...`,
            userId: admin.id,
            metadata: JSON.stringify({ marketId: id, disputeId: dispute.id }),
          }))
        })
      }
    }

    return NextResponse.json({
      success: true,
      dispute: {
        id: dispute.id,
        reason: dispute.reason,
        status: dispute.status,
        createdAt: dispute.createdAt,
      }
    })
  } catch (error) {
    console.error('[Dispute] Error:', error)
    return NextResponse.json({ error: 'Failed to submit dispute' }, { status: 500 })
  }
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
