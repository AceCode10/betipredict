import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { marketId, winningOutcome } = await request.json()

    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
    }
    if (!['YES', 'NO', 'DRAW', 'VOID'].includes(winningOutcome)) {
      return NextResponse.json({ error: 'Invalid outcome. Must be YES, NO, DRAW, or VOID' }, { status: 400 })
    }

    // Get market
    const market = await prisma.market.findUnique({
      where: { id: marketId }
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    // Only creator or admin can resolve
    if (market.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Only the market creator can resolve this market' }, { status: 403 })
    }

    if (market.status === 'RESOLVED') {
      return NextResponse.json({ error: 'Market already resolved' }, { status: 400 })
    }

    // Get all positions for this market
    const positions = await prisma.position.findMany({
      where: { marketId, isClosed: false }
    })

    // Calculate payouts
    const payouts: { userId: string; amount: number }[] = []

    if (winningOutcome === 'VOID') {
      // Refund all positions at cost basis
      for (const pos of positions) {
        const refund = pos.size * pos.averagePrice
        payouts.push({ userId: pos.userId, amount: refund })
      }
    } else {
      // Pay winners: winning shares pay out at 1.0 per share
      for (const pos of positions) {
        if (pos.outcome === winningOutcome) {
          payouts.push({ userId: pos.userId, amount: pos.size })
        }
        // Losers get nothing — their cost was already deducted
      }
    }

    // Execute resolution in a transaction
    await prisma.$transaction(async (tx) => {
      // Update market status
      await tx.market.update({
        where: { id: marketId },
        data: {
          status: 'RESOLVED',
          winningOutcome,
          resolvedAt: new Date()
        }
      })

      // Process payouts
      for (const payout of payouts) {
        await tx.user.update({
          where: { id: payout.userId },
          data: { balance: { increment: payout.amount } }
        })

        await tx.transaction.create({
          data: {
            type: 'TRADE',
            amount: payout.amount,
            description: winningOutcome === 'VOID'
              ? `Refund for voided market: ${market.title}`
              : `Payout for winning bet on ${market.title}`,
            status: 'COMPLETED',
            userId: payout.userId,
            metadata: JSON.stringify({ marketId, winningOutcome, type: 'PAYOUT' })
          }
        })
      }

      // Close all positions
      await tx.position.updateMany({
        where: { marketId },
        data: { isClosed: true }
      })
    })

    return NextResponse.json({
      success: true,
      winningOutcome,
      payoutsProcessed: payouts.length,
      totalPaidOut: payouts.reduce((sum, p) => sum + p.amount, 0)
    })
  } catch (error) {
    console.error('Error resolving market:', error)
    return NextResponse.json(
      { error: 'Failed to resolve market' },
      { status: 500 }
    )
  }
}
