import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET: Fetch suggestions (user's own or all for admins)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // PENDING, APPROVED, REJECTED, or null for all
    const adminView = searchParams.get('admin') === 'true'

    // Check if user is admin
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } })
    const isAdmin = user?.email ? adminEmails.includes(user.email.toLowerCase()) : false

    const where: any = {}
    
    if (adminView && isAdmin) {
      // Admins can see all suggestions
      if (status) where.status = status
    } else {
      // Users only see their own suggestions
      where.suggesterId = session.user.id
      if (status) where.status = status
    }

    const suggestions = await prisma.marketSuggestion.findMany({
      where,
      include: {
        suggester: {
          select: { id: true, username: true, fullName: true, avatar: true }
        },
        reviewedBy: {
          select: { id: true, username: true, fullName: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ suggestions, isAdmin })
  } catch (error) {
    console.error('Error fetching suggestions:', error)
    return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 })
  }
}

// POST: Create a new suggestion
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, description, category, question, resolutionSource } = body

    // Validation
    if (!title || typeof title !== 'string' || title.length < 5 || title.length > 200) {
      return NextResponse.json({ error: 'Title must be 5-200 characters' }, { status: 400 })
    }
    if (!category || typeof category !== 'string') {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 })
    }
    if (!question || typeof question !== 'string' || question.length < 10 || question.length > 300) {
      return NextResponse.json({ error: 'Question must be 10-300 characters' }, { status: 400 })
    }

    const suggestion = await prisma.marketSuggestion.create({
      data: {
        title: title.trim(),
        description: description ? String(description).slice(0, 1000) : null,
        category: category.trim(),
        question: question.trim(),
        resolutionSource: resolutionSource ? String(resolutionSource).slice(0, 500) : null,
        suggesterId: session.user.id,
        status: 'PENDING',
      },
      include: {
        suggester: {
          select: { id: true, username: true, fullName: true, avatar: true }
        }
      }
    })

    return NextResponse.json(suggestion, { status: 201 })
  } catch (error) {
    console.error('Error creating suggestion:', error)
    return NextResponse.json({ error: 'Failed to create suggestion' }, { status: 500 })
  }
}

// PUT: Admin approve/reject suggestion
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } })
    const isAdmin = user?.email ? adminEmails.includes(user.email.toLowerCase()) : false

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { suggestionId, action, rejectionReason } = body

    if (!suggestionId || !action || !['APPROVED', 'REJECTED'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const suggestion = await prisma.marketSuggestion.findUnique({
      where: { id: suggestionId }
    })

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
    }

    if (suggestion.status !== 'PENDING') {
      return NextResponse.json({ error: 'Suggestion already reviewed' }, { status: 400 })
    }

    // Update suggestion
    const updated = await prisma.marketSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: action,
        rejectionReason: action === 'REJECTED' ? rejectionReason : null,
        reviewedById: session.user.id,
        reviewedAt: new Date(),
      }
    })

    // If approved, create the market
    if (action === 'APPROVED') {
      const market = await prisma.market.create({
        data: {
          title: suggestion.title,
          description: suggestion.description,
          category: suggestion.category,
          question: suggestion.question,
          creatorId: suggestion.suggesterId, // Original suggester becomes creator
          status: 'ACTIVE',
          resolveTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days
        }
      })

      // Link market to suggestion
      await prisma.marketSuggestion.update({
        where: { id: suggestionId },
        data: { marketId: market.id }
      })

      // Notify the suggester
      await prisma.notification.create({
        data: {
          userId: suggestion.suggesterId,
          type: 'SUGGESTION_APPROVED',
          title: 'Market Suggestion Approved!',
          message: `Your suggestion "${suggestion.title}" has been approved and is now live.`,
          metadata: JSON.stringify({ marketId: market.id }),
        }
      })
    } else {
      // Notify rejection
      await prisma.notification.create({
        data: {
          userId: suggestion.suggesterId,
          type: 'SUGGESTION_REJECTED',
          title: 'Market Suggestion Not Approved',
          message: `Your suggestion "${suggestion.title}" was not approved.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        }
      })
    }

    return NextResponse.json({ success: true, suggestion: updated })
  } catch (error) {
    console.error('Error processing suggestion:', error)
    return NextResponse.json({ error: 'Failed to process suggestion' }, { status: 500 })
  }
}
