import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FEES } from '@/lib/fees'
import {
  initiateCollection,
  generateTransactionRef,
  isAirtelMoneyConfigured,
  normalizeZambianPhone,
  AirtelMoneyError,
} from '@/lib/airtel-money'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Rate limit: 10 deposits per minute
    const rl = checkRateLimit(`deposit:${session.user.id}`, 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many deposit attempts. Please wait.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const amount = Number(body.amount)
    const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
    const method = typeof body.method === 'string' ? body.method.slice(0, 50) : 'airtel_money'

    // Validate amount
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid deposit amount' }, { status: 400 })
    }
    if (amount < FEES.DEPOSIT_MIN_AMOUNT) {
      return NextResponse.json({ error: `Minimum deposit is K${FEES.DEPOSIT_MIN_AMOUNT}` }, { status: 400 })
    }
    if (amount > FEES.DEPOSIT_MAX_AMOUNT) {
      return NextResponse.json({ error: `Maximum deposit is K${FEES.DEPOSIT_MAX_AMOUNT.toLocaleString()}` }, { status: 400 })
    }

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // ─── Airtel Money Flow ───────────────────────────────────
    if (method === 'airtel_money' && isAirtelMoneyConfigured()) {
      // Validate phone number
      if (!phoneNumber) {
        return NextResponse.json({ error: 'Phone number is required for Airtel Money deposits' }, { status: 400 })
      }

      let normalizedPhone: string
      try {
        normalizedPhone = normalizeZambianPhone(phoneNumber)
      } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Invalid phone number' }, { status: 400 })
      }

      // Mask phone for storage (097****567)
      const maskedPhone = phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')
      const externalRef = generateTransactionRef('DEP')
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minute expiry

      // Create pending mobile payment record
      const mobilePayment = await prisma.mobilePayment.create({
        data: {
          type: 'DEPOSIT',
          amount: amount,
          feeAmount: 0, // No fee on deposits
          netAmount: amount,
          phoneNumber: maskedPhone,
          provider: 'AIRTEL_MONEY',
          externalRef,
          status: 'PENDING',
          expiresAt,
          userId: session.user.id,
        }
      })

      // Initiate Airtel Money collection (USSD push)
      try {
        const airtelResponse = await initiateCollection({
          phoneNumber,
          amount: Math.round(amount), // Airtel expects whole numbers
          reference: externalRef,
        })

        // Update payment with Airtel's transaction ID
        await prisma.mobilePayment.update({
          where: { id: mobilePayment.id },
          data: {
            externalId: airtelResponse.data?.transaction?.id || null,
            status: 'PROCESSING',
            statusMessage: 'USSD prompt sent to your phone. Please confirm.',
          }
        })

        return NextResponse.json({
          success: true,
          paymentId: mobilePayment.id,
          externalRef,
          status: 'PROCESSING',
          message: 'A payment prompt has been sent to your Airtel Money. Please enter your PIN to confirm.',
          expiresAt: expiresAt.toISOString(),
        })
      } catch (err: any) {
        // Mark payment as failed
        await prisma.mobilePayment.update({
          where: { id: mobilePayment.id },
          data: {
            status: 'FAILED',
            statusMessage: err.message || 'Failed to initiate payment',
          }
        })

        const errorMessage = err instanceof AirtelMoneyError
          ? err.message
          : 'Failed to initiate Airtel Money payment. Please try again.'
        
        return NextResponse.json({ error: errorMessage }, { status: 502 })
      }
    }

    // ─── Direct/Fallback Deposit (dev mode or non-Airtel) ────
    const [updatedUser, transaction] = await prisma.$transaction([
      prisma.user.update({
        where: { id: session.user.id },
        data: { balance: { increment: amount } }
      }),
      prisma.transaction.create({
        data: {
          type: 'DEPOSIT',
          amount: amount,
          feeAmount: 0,
          description: `Deposit K${amount.toFixed(2)} via ${method || 'direct'}`,
          status: 'COMPLETED',
          userId: session.user.id,
          metadata: JSON.stringify({ method: method || 'direct', originalAmount: amount })
        }
      })
    ])

    return NextResponse.json({
      success: true,
      newBalance: updatedUser.balance,
      transaction: {
        id: transaction.id,
        amount: transaction.amount,
        type: transaction.type,
        status: transaction.status
      }
    })
  } catch (error) {
    console.error('Error processing deposit:', error)
    return NextResponse.json(
      { error: 'Failed to process deposit' },
      { status: 500 }
    )
  }
}
