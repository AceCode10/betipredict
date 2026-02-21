import { NextRequest, NextResponse } from 'next/server'
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
import { writeAuditLog } from '@/lib/audit'
import { MarketResolver } from '@/lib/market-resolution'
import crypto from 'crypto'

/**
 * Payment Reconciliation Cron Job
 * 
 * Runs periodically to:
 * 1. Expire stuck PENDING/PROCESSING payments past their expiry time
 *    — delegates to settlement module for refunds (no direct balance mutations)
 * 2. Poll Airtel Money & MTN MoMo for status of in-flight payments
 *    — delegates to settlement module for financial mutations
 * 3. Auto-finalize markets past their dispute window
 * 
 * Security: requires CRON_SECRET header
 */

const CRON_SECRET = process.env.CRON_SECRET || ''

function verifyCronAuth(request: NextRequest): boolean {
  if (!CRON_SECRET) return false
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(CRON_SECRET))
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = {
    expiredPayments: 0,
    polledPayments: 0,
    settledPayments: 0,
    finalizedMarkets: 0,
    errors: [] as string[],
  }

  try {
    // ─── 1. Expire stuck payments ────────────────────────────
    // Mark expired, then delegate financial settlement to the shared module
    const expiredPayments = await prisma.mobilePayment.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        expiresAt: { lt: new Date() },
        settledAt: null,
      }
    })

    for (const payment of expiredPayments) {
      try {
        await prisma.mobilePayment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            statusMessage: 'Payment expired — no response received',
          }
        })

        // Delegate to settlement module — it handles refunds, fee reversals,
        // notifications, and uses atomic settledAt to prevent double-settlement
        if (payment.type === 'WITHDRAWAL') {
          await settleWithdrawalFailed(payment.id, 'Payment expired')
        } else if (payment.type === 'DEPOSIT') {
          await settleDepositFailed(payment.id, 'Payment expired')
        }

        summary.expiredPayments++
      } catch (err: any) {
        summary.errors.push(`Expire payment ${payment.id}: ${err.message}`)
      }
    }

    // ─── 2. Poll providers for in-flight payments ────────────
    const inFlightPayments = await prisma.mobilePayment.findMany({
      where: {
        status: 'PROCESSING',
        expiresAt: { gt: new Date() },
        callbackReceived: false,
        settledAt: null,
      },
      take: 20,
    })

    for (const payment of inFlightPayments) {
      try {
        let mappedStatus: string | null = null
        let statusMessage = ''
        let externalTxnId: string | null = null

        if (payment.provider === 'MTN_MOMO' && isMtnMoneyConfigured()) {
          // ─── MTN MoMo status polling ───
          const result = payment.type === 'DEPOSIT'
            ? await checkMtnCollectionStatus(payment.externalRef)
            : await checkMtnDisbursementStatus(payment.externalRef)

          mappedStatus = mapMtnStatus(result.status)
          statusMessage = result.reason?.message || ''
          externalTxnId = result.financialTransactionId || null
        } else if (payment.provider === 'AIRTEL_MONEY' && isAirtelMoneyConfigured()) {
          // ─── Airtel Money status polling ───
          const result = payment.type === 'DEPOSIT'
            ? await checkAirtelCollectionStatus(payment.externalRef)
            : await checkAirtelDisbursementStatus(payment.externalRef)

          const txnStatus = result.data?.transaction?.status || ''
          mappedStatus = mapAirtelStatus(txnStatus)
          statusMessage = result.data?.transaction?.message || ''
          externalTxnId = result.data?.transaction?.airtel_money_id || null
        }

        if (mappedStatus && mappedStatus !== 'PROCESSING' && mappedStatus !== 'PENDING') {
          // Status has changed — update the record
          await prisma.mobilePayment.update({
            where: { id: payment.id },
            data: {
              status: mappedStatus,
              statusMessage,
              externalId: externalTxnId || payment.externalId,
              completedAt: mappedStatus === 'COMPLETED' ? new Date() : null,
            }
          })

          // Delegate financial settlement to the shared module
          if (mappedStatus === 'COMPLETED' && payment.type === 'DEPOSIT') {
            await settleDepositCompleted(payment.id)
          } else if (mappedStatus === 'COMPLETED' && payment.type === 'WITHDRAWAL') {
            await settleWithdrawalCompleted(payment.id)
          } else if (mappedStatus === 'FAILED' && payment.type === 'DEPOSIT') {
            await settleDepositFailed(payment.id, statusMessage)
          } else if (mappedStatus === 'FAILED' && payment.type === 'WITHDRAWAL') {
            await settleWithdrawalFailed(payment.id, statusMessage)
          }

          summary.settledPayments++
        }

        summary.polledPayments++
      } catch (err: any) {
        summary.errors.push(`Poll payment ${payment.id}: ${err.message}`)
      }
    }

    // ─── 3. Auto-finalize markets past dispute window ────────
    try {
      const marketsToFinalize = await prisma.market.findMany({
        where: {
          status: 'RESOLVED',
          disputeDeadline: { lte: new Date() },
        }
      })

      for (const market of marketsToFinalize) {
        try {
          await MarketResolver.finalizeMarket(market.id)
          summary.finalizedMarkets++
        } catch (err: any) {
          summary.errors.push(`Finalize market ${market.id}: ${err.message}`)
        }
      }
    } catch (err: any) {
      summary.errors.push(`Market finalization: ${err.message}`)
    }

    // Audit log
    writeAuditLog({
      action: 'CRON_RECONCILIATION',
      category: 'SYSTEM',
      details: summary,
    })

    return NextResponse.json({
      success: true,
      ...summary,
    })
  } catch (error: any) {
    console.error('[Cron Reconcile] Error:', error)
    return NextResponse.json({ error: 'Reconciliation failed', message: error.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
