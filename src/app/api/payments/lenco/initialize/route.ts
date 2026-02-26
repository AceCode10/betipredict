import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FEES } from '@/lib/fees'
import { generateLencoRef, isLencoConfigured, getLencoPublicKey, initializeCollection } from '@/lib/lenco'
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
    const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
    const channel = typeof body.channel === 'string' ? body.channel : ''

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
    const maskedPhone = phoneNumber ? phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2') : 'via-lenco'
    const channels = channel === 'mobile-money' ? ['mobile-money'] : channel === 'card' ? ['card'] : ['card', 'mobile-money']

    // Create pending payment record
    const payment = await prisma.mobilePayment.create({
      data: {
        type: 'DEPOSIT',
        amount,
        feeAmount: 0,
        netAmount: amount,
        phoneNumber: maskedPhone,
        provider: 'LENCO',
        externalRef: reference,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min for card payments
        userId: session.user.id,
      }
    })

    const firstName = user.fullName?.split(' ')[0] || user.username || ''
    const lastName = user.fullName?.split(' ').slice(1).join(' ') || ''

    // Call Lenco API to initialize collection (get checkout URL)
    let checkoutUrl: string | null = null
    let lencoData: any = null
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://betipredict.com'
      lencoData = await initializeCollection({
        amount,
        email: user.email,
        reference,
        callbackUrl: `${baseUrl}?deposit=success`,
        phoneNumber: phoneNumber || undefined,
        channels,
        customer: { firstName, lastName },
      })
      checkoutUrl = lencoData?.data?.checkoutUrl || lencoData?.data?.authorization_url || lencoData?.data?.link || null

      // Update payment with external ID if provided
      if (lencoData?.data?.id) {
        await prisma.mobilePayment.update({
          where: { id: payment.id },
          data: { externalId: lencoData.data.id }
        })
      }
    } catch (err: any) {
      console.warn(`[Lenco] API initialize failed (widget fallback available):`, err.message)
      // Non-fatal: widget can still work without server-side initialization
    }

    console.log(`[Lenco] Initialized payment: K${amount} for user ${session.user.id}, ref: ${reference}${checkoutUrl ? ', checkoutUrl: ' + checkoutUrl : ''}`)

    return NextResponse.json({
      reference,
      paymentId: payment.id,
      publicKey: getLencoPublicKey(),
      amount,
      currency: 'ZMW',
      email: user.email,
      firstName,
      lastName,
      checkoutUrl,
    })
  } catch (error: any) {
    console.error('[Lenco Initialize] Error:', error)
    return NextResponse.json({ error: 'Failed to initialize payment' }, { status: 500 })
  }
}
