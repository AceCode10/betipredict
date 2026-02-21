import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * GET  /api/markets/[id]/chat - Fetch comments for a market (Polymarket-style)
 * POST /api/markets/[id]/chat - Post a comment or reply
 * PUT  /api/markets/[id]/chat - Like/unlike a comment
 */

const commentSelect = (userId?: string) => ({
  id: true,
  content: true,
  parentId: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      username: true,
      avatar: true,
    }
  },
  _count: {
    select: { likes: true, replies: true }
  },
  likes: userId ? {
    where: { userId },
    select: { id: true },
  } : false as const,
})

function formatComment(msg: any) {
  return {
    id: msg.id,
    content: msg.content,
    parentId: msg.parentId,
    createdAt: msg.createdAt,
    user: msg.user,
    likeCount: msg._count?.likes ?? 0,
    replyCount: msg._count?.replies ?? 0,
    isLiked: Array.isArray(msg.likes) ? msg.likes.length > 0 : false,
    replies: msg.replies?.map(formatComment) ?? [],
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    const cursor = request.nextUrl.searchParams.get('cursor') || undefined
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '30'), 100)
    const sort = request.nextUrl.searchParams.get('sort') || 'newest'

    const orderBy = sort === 'oldest'
      ? { createdAt: 'asc' as const }
      : { createdAt: 'desc' as const }

    // Fetch top-level comments only (parentId is null)
    const messages = await prisma.chatMessage.findMany({
      where: { marketId, parentId: null },
      orderBy,
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        ...commentSelect(userId),
        replies: {
          orderBy: { createdAt: 'asc' },
          take: 3,
          select: commentSelect(userId),
        },
      },
    })

    const nextCursor = messages.length === limit ? messages[messages.length - 1]?.id : null

    // Get total comment count for this market
    const totalCount = await prisma.chatMessage.count({ where: { marketId } })

    return NextResponse.json({
      comments: messages.map(formatComment),
      nextCursor,
      totalCount,
    })
  } catch (error) {
    console.error('[Chat] Error fetching comments:', error)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
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
    const rawContent = typeof body.content === 'string' ? body.content.trim() : ''
    const parentId = typeof body.parentId === 'string' ? body.parentId : null

    if (!rawContent || rawContent.length === 0) {
      return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })
    }
    if (rawContent.length > 500) {
      return NextResponse.json({ error: 'Comment too long (max 500 characters)' }, { status: 400 })
    }

    // Sanitize: strip HTML tags and dangerous patterns to prevent stored XSS
    const content = rawContent
      .replace(/<[^>]*>/g, '')           // Strip all HTML tags
      .replace(/javascript:/gi, '')       // Remove javascript: URIs
      .replace(/on\w+\s*=/gi, '')         // Remove inline event handlers
      .replace(/data:\s*text\/html/gi, '') // Remove data:text/html URIs
      .trim()

    if (!content) {
      return NextResponse.json({ error: 'Comment cannot be empty after sanitization' }, { status: 400 })
    }

    // Verify market exists
    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: { id: true, status: true }
    })
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    // If replying, verify parent exists and belongs to same market
    if (parentId) {
      const parent = await prisma.chatMessage.findUnique({
        where: { id: parentId },
        select: { marketId: true }
      })
      if (!parent || parent.marketId !== marketId) {
        return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 })
      }
    }

    const message = await prisma.chatMessage.create({
      data: {
        content,
        parentId,
        userId: session.user.id,
        marketId,
      },
      select: commentSelect(session.user.id),
    })

    return NextResponse.json({ comment: formatComment(message) })
  } catch (error) {
    console.error('[Chat] Error posting comment:', error)
    return NextResponse.json({ error: 'Failed to post comment' }, { status: 500 })
  }
}

// PUT: Like/unlike a comment
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const messageId = typeof body.messageId === 'string' ? body.messageId : ''

    if (!messageId) {
      return NextResponse.json({ error: 'Message ID required' }, { status: 400 })
    }

    // Check if already liked
    const existing = await prisma.chatMessageLike.findUnique({
      where: {
        userId_messageId: {
          userId: session.user.id,
          messageId,
        }
      }
    })

    if (existing) {
      // Unlike
      await prisma.chatMessageLike.delete({ where: { id: existing.id } })
      return NextResponse.json({ liked: false })
    } else {
      // Like
      await prisma.chatMessageLike.create({
        data: {
          userId: session.user.id,
          messageId,
        }
      })
      return NextResponse.json({ liked: true })
    }
  } catch (error) {
    console.error('[Chat] Error toggling like:', error)
    return NextResponse.json({ error: 'Failed to toggle like' }, { status: 500 })
  }
}
