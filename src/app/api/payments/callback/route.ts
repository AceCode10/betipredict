import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mapAirtelStatus } from '@/lib/airtel-money'

/**
 * Airtel Money Callback Webhook
 * 
 * Airtel sends POST requests here when a collection/disbursement completes.
 * This endpoint:
 * 1. Validates the callback
 * 2. Updates the MobilePayment record
 * 3. Credits user balance for successful deposits
 * 4. Creates transaction records
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('[Airtel Callback] Received:', JSON.stringify(body))

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

    // Find the mobile payment by external reference or Airtel ID
    let mobilePayment = await prisma.mobilePayment.findFirst({
      where: {
        OR: [
          { externalRef: externalRef },
          { externalId: airtelId },
        ],
        status: { in: ['PENDING', 'PROCESSING'] }, // Only process non-terminal states
      }
    })

    if (!mobilePayment) {
      console.warn('[Airtel Callback] No matching pending payment found for ref:', externalRef)
      return NextResponse.json({ status: 'ok' })
    }

    const newStatus = mapAirtelStatus(airtelStatus)
    const now = new Date()

    // Update the mobile payment record
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

    // If deposit completed successfully, credit user balance
    if (newStatus === 'COMPLETED' && mobilePayment.type === 'DEPOSIT') {
      await prisma.$transaction([
        // Credit user balance
        prisma.user.update({
          where: { id: mobilePayment.userId },
          data: { balance: { increment: mobilePayment.netAmount } }
        }),
        // Create transaction record
        prisma.transaction.create({
          data: {
            type: 'DEPOSIT',
            amount: mobilePayment.netAmount,
            feeAmount: mobilePayment.feeAmount,
            description: `Deposit K${mobilePayment.netAmount.toFixed(2)} via Airtel Money (${mobilePayment.phoneNumber})`,
            status: 'COMPLETED',
            userId: mobilePayment.userId,
            metadata: JSON.stringify({
              method: 'airtel_money',
              phoneNumber: mobilePayment.phoneNumber,
              externalRef: mobilePayment.externalRef,
              airtelId,
              paymentId: mobilePayment.id,
            })
          }
        }),
        // Create notification
        prisma.notification.create({
          data: {
            type: 'DEPOSIT',
            title: 'Deposit Successful',
            message: `K${mobilePayment.netAmount.toFixed(2)} has been added to your account via Airtel Money.`,
            userId: mobilePayment.userId,
            metadata: JSON.stringify({ paymentId: mobilePayment.id }),
          }
        })
      ])

      console.log(`[Airtel Callback] Deposit completed: K${mobilePayment.netAmount} for user ${mobilePayment.userId}`)
    }

    // If withdrawal completed successfully, create notification
    if (newStatus === 'COMPLETED' && mobilePayment.type === 'WITHDRAWAL') {
      await prisma.$transaction([
        // Update related transaction to COMPLETED
        prisma.transaction.updateMany({
          where: {
            userId: mobilePayment.userId,
            status: 'PROCESSING',
            metadata: { contains: mobilePayment.externalRef },
          },
          data: { status: 'COMPLETED' }
        }),
        // Create notification
        prisma.notification.create({
          data: {
            type: 'WITHDRAW',
            title: 'Withdrawal Successful',
            message: `K${mobilePayment.netAmount.toFixed(2)} has been sent to your Airtel Money (${mobilePayment.phoneNumber}).`,
            userId: mobilePayment.userId,
            metadata: JSON.stringify({ paymentId: mobilePayment.id }),
          }
        })
      ])

      console.log(`[Airtel Callback] Withdrawal completed: K${mobilePayment.netAmount} for user ${mobilePayment.userId}`)
    }

    // If deposit failed, create failure notification
    if (newStatus === 'FAILED' && mobilePayment.type === 'DEPOSIT') {
      await prisma.notification.create({
        data: {
          type: 'DEPOSIT',
          title: 'Deposit Failed',
          message: `Your Airtel Money deposit of K${mobilePayment.amount.toFixed(2)} was unsuccessful. ${message || 'Please try again.'}`,
          userId: mobilePayment.userId,
          metadata: JSON.stringify({ paymentId: mobilePayment.id }),
        }
      })
    }

    // If withdrawal failed, refund user and notify
    if (newStatus === 'FAILED' && mobilePayment.type === 'WITHDRAWAL') {
      await prisma.$transaction([
        // Refund user balance (full amount including fee)
        prisma.user.update({
          where: { id: mobilePayment.userId },
          data: { balance: { increment: mobilePayment.amount } }
        }),
        // Update transaction to FAILED
        prisma.transaction.updateMany({
          where: {
            userId: mobilePayment.userId,
            status: 'PROCESSING',
            metadata: { contains: mobilePayment.externalRef },
          },
          data: { status: 'FAILED' }
        }),
        // Create notification
        prisma.notification.create({
          data: {
            type: 'WITHDRAW',
            title: 'Withdrawal Failed',
            message: `Your withdrawal of K${mobilePayment.netAmount.toFixed(2)} to Airtel Money failed. K${mobilePayment.amount.toFixed(2)} has been refunded to your account.`,
            userId: mobilePayment.userId,
            metadata: JSON.stringify({ paymentId: mobilePayment.id }),
          }
        })
      ])

      console.log(`[Airtel Callback] Withdrawal failed, refunded K${mobilePayment.amount} for user ${mobilePayment.userId}`)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[Airtel Callback] Error processing callback:', error)
    // Return 200 to prevent Airtel from retrying (we log the error)
    return NextResponse.json({ status: 'ok' })
  }
}
