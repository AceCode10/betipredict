import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * GET  /api/markets/[id]/chat - Fetch chat messages for a market
 * POST /api/markets/[id]/chat - Send a chat message
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params
    const cursor = request.nextUrl.searchParams.get('cursor') || undefined
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 100)

    const messages = await prisma.chatMessage.findMany({
      where: { marketId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
          }
        }
      }
    })

    // nextCursor should be the oldest message ID (last in desc order = messages[length-1])
    // so the next page fetches messages older than this cursor
    const nextCursor = messages.length === limit ? messages[messages.length - 1]?.id : null

    return NextResponse.json({
      messages: messages.reverse(), // Return in chronological order
      nextCursor,
    })
  } catch (error) {
    console.error('[Chat] Error fetching messages:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: marketId } = await params

    // Rate limit: 20 messages per minute
    const rl = checkRateLimit(`chat:${session.user.id}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many messages. Please wait.' }, { status: 429 })
    }

    const body = await request.json()
    const content = typeof body.content === 'string' ? body.content.trim() : ''

    if (!content || content.length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    }
    if (content.length > 500) {
      return NextResponse.json({ error: 'Message too long (max 500 characters)' }, { status: 400 })
    }

    // Verify market exists
    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: { id: true, status: true }
    })
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    const message = await prisma.chatMessage.create({
      data: {
        content,
        userId: session.user.id,
        marketId,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
          }
        }
      }
    })

    return NextResponse.json({ message })
  } catch (error) {
    console.error('[Chat] Error sending message:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
