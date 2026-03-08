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
 * Creates a pending payment record and calls Lenco API to initialize collection.
 * 
 * For mobile-money: Lenco sends a USSD push to the user's phone.
 * For card: Returns checkout URL + popup widget fallback data.
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
    const channel: string = body.channel || 'mobile-money' // 'mobile-money' or 'card'
    const phoneNumber: string = (body.phoneNumber || '').trim()

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }
    if (amount < FEES.DEPOSIT_MIN_AMOUNT) {
      return NextResponse.json({ error: `Minimum deposit is K${FEES.DEPOSIT_MIN_AMOUNT}` }, { status: 400 })
    }
    if (amount > FEES.DEPOSIT_MAX_AMOUNT) {
      return NextResponse.json({ error: `Maximum deposit is K${FEES.DEPOSIT_MAX_AMOUNT.toLocaleString()}` }, { status: 400 })
    }

    // Phone required for mobile money
    if (channel === 'mobile-money') {
      if (!phoneNumber) {
        return NextResponse.json({ error: 'Phone number is required for mobile money' }, { status: 400 })
      }
      const digits = phoneNumber.replace(/\D/g, '')
      if (digits.length < 9 || digits.length > 13) {
        return NextResponse.json({ error: 'Please enter a valid Zambian phone number' }, { status: 400 })
      }
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const reference = generateLencoRef('DEP')
    const firstName = user.fullName?.split(' ')[0] || user.username || ''
    const lastName = user.fullName?.split(' ').slice(1).join(' ') || ''

    // Create pending payment record
    const payment = await prisma.mobilePayment.create({
      data: {
        type: 'DEPOSIT',
        amount,
        feeAmount: 0,
        netAmount: amount,
        phoneNumber: channel === 'mobile-money' ? phoneNumber : 'card-payment',
        provider: 'LENCO',
        externalRef: reference,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
        userId: session.user.id,
      }
    })

    // Call Lenco server-side API to initialize collection
    try {
      const lencoRes = await initializeCollection({
        amount,
        email: user.email || '',
        reference,
        channels: [channel],
        phoneNumber: channel === 'mobile-money' ? phoneNumber : undefined,
        customer: { firstName, lastName },
      })

      console.log(`[Lenco] Initialized ${channel} payment: K${amount} for user ${session.user.id}, ref: ${reference}`)

      if (channel === 'mobile-money') {
        // Mobile money: USSD push sent to phone, frontend polls for result
        return NextResponse.json({
          reference,
          paymentId: payment.id,
          amount,
          channel: 'mobile-money',
          message: 'A payment prompt has been sent to your phone. Please enter your PIN to confirm.',
        })
      } else {
        // Card: return checkout URL + popup widget fallback data
        const checkoutUrl = lencoRes?.data?.authorization_url || lencoRes?.data?.checkout_url || null
        return NextResponse.json({
          reference,
          paymentId: payment.id,
          publicKey: getLencoPublicKey(),
          amount,
          channel: 'card',
          checkoutUrl,
          currency: 'ZMW',
          email: user.email || '',
          firstName,
          lastName,
        })
      }
    } catch (apiErr: any) {
      console.error('[Lenco Initialize] Lenco API error:', apiErr.message)
      // Mark payment as failed since Lenco rejected it
      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', statusMessage: apiErr.message || 'Provider error' }
      }).catch(() => {})
      return NextResponse.json(
        { error: apiErr.message || 'Payment provider error. Please try again.' },
        { status: 502 }
      )
    }
  } catch (error: any) {
    console.error('[Lenco Initialize] Error:', error)
    return NextResponse.json({ error: 'Failed to initialize payment' }, { status: 500 })
  }
}
