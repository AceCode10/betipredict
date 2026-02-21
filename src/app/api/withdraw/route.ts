import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateWithdrawalFee, FEES } from '@/lib/fees'
import {
  initiateDisbursement,
  generateTransactionRef,
  isAirtelMoneyConfigured,
  normalizeZambianPhone,
  AirtelMoneyError,
} from '@/lib/airtel-money'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  getIdempotencyKeyFromRequest,
  checkIdempotencyKey,
  lockIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
} from '@/lib/idempotency'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Idempotency check — prevent duplicate withdrawals
    const idempotencyKey = getIdempotencyKeyFromRequest(request.headers)
    if (idempotencyKey) {
      const cached = checkIdempotencyKey(idempotencyKey)
      if (cached === 'processing') {
        return NextResponse.json({ error: 'Request is already being processed' }, { status: 409 })
      }
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.status })
      }
      if (!lockIdempotencyKey(idempotencyKey)) {
        return NextResponse.json({ error: 'Duplicate request' }, { status: 409 })
      }
    }

    // Rate limit: 5 withdrawals per minute
    const rl = checkRateLimit(`withdraw:${session.user.id}`, 5, 60_000)
    if (!rl.allowed) {
      if (idempotencyKey) releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json(
        { error: 'Too many withdrawal attempts. Please wait.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const amount = Number(body.amount)
    const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
    const method = typeof body.method === 'string' ? body.method.slice(0, 50) : 'airtel_money'

    // Validate amount
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid withdrawal amount' }, { status: 400 })
    }
    if (amount < FEES.WITHDRAW_MIN_AMOUNT) {
      return NextResponse.json({ error: `Minimum withdrawal is K${FEES.WITHDRAW_MIN_AMOUNT}` }, { status: 400 })
    }
    if (amount > FEES.WITHDRAW_MAX_AMOUNT) {
      return NextResponse.json({ error: `Maximum withdrawal is K${FEES.WITHDRAW_MAX_AMOUNT.toLocaleString()}` }, { status: 400 })
    }

    // Calculate withdrawal fee
    const fee = calculateWithdrawalFee(amount)

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // User must have enough to cover the full withdrawal amount (fee is deducted from it)
    if (user.balance < amount) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }

    // ─── Airtel Money Disbursement Flow ──────────────────────
    if (method === 'airtel_money' && isAirtelMoneyConfigured()) {
      if (!phoneNumber) {
        return NextResponse.json({ error: 'Phone number is required for Airtel Money withdrawals' }, { status: 400 })
      }

      let normalizedPhone: string
      try {
        normalizedPhone = normalizeZambianPhone(phoneNumber)
      } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Invalid phone number' }, { status: 400 })
      }

      const maskedPhone = phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')
      const externalRef = generateTransactionRef('WDR')
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

      // Deduct balance first (atomically), then initiate disbursement
      const result = await prisma.$transaction(async (tx) => {
        // Re-check balance inside transaction
        const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
        if (!freshUser || freshUser.balance < amount) {
          throw new Error('Insufficient balance')
        }

        // Deduct full amount from user balance
        const updatedUser = await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { decrement: amount } }
        })

        // Create mobile payment record
        const mobilePayment = await tx.mobilePayment.create({
          data: {
            type: 'WITHDRAWAL',
            amount: amount,
            feeAmount: fee.feeAmount,
            netAmount: fee.netAmount, // Amount user receives after fee
            phoneNumber: maskedPhone,
            provider: 'AIRTEL_MONEY',
            externalRef,
            status: 'PENDING',
            expiresAt,
            userId: session.user.id,
          }
        })

        // Create transaction record
        const transaction = await tx.transaction.create({
          data: {
            type: 'WITHDRAWAL',
            amount: -amount,
            feeAmount: fee.feeAmount,
            description: `Withdrawal K${fee.netAmount.toFixed(2)} to Airtel Money ${maskedPhone} (fee: K${fee.feeAmount.toFixed(2)})`,
            status: 'PROCESSING',
            userId: session.user.id,
            metadata: JSON.stringify({
              method: 'airtel_money',
              phoneNumber: maskedPhone,
              grossAmount: amount,
              fee: fee.feeAmount,
              netAmount: fee.netAmount,
              externalRef,
              paymentId: mobilePayment.id,
            })
          }
        })

        // Record platform revenue from withdrawal fee
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

      // Initiate Airtel Money disbursement (outside transaction to avoid long DB locks)
      try {
        const airtelResponse = await initiateDisbursement({
          phoneNumber,
          amount: Math.round(fee.netAmount), // Send net amount to user
          reference: externalRef,
        })

        // Update payment status
        await prisma.mobilePayment.update({
          where: { id: result.mobilePayment.id },
          data: {
            externalId: airtelResponse.data?.transaction?.id || null,
            status: 'PROCESSING',
            statusMessage: 'Disbursement initiated. Funds are being sent to your Airtel Money.',
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
          message: `K${fee.netAmount.toFixed(2)} is being sent to your Airtel Money (${maskedPhone}). Fee: K${fee.feeAmount.toFixed(2)}.`,
        }
        if (idempotencyKey) completeIdempotencyKey(idempotencyKey, 200, successBody)
        return NextResponse.json(successBody)
      } catch (err: any) {
        // Disbursement failed — refund the user's balance
        console.error('[Withdraw] Airtel disbursement failed, refunding user:', err)
        
        await prisma.$transaction([
          prisma.user.update({
            where: { id: session.user.id },
            data: { balance: { increment: amount } }
          }),
          prisma.mobilePayment.update({
            where: { id: result.mobilePayment.id },
            data: {
              status: 'FAILED',
              statusMessage: err.message || 'Disbursement failed',
            }
          }),
          prisma.transaction.update({
            where: { id: result.transaction.id },
            data: { status: 'FAILED' }
          })
        ])

        const errorMessage = err instanceof AirtelMoneyError
          ? err.message
          : 'Failed to send Airtel Money withdrawal. Your balance has been refunded.'

        return NextResponse.json({ error: errorMessage }, { status: 502 })
      }
    }

    // ─── Direct/Fallback Withdrawal (dev mode) ───────────────
    const [updatedUser, transaction] = await prisma.$transaction([
      prisma.user.update({
        where: { id: session.user.id },
        data: { balance: { decrement: amount } }
      }),
      prisma.transaction.create({
        data: {
          type: 'WITHDRAWAL',
          amount: -amount,
          feeAmount: fee.feeAmount,
          description: `Withdrawal K${fee.netAmount.toFixed(2)} via ${method} (fee: K${fee.feeAmount.toFixed(2)})`,
          status: 'COMPLETED',
          userId: session.user.id,
          metadata: JSON.stringify({ method, grossAmount: amount, fee: fee.feeAmount, netAmount: fee.netAmount })
        }
      })
    ])

    const directSuccessBody = {
      success: true,
      newBalance: updatedUser.balance,
      grossAmount: amount,
      fee: fee.feeAmount,
      netAmount: fee.netAmount,
      transaction: {
        id: transaction.id,
        amount: transaction.amount,
        type: transaction.type,
        status: transaction.status
      }
    }
    if (idempotencyKey) completeIdempotencyKey(idempotencyKey, 200, directSuccessBody)
    return NextResponse.json(directSuccessBody)
  } catch (error: any) {
    console.error('Error processing withdrawal:', error)
    const idempotencyKey = getIdempotencyKeyFromRequest(request.headers)
    if (idempotencyKey) releaseIdempotencyKey(idempotencyKey)
    const message = error?.message === 'Insufficient balance'
      ? 'Insufficient balance'
      : 'Failed to process withdrawal'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
