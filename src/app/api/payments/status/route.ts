import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkCollectionStatus as checkAirtelCollectionStatus,
  checkDisbursementStatus as checkAirtelDisbursementStatus,
  mapAirtelStatus,
  isAirtelMoneyConfigured,
} from '@/lib/airtel-money'
import {
  checkCollectionStatus as checkMtnCollectionStatus,
  checkDisbursementStatus as checkMtnDisbursementStatus,
  mapMtnStatus,
  isMtnMoneyConfigured,
} from '@/lib/mtn-money'
import {
  settleDepositCompleted,
  settleDepositFailed,
  settleWithdrawalCompleted,
  settleWithdrawalFailed,
} from '@/lib/payment-settlement'

/**
 * Check the status of a mobile payment.
 * Used by the frontend to poll for payment completion.
 *
 * This endpoint updates the MobilePayment record status from Airtel polling,
 * then delegates all financial settlement to the shared settlement module.
 * The settlement module uses atomic `settledAt` claims to prevent
 * double-settlement with the callback handler.
 *
 * GET /api/payments/status?paymentId=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const paymentId = searchParams.get('paymentId')

    if (!paymentId) {
      return NextResponse.json({ error: 'paymentId is required' }, { status: 400 })
    }

    // Find the payment (must belong to the current user)
    const payment = await prisma.mobilePayment.findFirst({
      where: {
        id: paymentId,
        userId: session.user.id,
      }
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // If payment is already in terminal state, return immediately
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(payment.status)) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { balance: true },
      })

      return NextResponse.json({
        paymentId: payment.id,
        status: payment.status,
        statusMessage: payment.statusMessage,
        amount: payment.amount,
        feeAmount: payment.feeAmount,
        netAmount: payment.netAmount,
        completedAt: payment.completedAt,
        newBalance: user?.balance || 0,
      })
    }

    // Check if expired — mark as FAILED and trigger settlement
    if (new Date() > payment.expiresAt) {
      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          statusMessage: 'Payment expired. Please try again.',
        }
      })

      // Delegate financial settlement to the shared module (handles refund + fee reversal atomically)
      if (payment.type === 'WITHDRAWAL') {
        await settleWithdrawalFailed(payment.id, 'Payment expired')
      } else if (payment.type === 'DEPOSIT') {
        await settleDepositFailed(payment.id, 'Payment expired')
      }

      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { balance: true },
      })

      return NextResponse.json({
        paymentId: payment.id,
        status: 'FAILED',
        statusMessage: 'Payment expired. Please try again.',
        newBalance: user?.balance || 0,
      })
    }

    // Poll the appropriate provider for status if we have an external ref and no callback yet
    if (payment.externalRef && !payment.callbackReceived) {
      let mappedStatus: string | null = null
      let statusMessage: string | null = null

      try {
        if (payment.provider === 'MTN_MOMO' && isMtnMoneyConfigured()) {
          // ─── MTN MoMo status polling ───
          const mtnResult = payment.type === 'DEPOSIT'
            ? await checkMtnCollectionStatus(payment.externalRef)
            : await checkMtnDisbursementStatus(payment.externalRef)

          mappedStatus = mapMtnStatus(mtnResult.status)
          statusMessage = mtnResult.reason?.message || ''
        } else if (payment.provider === 'AIRTEL_MONEY' && isAirtelMoneyConfigured()) {
          // ─── Airtel Money status polling ───
          const airtelResult = payment.type === 'DEPOSIT'
            ? await checkAirtelCollectionStatus(payment.externalRef)
            : await checkAirtelDisbursementStatus(payment.externalRef)

          const txnStatus = airtelResult.data?.transaction?.status
          if (txnStatus) {
            mappedStatus = mapAirtelStatus(txnStatus)
            statusMessage = airtelResult.data?.transaction?.message || ''
          }
        }

        // If we got a new status from the provider, process it
        if (mappedStatus && mappedStatus !== payment.status) {
          await prisma.mobilePayment.update({
            where: { id: payment.id },
            data: {
              status: mappedStatus,
              statusMessage: statusMessage || payment.statusMessage,
              completedAt: mappedStatus === 'COMPLETED' ? new Date() : null,
            }
          })

          // Delegate financial settlement to the shared module
          // The settlement module uses atomic settledAt claims — safe even if
          // callback also fires concurrently
          if (mappedStatus === 'COMPLETED' && payment.type === 'DEPOSIT') {
            await settleDepositCompleted(payment.id)
          } else if (mappedStatus === 'COMPLETED' && payment.type === 'WITHDRAWAL') {
            await settleWithdrawalCompleted(payment.id)
          } else if (mappedStatus === 'FAILED' && payment.type === 'DEPOSIT') {
            await settleDepositFailed(payment.id, statusMessage || undefined)
          } else if (mappedStatus === 'FAILED' && payment.type === 'WITHDRAWAL') {
            await settleWithdrawalFailed(payment.id, statusMessage || undefined)
          }

          // Get updated balance
          const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { balance: true },
          })

          return NextResponse.json({
            paymentId: payment.id,
            status: mappedStatus,
            statusMessage: statusMessage || '',
            amount: payment.amount,
            feeAmount: payment.feeAmount,
            netAmount: payment.netAmount,
            completedAt: mappedStatus === 'COMPLETED' ? new Date().toISOString() : null,
            newBalance: user?.balance || 0,
          })
        }
      } catch (err) {
        // Provider status check failed — return current DB status
        console.error(`[PaymentStatus] ${payment.provider} status check failed:`, err)
      }
    }

    // Return current status from DB
    return NextResponse.json({
      paymentId: payment.id,
      status: payment.status,
      statusMessage: payment.statusMessage || 'Waiting for confirmation...',
      amount: payment.amount,
      feeAmount: payment.feeAmount,
      netAmount: payment.netAmount,
    })
  } catch (error) {
    console.error('Error checking payment status:', error)
    return NextResponse.json({ error: 'Failed to check payment status' }, { status: 500 })
  }
}
