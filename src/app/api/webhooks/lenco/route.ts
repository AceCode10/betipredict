import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature, mapLencoStatus } from '@/lib/lenco'
import {
  settleDepositCompleted,
  settleDepositFailed,
  settleWithdrawalCompleted,
  settleWithdrawalFailed,
} from '@/lib/payment-settlement'

/**
 * POST /api/webhooks/lenco
 * 
 * Handles webhook events from Lenco (payment completions, failures, etc.)
 * This is the authoritative source for payment status — always trust webhooks over polling.
 * 
 * Events handled:
 * - collection.successful — Deposit completed (mobile money or card)
 * - collection.failed — Deposit failed
 * - transaction.successful — Withdrawal/disbursement completed
 * - transaction.failed — Withdrawal/disbursement failed
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-lenco-signature')

    // Verify webhook authenticity
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[Lenco Webhook] Invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(rawBody)
    const eventType = event.event || event.type || ''
    console.log(`[Lenco Webhook] Event: ${eventType}`, JSON.stringify(event.data?.reference || event.data?.id || ''))

    // ─── Collection Successful (Deposit completed) ────────────────
    if (eventType === 'collection.successful') {
      const reference = event.data?.reference
      if (!reference) {
        console.warn('[Lenco Webhook] collection.successful without reference')
        return NextResponse.json({ status: 'ok' })
      }

      const payment = await prisma.mobilePayment.findFirst({
        where: { externalRef: reference, settledAt: null }
      })
      if (!payment) {
        console.log(`[Lenco Webhook] Payment already settled or not found: ${reference}`)
        return NextResponse.json({ status: 'ok' })
      }

      // Determine phone/card info
      let phoneInfo = payment.phoneNumber
      if (event.data?.mobileMoneyDetails?.phone) {
        phoneInfo = event.data.mobileMoneyDetails.phone
      } else if (event.data?.cardDetails) {
        phoneInfo = `card-****${event.data.cardDetails.last4}`
      }

      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          callbackReceived: true,
          callbackData: rawBody,
          phoneNumber: phoneInfo,
          externalId: event.data?.lencoReference || null,
        }
      })

      if (payment.type === 'DEPOSIT') {
        await settleDepositCompleted(payment.id)
        console.log(`[Lenco Webhook] Deposit settled: K${payment.amount} ref:${reference}`)
      }
    }

    // ─── Collection Failed (Deposit failed) ────────────────────────
    if (eventType === 'collection.failed') {
      const reference = event.data?.reference
      if (!reference) return NextResponse.json({ status: 'ok' })

      const payment = await prisma.mobilePayment.findFirst({
        where: { externalRef: reference, settledAt: null }
      })
      if (!payment) return NextResponse.json({ status: 'ok' })

      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          callbackReceived: true,
          callbackData: rawBody,
          statusMessage: event.data?.reasonForFailure || 'Payment failed',
        }
      })

      if (payment.type === 'DEPOSIT') {
        await settleDepositFailed(payment.id, event.data?.reasonForFailure)
        console.log(`[Lenco Webhook] Deposit failed: ref:${reference}`)
      }
    }

    // ─── Transaction Successful (Withdrawal completed) ─────────────
    if (eventType === 'transaction.successful' && event.data?.type === 'debit') {
      const clientRef = event.data?.clientReference || event.data?.reference
      if (!clientRef) return NextResponse.json({ status: 'ok' })

      const payment = await prisma.mobilePayment.findFirst({
        where: { externalRef: clientRef, settledAt: null }
      })
      if (!payment) return NextResponse.json({ status: 'ok' })

      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          callbackReceived: true,
          callbackData: rawBody,
        }
      })

      if (payment.type === 'WITHDRAWAL') {
        await settleWithdrawalCompleted(payment.id)
        console.log(`[Lenco Webhook] Withdrawal settled: K${payment.netAmount} ref:${clientRef}`)
      }
    }

    // ─── Transaction Failed (Withdrawal failed) ────────────────────
    if (eventType === 'transaction.failed' && event.data?.type === 'debit') {
      const clientRef = event.data?.clientReference || event.data?.reference
      if (!clientRef) return NextResponse.json({ status: 'ok' })

      const payment = await prisma.mobilePayment.findFirst({
        where: { externalRef: clientRef, settledAt: null }
      })
      if (!payment) return NextResponse.json({ status: 'ok' })

      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          callbackReceived: true,
          callbackData: rawBody,
          statusMessage: event.data?.reasonForFailure || 'Transaction failed',
        }
      })

      if (payment.type === 'WITHDRAWAL') {
        await settleWithdrawalFailed(payment.id, event.data?.reasonForFailure)
        console.log(`[Lenco Webhook] Withdrawal failed: ref:${clientRef}`)
      }
    }

    // Always respond 200 to acknowledge receipt
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[Lenco Webhook] Error:', error)
    // Still return 200 to prevent Lenco from retrying indefinitely
    return NextResponse.json({ error: 'Processing error' }, { status: 200 })
  }
}
