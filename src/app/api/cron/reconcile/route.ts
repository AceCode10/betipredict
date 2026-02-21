import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkCollectionStatus, checkDisbursementStatus, mapAirtelStatus, isAirtelMoneyConfigured } from '@/lib/airtel-money'
import { writeAuditLog } from '@/lib/audit'
import { MarketResolver } from '@/lib/market-resolution'
import crypto from 'crypto'

/**
 * Payment Reconciliation Cron Job
 * 
 * Runs periodically to:
 * 1. Expire stuck PENDING/PROCESSING payments past their expiry time
 * 2. Poll Airtel Money for status of in-flight payments
 * 3. Refund users for failed/expired withdrawals
 * 4. Auto-finalize markets past their dispute window
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
    refundedWithdrawals: 0,
    finalizedMarkets: 0,
    errors: [] as string[],
  }

  try {
    // ─── 1. Expire stuck payments ────────────────────────────
    const expiredPayments = await prisma.mobilePayment.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        expiresAt: { lt: new Date() },
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

        // Refund user for expired withdrawals
        if (payment.type === 'WITHDRAWAL') {
          await prisma.$transaction([
            prisma.user.update({
              where: { id: payment.userId },
              data: { balance: { increment: payment.amount } }
            }),
            prisma.transaction.updateMany({
              where: {
                userId: payment.userId,
                status: 'PROCESSING',
                metadata: { contains: payment.externalRef },
              },
              data: { status: 'FAILED' }
            }),
            prisma.notification.create({
              data: {
                type: 'WITHDRAW',
                title: 'Withdrawal Expired',
                message: `Your withdrawal of K${payment.netAmount.toFixed(2)} expired. K${payment.amount.toFixed(2)} has been refunded.`,
                userId: payment.userId,
              }
            }),
          ])
          summary.refundedWithdrawals++
        }

        // Notify user for expired deposits
        if (payment.type === 'DEPOSIT') {
          await prisma.notification.create({
            data: {
              type: 'DEPOSIT',
              title: 'Deposit Expired',
              message: `Your Airtel Money deposit of K${payment.amount.toFixed(2)} expired. Please try again.`,
              userId: payment.userId,
            }
          })
        }

        summary.expiredPayments++
      } catch (err: any) {
        summary.errors.push(`Expire payment ${payment.id}: ${err.message}`)
      }
    }

    // ─── 2. Poll Airtel for in-flight payments ───────────────
    if (isAirtelMoneyConfigured()) {
      const inFlightPayments = await prisma.mobilePayment.findMany({
        where: {
          status: 'PROCESSING',
          expiresAt: { gt: new Date() },
          callbackReceived: false,
        },
        take: 20, // Limit to avoid API rate limits
      })

      for (const payment of inFlightPayments) {
        try {
          const statusResponse = payment.type === 'DEPOSIT'
            ? await checkCollectionStatus(payment.externalRef)
            : await checkDisbursementStatus(payment.externalRef)

          const newStatus = mapAirtelStatus(statusResponse.data?.transaction?.status || '')

          if (newStatus !== 'PROCESSING' && newStatus !== 'PENDING') {
            // Status has changed — update
            await prisma.mobilePayment.update({
              where: { id: payment.id },
              data: {
                status: newStatus,
                statusMessage: statusResponse.data?.transaction?.message || '',
                externalId: statusResponse.data?.transaction?.airtel_money_id || payment.externalId,
                completedAt: newStatus === 'COMPLETED' ? new Date() : null,
              }
            })

            // Handle completed deposits
            if (newStatus === 'COMPLETED' && payment.type === 'DEPOSIT') {
              await prisma.$transaction([
                prisma.user.update({
                  where: { id: payment.userId },
                  data: { balance: { increment: payment.netAmount } }
                }),
                prisma.transaction.create({
                  data: {
                    type: 'DEPOSIT',
                    amount: payment.netAmount,
                    feeAmount: payment.feeAmount,
                    description: `Deposit K${payment.netAmount.toFixed(2)} via Airtel Money (reconciled)`,
                    status: 'COMPLETED',
                    userId: payment.userId,
                    metadata: JSON.stringify({ method: 'airtel_money', paymentId: payment.id, reconciled: true }),
                  }
                }),
              ])
            }

            // Handle failed withdrawals — refund
            if (newStatus === 'FAILED' && payment.type === 'WITHDRAWAL') {
              await prisma.$transaction([
                prisma.user.update({
                  where: { id: payment.userId },
                  data: { balance: { increment: payment.amount } }
                }),
                prisma.transaction.updateMany({
                  where: {
                    userId: payment.userId,
                    status: 'PROCESSING',
                    metadata: { contains: payment.externalRef },
                  },
                  data: { status: 'FAILED' }
                }),
              ])
              summary.refundedWithdrawals++
            }
          }

          summary.polledPayments++
        } catch (err: any) {
          summary.errors.push(`Poll payment ${payment.id}: ${err.message}`)
        }
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
