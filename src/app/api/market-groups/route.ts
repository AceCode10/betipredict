import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getClientIp, sanitizeString } from '@/lib/rate-limit'
import { FEES, getCPMMBinaryInit } from '@/lib/fees'

// GET: Fetch all market groups with their child markets
export async function GET(request: NextRequest) {
  try {
    const groups = await prisma.marketGroup.findMany({
      include: {
        markets: {
          where: { status: 'ACTIVE' },
          orderBy: { resolveTime: 'asc' },
          select: {
            id: true,
            title: true,
            question: true,
            yesPrice: true,
            noPrice: true,
            volume: true,
            status: true,
            resolveTime: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(groups)
  } catch (error) {
    console.error('Error fetching market groups:', error)
    return NextResponse.json({ error: 'Failed to fetch market groups' }, { status: 500 })
  }
}

// POST: Create a new market group with sub-option markets
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = checkRateLimit(`market-group-create:${session.user.id}`, 5, 3600_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many market group creations. Please wait.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
      )
    }

    const body = await request.json()
    const { title, description, category, options, resolveTime, icon } = body

    // Validate
    const sanitizedTitle = sanitizeString(title || '', 200)
    if (!sanitizedTitle || sanitizedTitle.length < 5) {
      return NextResponse.json({ error: 'Title must be 5-200 characters' }, { status: 400 })
    }
    if (!category) {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 })
    }
    if (!Array.isArray(options) || options.length < 2 || options.length > 20) {
      return NextResponse.json({ error: 'Must have 2-20 options' }, { status: 400 })
    }
    if (!resolveTime || new Date(resolveTime) <= new Date()) {
      return NextResponse.json({ error: 'Resolve time must be in the future' }, { status: 400 })
    }

    const sanitizedOptions = options
      .map((o: string) => sanitizeString(o || '', 200).trim())
      .filter((o: string) => o.length > 0)

    if (sanitizedOptions.length < 2) {
      return NextResponse.json({ error: 'At least 2 valid options required' }, { status: 400 })
    }

    // Fee: one creation fee covers the whole group
    const creationFee = FEES.MARKET_CREATION_FEE
    if (creationFee > 0) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { balance: true },
      })
      if (!user || user.balance < creationFee) {
        return NextResponse.json(
          { error: `Insufficient balance. Group creation costs K${creationFee}. Balance: K${(user?.balance || 0).toFixed(2)}` },
          { status: 400 }
        )
      }
    }

    // Create group + child markets atomically
    const result = await prisma.$transaction(async (tx) => {
      // Deduct fee
      if (creationFee > 0) {
        const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
        if (!freshUser || freshUser.balance < creationFee) {
          throw new Error('Insufficient balance')
        }
        await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { decrement: creationFee } },
        })
        await tx.transaction.create({
          data: {
            type: 'MARKET_CREATION_FEE',
            amount: -creationFee,
            feeAmount: creationFee,
            description: `Market group creation fee for "${sanitizedTitle}"`,
            status: 'COMPLETED',
            userId: session.user.id,
          },
        })
      }

      // Create the group
      const group = await tx.marketGroup.create({
        data: {
          title: sanitizedTitle,
          description: description ? sanitizeString(String(description), 1000) : null,
          category: sanitizeString(category, 100).trim(),
          icon: icon || null,
          creatorId: session.user.id,
        },
      })

      // Create child binary markets for each option
      const markets = []
      for (const option of sanitizedOptions) {
        const market = await tx.market.create({
          data: {
            title: option,
            question: `${sanitizedTitle} — ${option}`,
            description: `Option "${option}" for: ${sanitizedTitle}`,
            category: sanitizeString(category, 100).trim(),
            resolveTime: new Date(resolveTime),
            creatorId: session.user.id,
            groupId: group.id,
            status: 'ACTIVE',
            marketType: 'BINARY',
            ...getCPMMBinaryInit(0.5),
          },
        })
        markets.push(market)
      }

      // Record revenue
      if (creationFee > 0) {
        await tx.platformRevenue.create({
          data: {
            feeType: 'MARKET_CREATION_FEE',
            amount: creationFee,
            description: `Market group creation for "${sanitizedTitle}"`,
            sourceType: 'MARKET_CREATION',
            sourceId: group.id,
            userId: session.user.id,
          },
        })
      }

      return { group, markets }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error('Error creating market group:', error)
    return NextResponse.json({ error: error.message || 'Failed to create market group' }, { status: 500 })
  }
}
