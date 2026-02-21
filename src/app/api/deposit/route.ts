import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FEES } from '@/lib/fees'
import {
  initiateCollection as airtelInitiateCollection,
  generateTransactionRef,
  isAirtelMoneyConfigured,
  normalizeZambianPhone,
  AirtelMoneyError,
} from '@/lib/airtel-money'
import {
  initiateCollection as mtnInitiateCollection,
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

    // Idempotency check — prevent duplicate deposits (scoped by userId + route)
    const rawIdempotencyKey = getIdempotencyKeyFromRequest(request.headers)
    idempotencyKey = rawIdempotencyKey ? scopeIdempotencyKey(rawIdempotencyKey, session.user.id, 'deposit') : null
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

    // Rate limit: 10 deposits per minute
    const rl = checkRateLimit(`deposit:${session.user.id}`, 10, 60_000)
    if (!rl.allowed) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json(
        { error: 'Too many deposit attempts. Please wait.' },
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
      return NextResponse.json({ error: 'Invalid deposit amount' }, { status: 400 })
    }
    if (amount < FEES.DEPOSIT_MIN_AMOUNT) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: `Minimum deposit is K${FEES.DEPOSIT_MIN_AMOUNT}` }, { status: 400 })
    }
    if (amount > FEES.DEPOSIT_MAX_AMOUNT) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: `Maximum deposit is K${FEES.DEPOSIT_MAX_AMOUNT.toLocaleString()}` }, { status: 400 })
    }

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })
    if (!user) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Validate phone number is required for all mobile money deposits
    if (!phoneNumber) {
      if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
      return NextResponse.json({ error: 'Phone number is required for mobile money deposits' }, { status: 400 })
    }

    // Mask phone for storage (097****567)
    const maskedPhone = phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minute expiry

    // ─── Airtel Money Flow ───────────────────────────────────────
    if (method === 'airtel_money') {
      if (!isAirtelMoneyConfigured()) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: 'Airtel Money is not configured. Please contact support.' }, { status: 503 })
      }

      let normalizedPhone: string
      try {
        normalizedPhone = normalizeZambianPhone(phoneNumber)
      } catch (e: any) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: e.message || 'Invalid phone number' }, { status: 400 })
      }

      const externalRef = generateTransactionRef('DEP')

      const mobilePayment = await prisma.mobilePayment.create({
        data: {
          type: 'DEPOSIT',
          amount: amount,
          feeAmount: 0,
          netAmount: amount,
          phoneNumber: maskedPhone,
          provider: 'AIRTEL_MONEY',
          externalRef,
          status: 'PENDING',
          expiresAt,
          userId: session.user.id,
        }
      })

      try {
        const airtelResponse = await airtelInitiateCollection({
          phoneNumber,
          amount: Math.round(amount),
          reference: externalRef,
        })

        await prisma.mobilePayment.update({
          where: { id: mobilePayment.id },
          data: {
            externalId: airtelResponse.data?.transaction?.id || null,
            status: 'PROCESSING',
            statusMessage: 'USSD prompt sent to your phone. Please confirm.',
          }
        })

        const successBody = {
          success: true,
          paymentId: mobilePayment.id,
          externalRef,
          status: 'PROCESSING',
          message: 'A payment prompt has been sent to your Airtel Money. Please enter your PIN to confirm.',
          expiresAt: expiresAt.toISOString(),
        }
        if (idempotencyKey) await completeIdempotencyKey(idempotencyKey, 200, successBody)
        return NextResponse.json(successBody)
      } catch (err: any) {
        await prisma.mobilePayment.update({
          where: { id: mobilePayment.id },
          data: {
            status: 'FAILED',
            statusMessage: err.message || 'Failed to initiate payment',
          }
        })

        const errorMessage = err instanceof AirtelMoneyError
          ? err.message
          : 'Failed to initiate Airtel Money payment. Please try again.'
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: errorMessage }, { status: 502 })
      }
    }

    // ─── MTN MoMo Flow ───────────────────────────────────────────
    if (method === 'mtn_money') {
      if (!isMtnMoneyConfigured()) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: 'MTN MoMo is not configured. Please contact support.' }, { status: 503 })
      }

      let normalizedPhone: string
      try {
        normalizedPhone = normalizeMtnZambianPhone(phoneNumber)
      } catch (e: any) {
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: e.message || 'Invalid phone number' }, { status: 400 })
      }

      const externalRef = generateMtnTransactionRef('DEP')

      const mobilePayment = await prisma.mobilePayment.create({
        data: {
          type: 'DEPOSIT',
          amount: amount,
          feeAmount: 0,
          netAmount: amount,
          phoneNumber: maskedPhone,
          provider: 'MTN_MONEY',
          externalRef,
          status: 'PENDING',
          expiresAt,
          userId: session.user.id,
        }
      })

      try {
        const mtnResponse = await mtnInitiateCollection({
          phoneNumber,
          amount: Math.round(amount),
          reference: externalRef,
        })

        await prisma.mobilePayment.update({
          where: { id: mobilePayment.id },
          data: {
            externalId: mtnResponse.referenceId || null,
            status: 'PROCESSING',
            statusMessage: 'Payment prompt sent to your phone. Please confirm.',
          }
        })

        const successBody = {
          success: true,
          paymentId: mobilePayment.id,
          externalRef,
          status: 'PROCESSING',
          message: 'A payment prompt has been sent to your MTN MoMo. Please enter your PIN to confirm.',
          expiresAt: expiresAt.toISOString(),
        }
        if (idempotencyKey) await completeIdempotencyKey(idempotencyKey, 200, successBody)
        return NextResponse.json(successBody)
      } catch (err: any) {
        await prisma.mobilePayment.update({
          where: { id: mobilePayment.id },
          data: {
            status: 'FAILED',
            statusMessage: err.message || 'Failed to initiate payment',
          }
        })

        const errorMessage = err instanceof MtnMoneyError
          ? err.message
          : 'Failed to initiate MTN MoMo payment. Please try again.'
        if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
        return NextResponse.json({ error: errorMessage }, { status: 502 })
      }
    }

    // ─── Unsupported method ──────────────────────────────────────
    if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
    return NextResponse.json({ error: 'Unsupported payment method. Please use Airtel Money or MTN MoMo.' }, { status: 400 })
  } catch (error) {
    console.error('Error processing deposit:', error)
    if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey)
    return NextResponse.json(
      { error: 'Failed to process deposit' },
      { status: 500 }
    )
  }
}
