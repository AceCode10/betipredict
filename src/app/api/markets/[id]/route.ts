import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const market = await prisma.market.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true
          }
        },
        orders: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 50
        }
      }
    })

    if (!market) {
      return NextResponse.json(
        { error: 'Market not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(market)
  } catch (error) {
    console.error('Error fetching market:', error)
    return NextResponse.json(
      { error: 'Failed to fetch market' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { getServerSession } = await import('next-auth')
    const { authOptions } = await import('@/lib/auth')
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { status, winningOutcome } = body

    // Verify the user is the market creator
    const existing = await prisma.market.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }
    if (existing.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Only the market creator can update this market' }, { status: 403 })
    }

    const market = await prisma.market.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(winningOutcome && { winningOutcome }),
        ...(status === 'RESOLVED' && { resolvedAt: new Date() })
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true
          }
        }
      }
    })

    return NextResponse.json(market)
  } catch (error) {
    console.error('Error updating market:', error)
    return NextResponse.json(
      { error: 'Failed to update market' },
      { status: 500 }
    )
  }
}
