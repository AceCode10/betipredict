import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyPayment, mapLencoStatus, isLencoConfigured } from '@/lib/lenco'
import { settleDepositCompleted, settleDepositFailed } from '@/lib/payment-settlement'

/**
 * GET /api/payments/lenco/verify?reference=BP-DEP-xxx
 * 
 * Verifies a payment with Lenco API and settles if completed.
 * Called by the frontend after the Lenco widget onSuccess callback.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isLencoConfigured()) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 })
    }

    const reference = request.nextUrl.searchParams.get('reference')
    if (!reference) {
      return NextResponse.json({ error: 'Reference required' }, { status: 400 })
    }

    // Find the payment
    const payment = await prisma.mobilePayment.findFirst({
      where: { externalRef: reference, userId: session.user.id }
    })
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // If already settled, return current status
    if (payment.settledAt) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id }, select: { balance: true }
      })
      return NextResponse.json({
        status: payment.status,
        amount: payment.amount,
        newBalance: user?.balance || 0,
        message: payment.status === 'COMPLETED'
          ? `K${payment.amount.toFixed(2)} deposited successfully`
          : payment.statusMessage || 'Payment already processed',
      })
    }

    // Verify with Lenco API
    let lencoData
    try {
      lencoData = await verifyPayment(reference)
    } catch (err: any) {
      console.error('[Lenco Verify] API error:', err.message)
      // Return current DB status if Lenco API fails
      return NextResponse.json({
        status: payment.status,
        amount: payment.amount,
        message: 'Verifying payment...',
      })
    }

    const newStatus = mapLencoStatus(lencoData.data.status)

    // Determine phone/card info for record
    let phoneInfo = payment.phoneNumber
    if (lencoData.data.mobileMoneyDetails?.phone) {
      phoneInfo = lencoData.data.mobileMoneyDetails.phone
    } else if (lencoData.data.cardDetails) {
      phoneInfo = `card-****${lencoData.data.cardDetails.last4}`
    }

    // Update payment record
    await prisma.mobilePayment.update({
      where: { id: payment.id },
      data: {
        status: newStatus,
        statusMessage: lencoData.data.reasonForFailure || lencoData.message,
        completedAt: newStatus === 'COMPLETED' ? new Date() : null,
        phoneNumber: phoneInfo,
        externalId: lencoData.data.lencoReference || null,
      }
    })

    // Settle if terminal state (settlement module handles idempotency via settledAt)
    if (newStatus === 'COMPLETED') {
      await settleDepositCompleted(payment.id)
    } else if (newStatus === 'FAILED') {
      await settleDepositFailed(payment.id, lencoData.data.reasonForFailure || undefined)
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id }, select: { balance: true }
    })

    return NextResponse.json({
      status: newStatus,
      amount: payment.amount,
      newBalance: user?.balance || 0,
      paymentType: lencoData.data.type,
      message: newStatus === 'COMPLETED'
        ? `K${payment.amount.toFixed(2)} deposited successfully`
        : newStatus === 'FAILED'
        ? lencoData.data.reasonForFailure || 'Payment failed'
        : 'Payment processing...',
    })
  } catch (error: any) {
    console.error('[Lenco Verify] Error:', error)
    return NextResponse.json({ error: 'Failed to verify payment' }, { status: 500 })
  }
}
