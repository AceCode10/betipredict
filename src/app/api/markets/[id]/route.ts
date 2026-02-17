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
    const { id } = await params
    const body = await request.json()
    const { status, winningOutcome } = body

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
