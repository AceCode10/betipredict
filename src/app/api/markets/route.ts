import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { initializeDatabase } from '@/lib/db-init'

export async function GET(request: NextRequest) {
  try {
    // Initialize database if needed
    const userCount = await prisma.user.count()
    if (userCount === 0) {
      console.log('Initializing database...')
      await initializeDatabase()
    }

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const where: any = {}
    if (category) where.category = category
    if (status) where.status = status

    const markets = await prisma.market.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true
          }
        },
        _count: {
          select: {
            orders: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit,
      skip: offset
    })

    return NextResponse.json(markets)
  } catch (error) {
    console.error('Error fetching markets:', error)
    return NextResponse.json(
      { error: 'Failed to fetch markets' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      title,
      description,
      category,
      subcategory,
      question,
      resolveTime,
      creatorId
    } = body

    if (!title || !category || !question || !resolveTime || !creatorId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const market = await prisma.market.create({
      data: {
        title,
        description,
        category,
        subcategory,
        question,
        resolveTime: new Date(resolveTime),
        creatorId,
        status: 'PENDING'
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

    return NextResponse.json(market, { status: 201 })
  } catch (error) {
    console.error('Error creating market:', error)
    return NextResponse.json(
      { error: 'Failed to create market' },
      { status: 500 }
    )
  }
}
