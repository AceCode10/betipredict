import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { marketId, winningOutcome, action } = await request.json()

    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
    }

    // Get market
    const market = await prisma.market.findUnique({
      where: { id: marketId }
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    // Only admins or the market creator can resolve
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } })
    const isAdmin = user?.email ? adminEmails.includes(user.email.toLowerCase()) : false

    if (!isAdmin && market.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Only admins or the market creator can resolve this market' }, { status: 403 })
    }

    const meta = extractRequestMeta(request.headers)

    // ─── Finalize action: process payouts for resolved markets ───
    if (action === 'FINALIZE' || action === 'EARLY_FINALIZE') {
      if (market.status !== 'RESOLVED') {
        return NextResponse.json({ error: 'Market must be in RESOLVED state to finalize' }, { status: 400 })
      }

      // Admin early finalization: skip dispute window when outcome is clearly correct
      const result = (action === 'EARLY_FINALIZE' && isAdmin)
        ? await MarketResolver.earlyFinalizeMarket(marketId)
        : await MarketResolver.finalizeMarket(marketId)

      writeAuditLog({
        action: action === 'EARLY_FINALIZE' ? 'MARKET_EARLY_FINALIZED' : 'MARKET_FINALIZED',
        category: 'MARKET',
        details: { marketId, outcome: result.finalized, feesCollected: result.feesCollected, isAdmin, earlyFinalize: action === 'EARLY_FINALIZE' },
        actorId: session.user.id,
        ...meta,
      })

      return NextResponse.json({
        success: true,
        action: 'FINALIZED',
        winningOutcome: result.finalized,
        feesCollected: result.feesCollected,
      })
    }

    // ─── VOID action: immediate refund (no dispute window) ───
    if (winningOutcome === 'VOID') {
      if (market.status !== 'ACTIVE' && market.status !== 'RESOLVED') {
        return NextResponse.json({ error: 'Market cannot be voided in its current state' }, { status: 400 })
      }

      const positions = await prisma.position.findMany({
        where: { marketId, isClosed: false }
      })

      const payouts: { userId: string; amount: number }[] = []
      for (const pos of positions) {
        const refund = pos.size * pos.averagePrice
        payouts.push({ userId: pos.userId, amount: refund })
      }

      await prisma.$transaction(async (tx) => {
        await tx.market.update({
          where: { id: marketId },
          data: { status: 'FINALIZED', winningOutcome: 'VOID', resolvedAt: new Date() }
        })
        for (const payout of payouts) {
          await tx.user.update({
            where: { id: payout.userId },
            data: { balance: { increment: payout.amount } }
          })
          await tx.transaction.create({
            data: {
              type: 'TRADE',
              amount: payout.amount,
              description: `Refund for voided market: ${market.title}`,
              status: 'COMPLETED',
              userId: payout.userId,
              metadata: JSON.stringify({ marketId, winningOutcome: 'VOID', type: 'REFUND' })
            }
          })
        }
        await tx.position.updateMany({
          where: { marketId },
          data: { isClosed: true }
        })
      })

      writeAuditLog({
        action: 'MARKET_VOIDED',
        category: 'MARKET',
        details: { marketId, payoutsProcessed: payouts.length, totalRefunded: payouts.reduce((s, p) => s + p.amount, 0), isAdmin },
        actorId: session.user.id,
        ...meta,
      })

      return NextResponse.json({
        success: true,
        action: 'VOIDED',
        winningOutcome: 'VOID',
        payoutsProcessed: payouts.length,
        totalPaidOut: payouts.reduce((s, p) => s + p.amount, 0),
      })
    }

    // ─── Standard resolve: uses dispute-window flow ───
    if (!['YES', 'NO'].includes(winningOutcome)) {
      return NextResponse.json({ error: 'Invalid outcome. Must be YES, NO, or VOID' }, { status: 400 })
    }

    if (market.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Only active markets can be resolved' }, { status: 400 })
    }

    // Phase 1: resolve with 24h dispute window (no immediate payouts)
    const result = await MarketResolver.resolveMarket(marketId, winningOutcome as 'YES' | 'NO')

    writeAuditLog({
      action: 'MARKET_RESOLVED',
      category: 'MARKET',
      details: { marketId, winningOutcome, disputeDeadline: result.disputeDeadline, isAdmin },
      actorId: session.user.id,
      ...meta,
    })

    return NextResponse.json({
      success: true,
      action: 'RESOLVED',
      winningOutcome,
      disputeDeadline: result.disputeDeadline,
      message: `Market resolved to ${winningOutcome}. Payouts will process after the 24h dispute window.`,
    })
  } catch (error: any) {
    console.error('Error resolving market:', error)
    // Don't leak internal error details to users
    const safeMessages = [
      'Market is not active',
      'Market not found',
      'Dispute window is still open',
      'Market has open dispute',
      'No winning outcome set',
    ]
    const msg = error?.message || ''
    const isSafe = safeMessages.some(m => msg.includes(m))
    return NextResponse.json(
      { error: isSafe ? msg : 'Failed to resolve market' },
      { status: 500 }
    )
  }
}
