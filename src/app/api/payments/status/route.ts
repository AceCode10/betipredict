import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  checkCollectionStatus,
  checkDisbursementStatus,
  mapAirtelStatus,
  isAirtelMoneyConfigured,
} from '@/lib/airtel-money'

/**
 * Check the status of a mobile payment.
 * Used by the frontend to poll for payment completion.
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
      // Get updated balance
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

    // Check if expired
    if (new Date() > payment.expiresAt) {
      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          statusMessage: 'Payment expired. Please try again.',
        }
      })

      // If withdrawal expired, refund
      if (payment.type === 'WITHDRAWAL') {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { balance: { increment: payment.amount } }
        })
      }

      return NextResponse.json({
        paymentId: payment.id,
        status: 'FAILED',
        statusMessage: 'Payment expired. Please try again.',
      })
    }

    // If Airtel is configured and we have an external ref, poll Airtel for status
    if (isAirtelMoneyConfigured() && payment.externalRef && !payment.callbackReceived) {
      try {
        const airtelStatus = payment.type === 'DEPOSIT'
          ? await checkCollectionStatus(payment.externalRef)
          : await checkDisbursementStatus(payment.externalRef)

        const txnStatus = airtelStatus.data?.transaction?.status
        if (txnStatus) {
          const mappedStatus = mapAirtelStatus(txnStatus)
          
          // If status changed, update
          if (mappedStatus !== payment.status) {
            await prisma.mobilePayment.update({
              where: { id: payment.id },
              data: {
                status: mappedStatus,
                statusMessage: airtelStatus.data?.transaction?.message || payment.statusMessage,
                completedAt: mappedStatus === 'COMPLETED' ? new Date() : null,
              }
            })

            // Handle deposit completion (credit balance)
            if (mappedStatus === 'COMPLETED' && payment.type === 'DEPOSIT') {
              await prisma.$transaction([
                prisma.user.update({
                  where: { id: session.user.id },
                  data: { balance: { increment: payment.netAmount } }
                }),
                prisma.transaction.create({
                  data: {
                    type: 'DEPOSIT',
                    amount: payment.netAmount,
                    feeAmount: payment.feeAmount,
                    description: `Deposit K${payment.netAmount.toFixed(2)} via Airtel Money (${payment.phoneNumber})`,
                    status: 'COMPLETED',
                    userId: session.user.id,
                    metadata: JSON.stringify({
                      method: 'airtel_money',
                      phoneNumber: payment.phoneNumber,
                      externalRef: payment.externalRef,
                      paymentId: payment.id,
                    })
                  }
                }),
                prisma.notification.create({
                  data: {
                    type: 'DEPOSIT',
                    title: 'Deposit Successful',
                    message: `K${payment.netAmount.toFixed(2)} has been added to your account via Airtel Money.`,
                    userId: session.user.id,
                  }
                })
              ])
            }

            // Handle failed withdrawal (refund)
            if (mappedStatus === 'FAILED' && payment.type === 'WITHDRAWAL') {
              await prisma.$transaction([
                prisma.user.update({
                  where: { id: session.user.id },
                  data: { balance: { increment: payment.amount } }
                }),
                prisma.notification.create({
                  data: {
                    type: 'WITHDRAW',
                    title: 'Withdrawal Failed',
                    message: `Your withdrawal failed. K${payment.amount.toFixed(2)} has been refunded.`,
                    userId: session.user.id,
                  }
                })
              ])
            }

            // Get updated balance
            const user = await prisma.user.findUnique({
              where: { id: session.user.id },
              select: { balance: true },
            })

            return NextResponse.json({
              paymentId: payment.id,
              status: mappedStatus,
              statusMessage: airtelStatus.data?.transaction?.message || '',
              amount: payment.amount,
              feeAmount: payment.feeAmount,
              netAmount: payment.netAmount,
              completedAt: mappedStatus === 'COMPLETED' ? new Date().toISOString() : null,
              newBalance: user?.balance || 0,
            })
          }
        }
      } catch (err) {
        // Airtel status check failed — return current DB status
        console.error('[PaymentStatus] Airtel status check failed:', err)
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
