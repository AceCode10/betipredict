import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const amount = Number(body.amount)
    const method = typeof body.method === 'string' ? body.method.slice(0, 50) : 'direct'

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid withdrawal amount' },
        { status: 400 }
      )
    }

    if (amount < 10) {
      return NextResponse.json(
        { error: 'Minimum withdrawal is K10' },
        { status: 400 }
      )
    }

    if (amount > 500000) {
      return NextResponse.json(
        { error: 'Maximum withdrawal is K500,000' },
        { status: 400 }
      )
    }

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.balance < amount) {
      return NextResponse.json(
        { error: 'Insufficient balance' },
        { status: 400 }
      )
    }

    // Update user balance and create transaction record atomically
    const [updatedUser, transaction] = await prisma.$transaction([
      prisma.user.update({
        where: { id: session.user.id },
        data: { balance: user.balance - amount }
      }),
      prisma.transaction.create({
        data: {
          type: 'WITHDRAWAL',
          amount: -amount,
          description: `Withdrawal K${amount.toFixed(2)} via ${method}`,
          status: 'COMPLETED',
          userId: session.user.id,
          metadata: JSON.stringify({ method, originalAmount: amount })
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
    console.error('Error processing withdrawal:', error)
    return NextResponse.json(
      { error: 'Failed to process withdrawal' },
      { status: 500 }
    )
  }
}
