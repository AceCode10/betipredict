/**
 * Payment Settlement Module
 * 
 * Single source of truth for all financial mutations related to mobile payments.
 * Uses `settledAt` as an atomic guard to prevent double-settlement.
 * 
 * Both the callback handler and status poller call these functions,
 * but only the first caller wins (settledAt check + atomic update).
 */

import { prisma } from './prisma'

interface SettlementResult {
  settled: boolean
  alreadySettled: boolean
  error?: string
}

/** Map provider code to user-friendly name */
function providerLabel(provider: string): string {
  switch (provider) {
    case 'MTN_MOMO': return 'MTN MoMo'
    case 'AIRTEL_MONEY': return 'Airtel Money'
    default: return provider
  }
}

/** Map provider code to metadata method key */
function providerMethod(provider: string): string {
  switch (provider) {
    case 'MTN_MOMO': return 'mtn_momo'
    case 'AIRTEL_MONEY': return 'airtel_money'
    default: return provider.toLowerCase()
  }
}

/**
 * Atomically claim settlement rights for a payment.
 * Returns the payment if we won the claim, null if already settled.
 */
async function claimSettlement(paymentId: string) {
  try {
    // Atomic: only update if settledAt is still null
    const payment = await prisma.mobilePayment.updateMany({
      where: { id: paymentId, settledAt: null },
      data: { settledAt: new Date() },
    })
    return payment.count > 0
  } catch {
    return false
  }
}

/**
 * Settle a successful deposit: credit user balance, create transaction + notification.
 */
export async function settleDepositCompleted(paymentId: string): Promise<SettlementResult> {
  const payment = await prisma.mobilePayment.findUnique({ where: { id: paymentId } })
  if (!payment) return { settled: false, alreadySettled: false, error: 'Payment not found' }
  if (payment.settledAt) return { settled: false, alreadySettled: true }
  if (payment.type !== 'DEPOSIT') return { settled: false, alreadySettled: false, error: 'Not a deposit' }

  // Claim settlement atomically
  const claimed = await claimSettlement(paymentId)
  if (!claimed) return { settled: false, alreadySettled: true }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: payment.userId },
        data: { balance: { increment: payment.netAmount } },
      }),
      prisma.transaction.create({
        data: {
          type: 'DEPOSIT',
          amount: payment.netAmount,
          feeAmount: payment.feeAmount,
          description: `Deposit K${payment.netAmount.toFixed(2)} via ${providerLabel(payment.provider)} (${payment.phoneNumber})`,
          status: 'COMPLETED',
          userId: payment.userId,
          metadata: JSON.stringify({
            method: providerMethod(payment.provider),
            provider: payment.provider,
            phoneNumber: payment.phoneNumber,
            externalRef: payment.externalRef,
            paymentId: payment.id,
          }),
        },
      }),
      prisma.notification.create({
        data: {
          type: 'DEPOSIT',
          title: 'Deposit Successful',
          message: `K${payment.netAmount.toFixed(2)} has been added to your account via ${providerLabel(payment.provider)}.`,
          userId: payment.userId,
          metadata: JSON.stringify({ paymentId: payment.id }),
        },
      }),
    ])

    console.log(`[Settlement] Deposit completed: K${payment.netAmount} for user ${payment.userId}`)
    return { settled: true, alreadySettled: false }
  } catch (error) {
    // Rollback settlement claim on failure
    await prisma.mobilePayment.update({
      where: { id: paymentId },
      data: { settledAt: null },
    }).catch(() => {})
    console.error('[Settlement] Failed to settle deposit:', error)
    return { settled: false, alreadySettled: false, error: 'Settlement transaction failed' }
  }
}

/**
 * Settle a failed deposit: just notify the user (no balance changes needed).
 */
export async function settleDepositFailed(paymentId: string, message?: string): Promise<SettlementResult> {
  const payment = await prisma.mobilePayment.findUnique({ where: { id: paymentId } })
  if (!payment) return { settled: false, alreadySettled: false, error: 'Payment not found' }
  if (payment.settledAt) return { settled: false, alreadySettled: true }
  if (payment.type !== 'DEPOSIT') return { settled: false, alreadySettled: false, error: 'Not a deposit' }

  const claimed = await claimSettlement(paymentId)
  if (!claimed) return { settled: false, alreadySettled: true }

  try {
    await prisma.notification.create({
      data: {
        type: 'DEPOSIT',
        title: 'Deposit Failed',
        message: `Your ${providerLabel(payment.provider)} deposit of K${payment.amount.toFixed(2)} was unsuccessful. ${message || 'Please try again.'}`,
        userId: payment.userId,
        metadata: JSON.stringify({ paymentId: payment.id }),
      },
    })

    console.log(`[Settlement] Deposit failed notification sent for user ${payment.userId}`)
    return { settled: true, alreadySettled: false }
  } catch (error) {
    await prisma.mobilePayment.update({
      where: { id: paymentId },
      data: { settledAt: null },
    }).catch(() => {})
    console.error('[Settlement] Failed to settle deposit failure:', error)
    return { settled: false, alreadySettled: false, error: 'Settlement failed' }
  }
}

/**
 * Settle a successful withdrawal: update transaction status + notify.
 * (Balance was already deducted at initiation time.)
 */
export async function settleWithdrawalCompleted(paymentId: string): Promise<SettlementResult> {
  const payment = await prisma.mobilePayment.findUnique({ where: { id: paymentId } })
  if (!payment) return { settled: false, alreadySettled: false, error: 'Payment not found' }
  if (payment.settledAt) return { settled: false, alreadySettled: true }
  if (payment.type !== 'WITHDRAWAL') return { settled: false, alreadySettled: false, error: 'Not a withdrawal' }

  const claimed = await claimSettlement(paymentId)
  if (!claimed) return { settled: false, alreadySettled: true }

  try {
    await prisma.$transaction([
      prisma.transaction.updateMany({
        where: {
          userId: payment.userId,
          status: 'PROCESSING',
          metadata: { contains: payment.externalRef },
        },
        data: { status: 'COMPLETED' },
      }),
      prisma.notification.create({
        data: {
          type: 'WITHDRAW',
          title: 'Withdrawal Successful',
          message: `K${payment.netAmount.toFixed(2)} has been sent to your ${providerLabel(payment.provider)} (${payment.phoneNumber}).`,
          userId: payment.userId,
          metadata: JSON.stringify({ paymentId: payment.id }),
        },
      }),
    ])

    console.log(`[Settlement] Withdrawal completed: K${payment.netAmount} for user ${payment.userId}`)
    return { settled: true, alreadySettled: false }
  } catch (error) {
    await prisma.mobilePayment.update({
      where: { id: paymentId },
      data: { settledAt: null },
    }).catch(() => {})
    console.error('[Settlement] Failed to settle withdrawal completion:', error)
    return { settled: false, alreadySettled: false, error: 'Settlement failed' }
  }
}

/**
 * Settle a failed withdrawal: refund balance, reverse fee revenue, update transaction, notify.
 */
export async function settleWithdrawalFailed(paymentId: string, message?: string): Promise<SettlementResult> {
  const payment = await prisma.mobilePayment.findUnique({ where: { id: paymentId } })
  if (!payment) return { settled: false, alreadySettled: false, error: 'Payment not found' }
  if (payment.settledAt) return { settled: false, alreadySettled: true }
  if (payment.type !== 'WITHDRAWAL') return { settled: false, alreadySettled: false, error: 'Not a withdrawal' }

  const claimed = await claimSettlement(paymentId)
  if (!claimed) return { settled: false, alreadySettled: true }

  try {
    const refundOps: any[] = [
      // Refund user balance (full amount including fee)
      prisma.user.update({
        where: { id: payment.userId },
        data: { balance: { increment: payment.amount } },
      }),
      // Update transaction to FAILED
      prisma.transaction.updateMany({
        where: {
          userId: payment.userId,
          status: 'PROCESSING',
          metadata: { contains: payment.externalRef },
        },
        data: { status: 'FAILED' },
      }),
      // Create notification
      prisma.notification.create({
        data: {
          type: 'WITHDRAW',
          title: 'Withdrawal Failed',
          message: `Your withdrawal of K${payment.netAmount.toFixed(2)} to ${providerLabel(payment.provider)} failed. K${payment.amount.toFixed(2)} has been refunded to your account.`,
          userId: payment.userId,
          metadata: JSON.stringify({ paymentId: payment.id }),
        },
      }),
    ]

    // Reverse the platform revenue entry for the withdrawal fee
    if (payment.feeAmount > 0) {
      refundOps.push(
        prisma.platformRevenue.create({
          data: {
            feeType: 'WITHDRAWAL_FEE_REVERSAL',
            amount: -payment.feeAmount,
            description: `Reversed withdrawal fee — payment failed for ${payment.phoneNumber}`,
            sourceType: 'WITHDRAWAL',
            sourceId: payment.id,
            userId: payment.userId,
          },
        })
      )
    }

    await prisma.$transaction(refundOps)

    console.log(`[Settlement] Withdrawal failed, refunded K${payment.amount} (fee K${payment.feeAmount} reversed) for user ${payment.userId}`)
    return { settled: true, alreadySettled: false }
  } catch (error) {
    await prisma.mobilePayment.update({
      where: { id: paymentId },
      data: { settledAt: null },
    }).catch(() => {})
    console.error('[Settlement] Failed to settle withdrawal failure:', error)
    return { settled: false, alreadySettled: false, error: 'Settlement failed' }
  }
}
