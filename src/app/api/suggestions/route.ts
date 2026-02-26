import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, sanitizeString } from '@/lib/rate-limit'

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

    // Rate limit: 5 suggestions per hour per user
    const rl = checkRateLimit(`suggestion:${session.user.id}`, 5, 3600_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many suggestions. Please wait before submitting again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
      )
    }

    const body = await request.json()

    // Sanitize inputs
    const title = sanitizeString(body.title || '', 200)
    const category = sanitizeString(body.category || '', 100)
    const question = sanitizeString(body.question || '', 300)
    const description = body.description ? sanitizeString(String(body.description), 1000) : null
    const resolutionSource = body.resolutionSource ? sanitizeString(String(body.resolutionSource), 500) : null

    // Validation
    if (!title || title.length < 5) {
      return NextResponse.json({ error: 'Title must be 5-200 characters' }, { status: 400 })
    }
    if (!category) {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 })
    }
    if (!question || question.length < 10) {
      return NextResponse.json({ error: 'Question must be 10-300 characters' }, { status: 400 })
    }

    // Parse questionType and options for multi-option markets
    const questionType = body.questionType || 'yes-no'
    const validTypes = ['yes-no', 'multi-option', 'range', 'sentiment', 'date', 'head-to-head']
    const finalQType = validTypes.includes(questionType) ? questionType : 'yes-no'
    let optionsJson: string | null = null
    if (finalQType !== 'yes-no' && Array.isArray(body.options)) {
      const sanitizedOpts = body.options.map((o: string) => sanitizeString(String(o || ''), 200).trim()).filter((o: string) => o.length > 0)
      if (sanitizedOpts.length >= 2) {
        optionsJson = JSON.stringify(sanitizedOpts)
      }
    }

    const suggestion = await prisma.marketSuggestion.create({
      data: {
        title: title.trim(),
        description,
        category: category.trim(),
        question: question.trim(),
        questionType: finalQType,
        options: optionsJson,
        resolutionSource,
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
    // Admin edits — optional overrides applied before creating the market
    const adminEdits = body.edits as {
      title?: string; question?: string; description?: string;
      category?: string; resolveTime?: string;
    } | undefined

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

    // Apply admin edits to the suggestion record so there's an audit trail
    const finalTitle = adminEdits?.title?.trim() || suggestion.title
    const finalQuestion = adminEdits?.question?.trim() || suggestion.question
    const finalDescription = adminEdits?.description?.trim() || suggestion.description
    const finalCategory = adminEdits?.category?.trim() || suggestion.category
    const finalResolveTime = adminEdits?.resolveTime
      ? new Date(adminEdits.resolveTime)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    // Update suggestion with admin edits + status change
    const updated = await prisma.marketSuggestion.update({
      where: { id: suggestionId },
      data: {
        title: finalTitle,
        question: finalQuestion,
        description: finalDescription,
        category: finalCategory,
        status: action,
        rejectionReason: action === 'REJECTED' ? rejectionReason : null,
        reviewedById: session.user.id,
        reviewedAt: new Date(),
      }
    })

    // If approved, create market(s) based on questionType
    if (action === 'APPROVED') {
      const isMultiOption = suggestion.questionType !== 'yes-no' && suggestion.options

      if (isMultiOption) {
        // Multi-option: create MarketGroup + child Markets
        const options: string[] = JSON.parse(suggestion.options!)
        const group = await prisma.marketGroup.create({
          data: {
            title: finalTitle,
            description: finalDescription,
            category: finalCategory,
            icon: suggestion.questionType === 'sentiment' ? '📊'
              : suggestion.questionType === 'range' ? '📈'
              : suggestion.questionType === 'date' ? '📅'
              : suggestion.questionType === 'head-to-head' ? '⚔️'
              : '🏆',
            displayType: suggestion.questionType === 'yes-no' ? 'multi-option' : suggestion.questionType,
            creatorId: suggestion.suggesterId,
          }
        })

        // Create child binary markets for each option
        for (const option of options) {
          await prisma.market.create({
            data: {
              title: option,
              question: `${finalTitle} — ${option}`,
              description: `Option "${option}" for: ${finalTitle}`,
              category: finalCategory,
              resolveTime: finalResolveTime,
              creatorId: suggestion.suggesterId,
              groupId: group.id,
              status: 'ACTIVE',
              marketType: 'BINARY',
              pricingEngine: 'CLOB',
              liquidity: 0,
              yesPrice: 0.5,
              noPrice: 0.5,
            }
          })
        }

        // Link group to suggestion
        await prisma.marketSuggestion.update({
          where: { id: suggestionId },
          data: { groupId: group.id }
        })

        // Notify the suggester
        await prisma.notification.create({
          data: {
            userId: suggestion.suggesterId,
            type: 'SUGGESTION_APPROVED',
            title: 'Market Suggestion Approved!',
            message: `Your suggestion "${finalTitle}" has been approved with ${options.length} options.`,
            metadata: JSON.stringify({ groupId: group.id }),
          }
        })
      } else {
        // Binary yes/no: create single Market
        const market = await prisma.market.create({
          data: {
            title: finalTitle,
            description: finalDescription,
            category: finalCategory,
            question: finalQuestion,
            creatorId: suggestion.suggesterId,
            status: 'PENDING_APPROVAL',
            resolveTime: finalResolveTime,
            pricingEngine: 'CLOB',
            liquidity: 0,
            yesPrice: 0.5,
            noPrice: 0.5,
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
            message: `Your suggestion "${finalTitle}" has been approved and is now live.`,
            metadata: JSON.stringify({ marketId: market.id }),
          }
        })
      }
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
