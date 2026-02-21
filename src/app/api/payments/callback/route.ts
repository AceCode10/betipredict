import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mapAirtelStatus, verifyWebhookSignature } from '@/lib/airtel-money'
import {
  settleDepositCompleted,
  settleDepositFailed,
  settleWithdrawalCompleted,
  settleWithdrawalFailed,
} from '@/lib/payment-settlement'

/**
 * Airtel Money Callback Webhook
 * 
 * Airtel sends POST requests here when a collection/disbursement completes.
 * This is the AUTHORITATIVE settlement path — all financial mutations go
 * through the shared settlement module which uses atomic `settledAt` claims
 * to prevent double-settlement with the polling endpoint.
 *
 * Late callbacks (after local timeout/expiry) are still processed: we look
 * for payments that haven't been settled yet, regardless of local status.
 */
export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await request.text()
    const signature = request.headers.get('x-signature') || request.headers.get('x-callback-signature')

    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[Airtel Callback] Invalid webhook signature — rejecting request')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    console.log('[Airtel Callback] Received (verified):', JSON.stringify(body))

    // Extract transaction details from Airtel callback
    const transactionData = body?.transaction || body?.data?.transaction || {}
    const statusData = body?.status || body?.data?.status || {}
    
    const airtelId = transactionData.id || transactionData.airtel_money_id || ''
    const airtelStatus = transactionData.status_code || transactionData.status || statusData.result_code || ''
    const externalRef = transactionData.reference || transactionData.id || ''
    const message = transactionData.message || statusData.message || ''

    if (!externalRef && !airtelId) {
      console.error('[Airtel Callback] No reference or ID found in callback')
      return NextResponse.json({ status: 'ok' }) // Return 200 to prevent retries
    }

    // Find the mobile payment — match ANY unsettled payment (not just PENDING/PROCESSING)
    // This handles late callbacks that arrive after local timeout/expiry
    let mobilePayment = await prisma.mobilePayment.findFirst({
      where: {
        OR: [
          { externalRef: externalRef },
          ...(airtelId ? [{ externalId: airtelId }] : []),
        ],
        settledAt: null, // Only process if not yet financially settled
      }
    })

    if (!mobilePayment) {
      console.warn('[Airtel Callback] No matching unsettled payment found for ref:', externalRef)
      return NextResponse.json({ status: 'ok' })
    }

    const newStatus = mapAirtelStatus(airtelStatus)
    const now = new Date()

    // Update the mobile payment record status
    await prisma.mobilePayment.update({
      where: { id: mobilePayment.id },
      data: {
        status: newStatus,
        statusMessage: message,
        externalId: airtelId || mobilePayment.externalId,
        callbackReceived: true,
        callbackData: JSON.stringify(body),
        completedAt: newStatus === 'COMPLETED' ? now : null,
      }
    })

    // Delegate all financial mutations to the settlement module
    // The settlement module uses atomic settledAt claims to prevent double-settlement
    if (newStatus === 'COMPLETED' && mobilePayment.type === 'DEPOSIT') {
      await settleDepositCompleted(mobilePayment.id)
    } else if (newStatus === 'COMPLETED' && mobilePayment.type === 'WITHDRAWAL') {
      await settleWithdrawalCompleted(mobilePayment.id)
    } else if (newStatus === 'FAILED' && mobilePayment.type === 'DEPOSIT') {
      await settleDepositFailed(mobilePayment.id, message)
    } else if (newStatus === 'FAILED' && mobilePayment.type === 'WITHDRAWAL') {
      await settleWithdrawalFailed(mobilePayment.id, message)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[Airtel Callback] Error processing callback:', error)
    // Return 500 so Airtel retries the callback — we must not silently swallow errors
    // that could leave payments in an inconsistent state
    return NextResponse.json({ error: 'Internal processing error' }, { status: 500 })
  }
}
