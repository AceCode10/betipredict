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

    const { amount, method } = await request.json()

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid deposit amount' },
        { status: 400 }
      )
    }

    if (amount > 1000000) {
      return NextResponse.json(
        { error: 'Maximum deposit is K1,000,000' },
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

    // Update user balance and create transaction record atomically
    const [updatedUser, transaction] = await prisma.$transaction([
      prisma.user.update({
        where: { id: session.user.id },
        data: { balance: user.balance + amount }
      }),
      prisma.transaction.create({
        data: {
          type: 'DEPOSIT',
          amount: amount,
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
