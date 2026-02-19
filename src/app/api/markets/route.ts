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
    const { getServerSession } = await import('next-auth')
    const { authOptions } = await import('@/lib/auth')
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      title,
      description,
      category,
      subcategory,
      question,
      resolveTime,
    } = body

    // Validate required fields
    if (!title || typeof title !== 'string' || title.length < 3 || title.length > 200) {
      return NextResponse.json({ error: 'Title must be 3-200 characters' }, { status: 400 })
    }
    if (!category || typeof category !== 'string') {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 })
    }
    if (!question || typeof question !== 'string' || question.length < 5 || question.length > 300) {
      return NextResponse.json({ error: 'Question must be 5-300 characters' }, { status: 400 })
    }
    if (!resolveTime || new Date(resolveTime) <= new Date()) {
      return NextResponse.json({ error: 'Resolve time must be in the future' }, { status: 400 })
    }

    const market = await prisma.market.create({
      data: {
        title: title.trim(),
        description: description ? String(description).slice(0, 1000) : null,
        category: category.trim(),
        subcategory: subcategory ? String(subcategory).slice(0, 100) : null,
        question: question.trim(),
        resolveTime: new Date(resolveTime),
        creatorId: session.user.id,
        status: 'ACTIVE'
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
