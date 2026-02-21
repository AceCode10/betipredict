import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateWithdrawalFee, FEES } from '@/lib/fees'
import {
  initiateDisbursement as airtelInitiateDisbursement,
  generateTransactionRef,
  isAirtelMoneyConfigured,
  normalizeZambianPhone,
  AirtelMoneyError,
} from '@/lib/airtel-money'
import {
  initiateDisbursement as mtnInitiateDisbursement,
  isMtnMoneyConfigured,
  normalizeMtnZambianPhone,
  generateMtnTransactionRef,
  MtnMoneyError,
} from '@/lib/mtn-money'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  getIdempotencyKeyFromRequest,
  scopeIdempotencyKey,
  checkIdempotencyKey,
  lockIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
} from '@/lib/idempotency'

export async function POST(request: NextRequest) {
  let idempotencyKey: string | null = null
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Idempotency check — prevent duplicate withdrawals (scoped by userId + route)
    const rawIdempotencyKey = getIdempotencyKeyFromRequest(request.headers)
    idempotencyKey = rawIdempotencyKey ? scopeIdempotencyKey(rawIdempotencyKey, session.user.id, 'withdraw') : null
    if (idempotencyKey) {
      const cached = await checkIdempotencyKey(idempotencyKey)
      if (cached === 'processing') {
        return NextResponse.json({ error: 'Request is already being processed' }, { status: 409 })
      }
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.status })
      }
      if (!(await lockIdempotencyKey(idempotencyKey))) {
        return NextResponse.json({ error: 'Duplicate request' }, { status: 409 })
      }
    }

    // Rate limit: 5 withdrawals per minute
    const rl = checkRateLimit(`withdraw:${session.user.id}`, 5, 60_000)
    if (!rl.allowed) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json(
        { error: 'Too many withdrawal attempts. Please wait.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const amount = Number(body.amount)
    const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
    const method = typeof body.method === 'string' ? body.method.slice(0, 50) : 'airtel_money'

    // Validate amount — release idempotency key on validation failures
    if (!Number.isFinite(amount) || amount <= 0) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: 'Invalid withdrawal amount' }, { status: 400 })
    }
    if (amount < FEES.WITHDRAW_MIN_AMOUNT) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: `Minimum withdrawal is K${FEES.WITHDRAW_MIN_AMOUNT}` }, { status: 400 })
    }
    if (amount > FEES.WITHDRAW_MAX_AMOUNT) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: `Maximum withdrawal is K${FEES.WITHDRAW_MAX_AMOUNT.toLocaleString()}` }, { status: 400 })
    }

    // Calculate withdrawal fee
    const fee = calculateWithdrawalFee(amount)

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })
    if (!user) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // User must have enough to cover the full withdrawal amount (fee is deducted from it)
    // Use small epsilon to prevent floating-point edge cases making balance slightly negative
    if (user.balance < amount || (user.balance - amount) < -0.001) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }

    // Daily withdrawal limit: K500,000 per 24 hours
    const DAILY_WITHDRAWAL_LIMIT = 500_000
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const recentWithdrawals = await prisma.mobilePayment.aggregate({
      where: {
        userId: session.user.id,
        type: 'WITHDRAWAL',
        status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
        createdAt: { gte: dayAgo },
      },
      _sum: { amount: true },
    })
    const dailyTotal = (recentWithdrawals._sum.amount || 0) + amount
    if (dailyTotal > DAILY_WITHDRAWAL_LIMIT) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      const remaining = Math.max(0, DAILY_WITHDRAWAL_LIMIT - (recentWithdrawals._sum.amount || 0))
      return NextResponse.json({
        error: `Daily withdrawal limit is K${DAILY_WITHDRAWAL_LIMIT.toLocaleString()}. You can withdraw up to K${remaining.toLocaleString()} more today.`
      }, { status: 400 })
    }

    // Validate phone number is required
    if (!phoneNumber) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: 'Phone number is required for mobile money withdrawals' }, { status: 400 })
    }

    const maskedPhone = phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    // Determine provider and validate phone
    let providerName: string
    let externalRef: string

    if (method === 'airtel_money') {
      if (!isAirtelMoneyConfigured()) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: 'Airtel Money is not configured. Please contact support.' }, { status: 503 })
      }
      try { normalizeZambianPhone(phoneNumber) } catch (e: any) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: e.message || 'Invalid phone number' }, { status: 400 })
      }
      providerName = 'AIRTEL_MONEY'
      externalRef = generateTransactionRef('WDR')
    } else if (method === 'mtn_money') {
      if (!isMtnMoneyConfigured()) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: 'MTN MoMo is not configured. Please contact support.' }, { status: 503 })
      }
      try { normalizeMtnZambianPhone(phoneNumber) } catch (e: any) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: e.message || 'Invalid phone number' }, { status: 400 })
      }
      providerName = 'MTN_MONEY'
      externalRef = generateMtnTransactionRef('WDR')
    } else {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: 'Unsupported payment method. Please use Airtel Money or MTN MoMo.' }, { status: 400 })
    }

    const providerLabel = method === 'airtel_money' ? 'Airtel Money' : 'MTN MoMo'

    // Deduct balance first (atomically), then initiate disbursement
    const result = await prisma.$transaction(async (tx) => {
      const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
      if (!freshUser || freshUser.balance < amount) {
        throw new Error('Insufficient balance')
      }

      const updatedUser = await tx.user.update({
        where: { id: session.user.id },
        data: { balance: { decrement: amount } }
      })

      const mobilePayment = await tx.mobilePayment.create({
        data: {
          type: 'WITHDRAWAL',
          amount: amount,
          feeAmount: fee.feeAmount,
          netAmount: fee.netAmount,
          phoneNumber: maskedPhone,
          provider: providerName,
          externalRef,
          status: 'PENDING',
          expiresAt,
          userId: session.user.id,
        }
      })

      const transaction = await tx.transaction.create({
        data: {
          type: 'WITHDRAWAL',
          amount: -amount,
          feeAmount: fee.feeAmount,
          description: `Withdrawal K${fee.netAmount.toFixed(2)} to ${providerLabel} ${maskedPhone} (fee: K${fee.feeAmount.toFixed(2)})`,
          status: 'PROCESSING',
          userId: session.user.id,
          metadata: JSON.stringify({
            method,
            phoneNumber: maskedPhone,
            grossAmount: amount,
            fee: fee.feeAmount,
            netAmount: fee.netAmount,
            externalRef,
            paymentId: mobilePayment.id,
          })
        }
      })

      if (fee.feeAmount > 0) {
        await tx.platformRevenue.create({
          data: {
            feeType: 'WITHDRAWAL_FEE',
            amount: fee.feeAmount,
            description: `Withdrawal fee from ${maskedPhone}`,
            sourceType: 'WITHDRAWAL',
            sourceId: mobilePayment.id,
            userId: session.user.id,
          }
        })
      }

      return { updatedUser, mobilePayment, transaction }
    })

    // Initiate disbursement (outside transaction to avoid long DB locks)
    try {
      let disbursementExternalId: string | null = null

      if (method === 'airtel_money') {
        const airtelResponse = await airtelInitiateDisbursement({
          phoneNumber,
          amount: Math.round(fee.netAmount),
          reference: externalRef,
        })
        disbursementExternalId = airtelResponse.data?.transaction?.id || null
      } else {
        const mtnResponse = await mtnInitiateDisbursement({
          phoneNumber,
          amount: Math.round(fee.netAmount),
          reference: externalRef,
        })
        disbursementExternalId = mtnResponse.referenceId || null
      }

      await prisma.mobilePayment.update({
        where: { id: result.mobilePayment.id },
        data: {
          externalId: disbursementExternalId,
          status: 'PROCESSING',
          statusMessage: `Disbursement initiated. Funds are being sent to your ${providerLabel}.`,
        }
      })

      const successBody = {
        success: true,
        paymentId: result.mobilePayment.id,
        externalRef,
        status: 'PROCESSING',
        newBalance: result.updatedUser.balance,
        grossAmount: amount,
        fee: fee.feeAmount,
        netAmount: fee.netAmount,
        message: `K${fee.netAmount.toFixed(2)} is being sent to your ${providerLabel} (${maskedPhone}). Fee: K${fee.feeAmount.toFixed(2)}.`,
      }
      if (idempotencyKey) await completeIdempotencyKey(idempotencyKey, 200, successBody)
      return NextResponse.json(successBody)
    } catch (err: any) {
      // Disbursement failed — refund the user's balance AND reverse the fee revenue
      console.error(`[Withdraw] ${providerLabel} disbursement failed, refunding user:`, err)
      
      const refundOps: any[] = [
        prisma.user.update({
          where: { id: session.user.id },
          data: { balance: { increment: amount } }
        }),
        prisma.mobilePayment.update({
          where: { id: result.mobilePayment.id },
          data: {
            status: 'FAILED',
            statusMessage: err.message || 'Disbursement failed',
            settledAt: new Date(), // Mark as settled to prevent double-refund from callback/poller
            completedAt: new Date(),
          }
        }),
        prisma.transaction.update({
          where: { id: result.transaction.id },
          data: { status: 'FAILED' }
        }),
      ]

      if (fee.feeAmount > 0) {
        refundOps.push(
          prisma.platformRevenue.create({
            data: {
              feeType: 'WITHDRAWAL_FEE_REVERSAL',
              amount: -fee.feeAmount,
              description: `Reversed withdrawal fee — disbursement failed for ${maskedPhone}`,
              sourceType: 'WITHDRAWAL',
              sourceId: result.mobilePayment.id,
              userId: session.user.id,
            }
          })
        )
      }

      await prisma.$transaction(refundOps)

      const errorMessage = (err instanceof AirtelMoneyError || err instanceof MtnMoneyError)
        ? err.message
        : `Failed to send ${providerLabel} withdrawal. Your balance has been refunded.`

      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: errorMessage }, { status: 502 })
    }
  } catch (error: any) {
    console.error('Error processing withdrawal:', error)
    if (idempotencyKey) {
      await releaseIdempotencyKey(idempotencyKey)
    }
    const message = error?.message === 'Insufficient balance'
      ? 'Insufficient balance'
      : 'Failed to process withdrawal'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
