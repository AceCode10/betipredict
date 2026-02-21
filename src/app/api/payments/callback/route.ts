import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mapAirtelStatus, verifyWebhookSignature } from '@/lib/airtel-money'
import { mapMtnStatus } from '@/lib/mtn-money'
import {
  settleDepositCompleted,
  settleDepositFailed,
  settleWithdrawalCompleted,
  settleWithdrawalFailed,
} from '@/lib/payment-settlement'

/**
 * Payment Provider Callback Webhook
 * 
 * Handles POST callbacks from both Airtel Money and MTN MoMo.
 * This is the AUTHORITATIVE settlement path — all financial mutations go
 * through the shared settlement module which uses atomic `settledAt` claims
 * to prevent double-settlement with the polling endpoint.
 *
 * Late callbacks (after local timeout/expiry) are still processed: we look
 * for payments that haven't been settled yet, regardless of local status.
 *
 * Provider detection:
 * - MTN sends X-Reference-Id header with the referenceId we provided
 * - Airtel sends x-signature / x-callback-signature headers
 */

// ─── MTN callback processing ────────────────────────────────
async function handleMtnCallback(body: any, referenceId: string): Promise<NextResponse> {
  console.log('[MTN Callback] Received:', JSON.stringify(body))

  // MTN callback body: { financialTransactionId, externalId, status, reason?, ... }
  const mtnStatus = body?.status || ''
  const financialTxnId = body?.financialTransactionId || ''
  const externalId = body?.externalId || referenceId
  const message = body?.reason?.message || ''

  // Find the payment by our reference ID (which was the X-Reference-Id)
  const mobilePayment = await prisma.mobilePayment.findFirst({
    where: {
      OR: [
        { externalRef: referenceId },
        { externalRef: externalId },
      ],
      settledAt: null,
    }
  })

  if (!mobilePayment) {
    console.warn('[MTN Callback] No matching unsettled payment found for ref:', referenceId)
    return NextResponse.json({ status: 'ok' })
  }

  const newStatus = mapMtnStatus(mtnStatus)
  const now = new Date()

  await prisma.mobilePayment.update({
    where: { id: mobilePayment.id },
    data: {
      status: newStatus,
      statusMessage: message || `MTN status: ${mtnStatus}`,
      externalId: financialTxnId || mobilePayment.externalId,
      callbackReceived: true,
      callbackData: JSON.stringify(body),
      completedAt: newStatus === 'COMPLETED' ? now : null,
    }
  })

  await settlePayment(mobilePayment.id, mobilePayment.type, newStatus, message)
  return NextResponse.json({ status: 'ok' })
}

// ─── Airtel callback processing ─────────────────────────────
async function handleAirtelCallback(body: any): Promise<NextResponse> {
  console.log('[Airtel Callback] Received (verified):', JSON.stringify(body))

  const transactionData = body?.transaction || body?.data?.transaction || {}
  const statusData = body?.status || body?.data?.status || {}
  
  const airtelId = transactionData.id || transactionData.airtel_money_id || ''
  const airtelStatus = transactionData.status_code || transactionData.status || statusData.result_code || ''
  const externalRef = transactionData.reference || transactionData.id || ''
  const message = transactionData.message || statusData.message || ''

  if (!externalRef && !airtelId) {
    console.error('[Airtel Callback] No reference or ID found in callback')
    return NextResponse.json({ status: 'ok' })
  }

  const mobilePayment = await prisma.mobilePayment.findFirst({
    where: {
      OR: [
        { externalRef: externalRef },
        ...(airtelId ? [{ externalId: airtelId }] : []),
      ],
      settledAt: null,
    }
  })

  if (!mobilePayment) {
    console.warn('[Airtel Callback] No matching unsettled payment found for ref:', externalRef)
    return NextResponse.json({ status: 'ok' })
  }

  const newStatus = mapAirtelStatus(airtelStatus)
  const now = new Date()

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

  await settlePayment(mobilePayment.id, mobilePayment.type, newStatus, message)
  return NextResponse.json({ status: 'ok' })
}

// ─── Shared settlement dispatcher ───────────────────────────
async function settlePayment(paymentId: string, type: string, status: string, message: string) {
  if (status === 'COMPLETED' && type === 'DEPOSIT') {
    await settleDepositCompleted(paymentId)
  } else if (status === 'COMPLETED' && type === 'WITHDRAWAL') {
    await settleWithdrawalCompleted(paymentId)
  } else if (status === 'FAILED' && type === 'DEPOSIT') {
    await settleDepositFailed(paymentId, message)
  } else if (status === 'FAILED' && type === 'WITHDRAWAL') {
    await settleWithdrawalFailed(paymentId, message)
  }
}

// ─── Main POST handler ──────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()

    // Detect provider from headers
    // MTN sends X-Reference-Id; Airtel sends x-signature / x-callback-signature
    const mtnReferenceId = request.headers.get('x-reference-id')
    const airtelSignature = request.headers.get('x-signature') || request.headers.get('x-callback-signature')

    const body = JSON.parse(rawBody)

    if (mtnReferenceId) {
      // ─── MTN MoMo callback ───
      return await handleMtnCallback(body, mtnReferenceId)
    } else {
      // ─── Airtel Money callback ───
      if (!verifyWebhookSignature(rawBody, airtelSignature)) {
        console.error('[Airtel Callback] Invalid webhook signature — rejecting request')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
      return await handleAirtelCallback(body)
    }
  } catch (error) {
    console.error('[Payment Callback] Error processing callback:', error)
    // Return 500 so provider retries the callback
    return NextResponse.json({ error: 'Internal processing error' }, { status: 500 })
  }
}
