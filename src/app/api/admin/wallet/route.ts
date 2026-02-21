import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin-auth'
import { writeAuditLog } from '@/lib/audit'

/**
 * Admin Wallet Management API
 * 
 * GET  — List recent mobile payments (all users) for monitoring
 * POST — Adjust a user's balance (credit/debit) with audit trail
 */

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin()
    if (!session) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // PENDING, PROCESSING, COMPLETED, FAILED
    const type = searchParams.get('type') // DEPOSIT, WITHDRAWAL
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    const where: any = {}
    if (status) where.status = status
    if (type) where.type = type

    const payments = await prisma.mobilePayment.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, fullName: true, email: true, balance: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Summary stats
    const [totalDeposits, totalWithdrawals, pendingCount, processingCount] = await Promise.all([
      prisma.mobilePayment.aggregate({
        where: { type: 'DEPOSIT', status: 'COMPLETED' },
        _sum: { netAmount: true },
        _count: true,
      }),
      prisma.mobilePayment.aggregate({
        where: { type: 'WITHDRAWAL', status: 'COMPLETED' },
        _sum: { netAmount: true },
        _count: true,
      }),
      prisma.mobilePayment.count({ where: { status: 'PENDING' } }),
      prisma.mobilePayment.count({ where: { status: 'PROCESSING' } }),
    ])

    return NextResponse.json({
      payments,
      summary: {
        totalDeposited: totalDeposits._sum.netAmount || 0,
        depositCount: totalDeposits._count,
        totalWithdrawn: totalWithdrawals._sum.netAmount || 0,
        withdrawalCount: totalWithdrawals._count,
        pendingCount,
        processingCount,
      }
    })
  } catch (error) {
    console.error('[Admin Wallet] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin()
    if (!session) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { userId, amount, reason, type } = body

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }
    if (!amount || typeof amount !== 'number' || amount === 0) {
      return NextResponse.json({ error: 'Amount must be a non-zero number' }, { status: 400 })
    }
    if (!reason || typeof reason !== 'string' || reason.length < 3) {
      return NextResponse.json({ error: 'Reason is required (min 3 chars)' }, { status: 400 })
    }
    if (!type || !['CREDIT', 'DEBIT'].includes(type)) {
      return NextResponse.json({ error: 'Type must be CREDIT or DEBIT' }, { status: 400 })
    }

    const absAmount = Math.abs(amount)

    // Fetch user
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // For debits, check sufficient balance
    if (type === 'DEBIT' && user.balance < absAmount) {
      return NextResponse.json({
        error: `Insufficient balance. User has K${user.balance.toFixed(2)}, tried to debit K${absAmount.toFixed(2)}`
      }, { status: 400 })
    }

    // Atomic balance adjustment + transaction record
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          balance: type === 'CREDIT'
            ? { increment: absAmount }
            : { decrement: absAmount }
        }
      }),
      prisma.transaction.create({
        data: {
          type: 'ADMIN_ADJUSTMENT',
          amount: type === 'CREDIT' ? absAmount : -absAmount,
          description: `Admin ${type.toLowerCase()}: ${reason}`,
          status: 'COMPLETED',
          userId,
          metadata: JSON.stringify({
            adminId: session.user.id,
            adminEmail: session.user.email,
            reason,
            type,
          }),
        }
      }),
      prisma.notification.create({
        data: {
          userId,
          type: 'ADMIN_ADJUSTMENT',
          title: type === 'CREDIT' ? 'Balance Credited' : 'Balance Debited',
          message: type === 'CREDIT'
            ? `K${absAmount.toFixed(2)} has been added to your account by admin. Reason: ${reason}`
            : `K${absAmount.toFixed(2)} has been deducted from your account by admin. Reason: ${reason}`,
        }
      }),
    ])

    writeAuditLog({
      action: 'ADMIN_BALANCE_ADJUSTMENT',
      category: 'FINANCIAL',
      actorId: session.user.id,
      details: { userId, type, amount: absAmount, reason, newBalance: updatedUser.balance },
    })

    return NextResponse.json({
      success: true,
      userId,
      type,
      amount: absAmount,
      newBalance: updatedUser.balance,
    })
  } catch (error) {
    console.error('[Admin Wallet] Adjustment error:', error)
    return NextResponse.json({ error: 'Failed to adjust balance' }, { status: 500 })
  }
}
