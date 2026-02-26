import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FEES } from '@/lib/fees'
import { generateLencoRef, isLencoConfigured, getLencoPublicKey } from '@/lib/lenco'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/payments/lenco/initialize
 * 
 * Creates a pending payment record, calls Lenco API to initialize the collection,
 * and returns the reference + public key + checkout URL for the frontend.
 * Supports both popup widget and redirect-based payment flows.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isLencoConfigured()) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 })
    }

    // Rate limit: 10 initializations per minute
    const rl = checkRateLimit(`lenco-init:${session.user.id}`, 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many payment attempts. Please wait.' }, { status: 429 })
    }

    const body = await request.json()
    const amount = Number(body.amount)

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }
    if (amount < FEES.DEPOSIT_MIN_AMOUNT) {
      return NextResponse.json({ error: `Minimum deposit is K${FEES.DEPOSIT_MIN_AMOUNT}` }, { status: 400 })
    }
    if (amount > FEES.DEPOSIT_MAX_AMOUNT) {
      return NextResponse.json({ error: `Maximum deposit is K${FEES.DEPOSIT_MAX_AMOUNT.toLocaleString()}` }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const reference = generateLencoRef('DEP')

    // Create pending payment record (phone/card details collected by Lenco widget)
    const payment = await prisma.mobilePayment.create({
      data: {
        type: 'DEPOSIT',
        amount,
        feeAmount: 0,
        netAmount: amount,
        phoneNumber: 'via-lenco',
        provider: 'LENCO',
        externalRef: reference,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
        userId: session.user.id,
      }
    })

    const firstName = user.fullName?.split(' ')[0] || user.username || ''
    const lastName = user.fullName?.split(' ').slice(1).join(' ') || ''

    console.log(`[Lenco] Initialized payment: K${amount} for user ${session.user.id}, ref: ${reference}`)

    // Return reference + public key for the Lenco popup widget
    // The widget handles payment method selection, phone input, and card details
    return NextResponse.json({
      reference,
      paymentId: payment.id,
      publicKey: getLencoPublicKey(),
      amount,
      currency: 'ZMW',
      email: user.email || '',
      firstName,
      lastName,
    })
  } catch (error: any) {
    console.error('[Lenco Initialize] Error:', error)
    return NextResponse.json({ error: 'Failed to initialize payment' }, { status: 500 })
  }
}
