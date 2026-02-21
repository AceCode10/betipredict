import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim())

/**
 * GET  /api/admin/disputes - List all open disputes (admin only)
 * POST /api/admin/disputes - Resolve a dispute (admin only)
 */

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const status = request.nextUrl.searchParams.get('status') || 'OPEN'

    const disputes = await prisma.marketDispute.findMany({
      where: { status },
      include: {
        market: { select: { id: true, title: true, winningOutcome: true, status: true } },
        disputer: { select: { id: true, username: true, email: true } },
        resolvedBy: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ disputes })
  } catch (error) {
    console.error('[Admin Disputes] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const admin = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!admin) {
      return NextResponse.json({ error: 'Admin user not found' }, { status: 404 })
    }

    const body = await request.json()
    const { disputeId, action, adminResponse, newOutcome } = body

    if (!disputeId || !action || !adminResponse) {
      return NextResponse.json(
        { error: 'disputeId, action (UPHOLD or REJECT), and adminResponse are required' },
        { status: 400 }
      )
    }

    if (!['UPHOLD', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'action must be UPHOLD or REJECT' }, { status: 400 })
    }

    const dispute = await prisma.marketDispute.findUnique({
      where: { id: disputeId },
      include: { market: true }
    })

    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 })
    }

    if (dispute.status !== 'OPEN') {
      return NextResponse.json({ error: 'Dispute is already resolved' }, { status: 400 })
    }

    const now = new Date()

    if (action === 'REJECT') {
      // Reject the dispute — resolution stands
      await prisma.$transaction([
        prisma.marketDispute.update({
          where: { id: disputeId },
          data: {
            status: 'REJECTED',
            adminResponse,
            resolvedById: admin.id,
            resolvedAt: now,
          }
        }),
        // If no more open disputes, revert market status to RESOLVED
        prisma.notification.create({
          data: {
            type: 'MARKET_RESOLVED',
            title: 'Dispute Rejected',
            message: `Your dispute for "${dispute.market.title}" was rejected. Reason: ${adminResponse}`,
            userId: dispute.disputerId,
            metadata: JSON.stringify({ marketId: dispute.marketId, disputeId }),
          }
        }),
      ])

      // Check if there are remaining open disputes
      const remainingOpen = await prisma.marketDispute.count({
        where: { marketId: dispute.marketId, status: 'OPEN' }
      })

      if (remainingOpen === 0 && dispute.market.status === 'DISPUTED') {
        await prisma.market.update({
          where: { id: dispute.marketId },
          data: { status: 'RESOLVED' }
        })
      }

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'DISPUTE_REJECTED',
          category: 'MARKET',
          details: JSON.stringify({ disputeId, marketId: dispute.marketId, adminResponse }),
          actorId: admin.id,
        }
      })

      return NextResponse.json({ success: true, action: 'REJECTED' })
    }

    if (action === 'UPHOLD') {
      // Uphold the dispute — overturn the resolution
      if (!newOutcome || !['YES', 'NO'].includes(newOutcome)) {
        return NextResponse.json(
          { error: 'newOutcome (YES or NO) is required when upholding a dispute' },
          { status: 400 }
        )
      }

      await prisma.$transaction([
        prisma.marketDispute.update({
          where: { id: disputeId },
          data: {
            status: 'UPHELD',
            adminResponse,
            resolvedById: admin.id,
            resolvedAt: now,
          }
        }),
        // Reject all other open disputes for this market
        prisma.marketDispute.updateMany({
          where: { marketId: dispute.marketId, status: 'OPEN', id: { not: disputeId } },
          data: { status: 'REJECTED', adminResponse: 'Auto-closed: another dispute was upheld' }
        }),
        // Update market with new outcome and reset to RESOLVED for finalization
        prisma.market.update({
          where: { id: dispute.marketId },
          data: {
            winningOutcome: newOutcome,
            status: 'RESOLVED',
            disputeDeadline: new Date(now.getTime() + 24 * 60 * 60 * 1000), // New 24h window
          }
        }),
        prisma.notification.create({
          data: {
            type: 'MARKET_RESOLVED',
            title: 'Dispute Upheld — Resolution Changed',
            message: `Your dispute for "${dispute.market.title}" was upheld. The outcome has been changed to ${newOutcome}.`,
            userId: dispute.disputerId,
            metadata: JSON.stringify({ marketId: dispute.marketId, disputeId, newOutcome }),
          }
        }),
      ])

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'DISPUTE_UPHELD',
          category: 'MARKET',
          details: JSON.stringify({ disputeId, marketId: dispute.marketId, oldOutcome: dispute.market.winningOutcome, newOutcome, adminResponse }),
          actorId: admin.id,
        }
      })

      return NextResponse.json({ success: true, action: 'UPHELD', newOutcome })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[Admin Disputes] Error:', error)
    return NextResponse.json({ error: 'Failed to resolve dispute' }, { status: 500 })
  }
}
