import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { initializeDatabase } from '@/lib/db-init'
import { checkRateLimit, getClientIp, sanitizeString } from '@/lib/rate-limit'

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

    // Rate limit: 10 market creations per hour per user
    const rl = checkRateLimit(`market-create:${session.user.id}`, 10, 3600_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many market creations. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
      )
    }

    const body = await request.json()
    const {
      description,
      category,
      subcategory,
      resolveTime,
      externalGameId,
    } = body

    // Sanitize string inputs
    const title = sanitizeString(body.title || '', 200)
    const question = sanitizeString(body.question || '', 300)

    // Validate required fields
    if (!title || title.length < 3) {
      return NextResponse.json({ error: 'Title must be 3-200 characters' }, { status: 400 })
    }
    if (!category || typeof category !== 'string') {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 })
    }
    if (!question || question.length < 5) {
      return NextResponse.json({ error: 'Question must be 5-300 characters' }, { status: 400 })
    }
    if (!resolveTime || new Date(resolveTime) <= new Date()) {
      return NextResponse.json({ error: 'Resolve time must be in the future' }, { status: 400 })
    }

    const market = await prisma.market.create({
      data: {
        title: title.trim(),
        description: description ? sanitizeString(String(description), 1000) : null,
        category: sanitizeString(category, 100).trim(),
        subcategory: subcategory ? sanitizeString(String(subcategory), 100) : null,
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

    // Link to ScheduledGame if externalGameId is provided (for auto-resolution)
    if (externalGameId && typeof externalGameId === 'number') {
      try {
        // Try to find existing scheduled game record
        const existing = await prisma.scheduledGame.findUnique({
          where: { externalId: externalGameId }
        })

        if (existing) {
          // Link existing game to this market
          await prisma.scheduledGame.update({
            where: { id: existing.id },
            data: { marketId: market.id }
          })
        } else {
          // Create a new ScheduledGame record linked to this market
          // Parse team names from the title ("Team A vs Team B")
          const vsMatch = title.match(/^(.+?)\s+vs\.?\s+(.+)$/i)
          await prisma.scheduledGame.create({
            data: {
              externalId: externalGameId,
              competition: subcategory || category || 'Unknown',
              competitionCode: '',
              homeTeam: vsMatch ? vsMatch[1].trim() : title,
              awayTeam: vsMatch ? vsMatch[2].trim() : '',
              utcDate: new Date(resolveTime),
              status: 'SCHEDULED',
              marketId: market.id,
            }
          })
        }
      } catch (linkErr) {
        // Non-critical: log but don't fail market creation
        console.error('Failed to link ScheduledGame:', linkErr)
      }
    }

    return NextResponse.json(market, { status: 201 })
  } catch (error) {
    console.error('Error creating market:', error)
    return NextResponse.json(
      { error: 'Failed to create market' },
      { status: 500 }
    )
  }
}
