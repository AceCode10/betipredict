import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { initializeDatabase } from '@/lib/db-init'
import { checkRateLimit, getClientIp, sanitizeString } from '@/lib/rate-limit'
import { FEES } from '@/lib/fees'
import { initializePool } from '@/lib/cpmm'

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

    // ─── Expire stale games inline (same logic as /api/matches/live) ───
    // This ensures finished games are cleaned up even if the live endpoint isn't hit
    const STALE_CUTOFF_MS = 4 * 60 * 60 * 1000
    const staleCutoff = new Date(Date.now() - STALE_CUTOFF_MS)
    await prisma.scheduledGame.updateMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        utcDate: { lt: staleCutoff },
      },
      data: { status: 'FINISHED' },
    }).catch(() => {})

    // Enrich with game status + crests from ScheduledGame
    const marketIds = markets.map(m => m.id)
    const linkedGames = marketIds.length > 0
      ? await prisma.scheduledGame.findMany({
          where: { marketId: { in: marketIds } },
          select: {
            marketId: true, status: true,
            homeScore: true, awayScore: true,
            homeTeamCrest: true, awayTeamCrest: true,
            utcDate: true,
          },
        })
      : []
    const gameMap = new Map(linkedGames.map(g => [g.marketId, g]))

    const enriched = markets
      .map(m => {
        const game = gameMap.get(m.id)
        const isLive = game ? ['IN_PLAY', 'LIVE'].includes(game.status) : false
        const isGameFinished = game?.status === 'FINISHED'
        // Hide ACTIVE markets whose linked game is already finished
        // (these should be resolved, not shown as tradable)
        const isTradable = m.status === 'ACTIVE' && !isGameFinished && new Date(m.resolveTime) > new Date()
        return {
          ...m,
          isLive,
          isTradable,
          gameStatus: game?.status ?? null,
          liveHomeScore: isLive ? (game?.homeScore ?? null) : null,
          liveAwayScore: isLive ? (game?.awayScore ?? null) : null,
          homeTeamCrest: game?.homeTeamCrest ?? null,
          awayTeamCrest: game?.awayTeamCrest ?? null,
          matchDate: game?.utcDate ?? m.resolveTime,
        }
      })
      // Filter: only show tradable ACTIVE markets, or non-ACTIVE markets (resolved/finalized for history)
      .filter(m => {
        if (m.status === 'ACTIVE') return m.isTradable
        return true // show resolved/finalized markets for reference
      })

    return NextResponse.json(enriched)
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

    // Charge market creation fee for custom markets (not for scheduled game markets)
    const isScheduledGame = externalGameId && typeof externalGameId === 'number'
    const creationFee = isScheduledGame ? 0 : FEES.MARKET_CREATION_FEE

    if (creationFee > 0) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { balance: true },
      })

      if (!user || user.balance < creationFee) {
        return NextResponse.json(
          { error: `Insufficient balance. Market creation costs K${creationFee}. Your balance: K${(user?.balance || 0).toFixed(2)}` },
          { status: 400 }
        )
      }
    }

    // Create market and deduct fee atomically
    const market = await prisma.$transaction(async (tx) => {
      // Deduct creation fee if applicable
      if (creationFee > 0) {
        const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
        if (!freshUser || freshUser.balance < creationFee) {
          throw new Error(`Insufficient balance for market creation fee (K${creationFee})`)
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
            description: `Market creation fee for "${title.trim()}"`,
            status: 'COMPLETED',
            userId: session.user.id,
          }
        })
      }

      const pool = initializePool(FEES.DEFAULT_INITIAL_LIQUIDITY, 0.5)
      const newMarket = await tx.market.create({
        data: {
          title: title.trim(),
          description: description ? sanitizeString(String(description), 1000) : null,
          category: sanitizeString(category, 100).trim(),
          subcategory: subcategory ? sanitizeString(String(subcategory), 100) : null,
          question: question.trim(),
          resolveTime: new Date(resolveTime),
          creatorId: session.user.id,
          status: 'ACTIVE',
          liquidity: FEES.DEFAULT_INITIAL_LIQUIDITY,
          yesPrice: 0.5,
          noPrice: 0.5,
          poolYesShares: pool.yesShares,
          poolNoShares: pool.noShares,
          poolK: pool.k,
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

      // Record platform revenue
      if (creationFee > 0) {
        await tx.platformRevenue.create({
          data: {
            feeType: 'MARKET_CREATION_FEE',
            amount: creationFee,
            description: `Market creation fee for "${title.trim()}"`,
            sourceType: 'MARKET_CREATION',
            sourceId: newMarket.id,
            userId: session.user.id,
          }
        })
      }

      return newMarket
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
