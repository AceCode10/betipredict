import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMatchesForLeagues, FREE_TIER_COMPS, type CompetitionCode } from '@/lib/sports-api'
import crypto from 'crypto'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

async function requireAdmin(request?: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  if (!ADMIN_EMAILS.includes(session.user.email.toLowerCase())) return null
  return session
}

// GET: Fetch pending markets, active markets, or suggestions
export async function GET(request: NextRequest) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') || 'pending'

  try {
    if (tab === 'pending') {
      // Auto-cancel expired pending markets (resolveTime already passed)
      await prisma.market.updateMany({
        where: {
          status: 'PENDING_APPROVAL',
          resolveTime: { lte: new Date() },
        },
        data: { status: 'CANCELLED' },
      })

      const markets = await prisma.market.findMany({
        where: { status: 'PENDING_APPROVAL' },
        include: {
          scheduledGame: {
            select: {
              externalId: true,
              competition: true,
              competitionCode: true,
              homeTeamCrest: true,
              awayTeamCrest: true,
              utcDate: true,
              matchday: true,
            }
          }
        },
        orderBy: { resolveTime: 'asc' },
      })
      return NextResponse.json({ markets })
    }

    if (tab === 'active') {
      const markets = await prisma.market.findMany({
        where: { status: 'ACTIVE' },
        include: {
          scheduledGame: {
            select: {
              externalId: true,
              competition: true,
              homeTeamCrest: true,
              awayTeamCrest: true,
              utcDate: true,
              status: true,
              homeScore: true,
              awayScore: true,
            }
          },
          _count: { select: { orders: true, positions: true } },
        },
        orderBy: { resolveTime: 'asc' },
      })
      return NextResponse.json({ markets })
    }

    if (tab === 'suggestions') {
      const suggestions = await prisma.marketSuggestion.findMany({
        where: { status: 'PENDING' },
        include: {
          suggester: {
            select: { id: true, username: true, fullName: true, avatar: true }
          }
        },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json({ suggestions })
    }

    if (tab === 'stats') {
      const [pending, active, resolved, totalVolume] = await Promise.all([
        prisma.market.count({ where: { status: 'PENDING_APPROVAL' } }),
        prisma.market.count({ where: { status: 'ACTIVE' } }),
        prisma.market.count({ where: { status: { in: ['RESOLVED', 'FINALIZED'] } } }),
        prisma.market.aggregate({ _sum: { volume: true } }),
      ])
      return NextResponse.json({
        pending,
        active,
        resolved,
        totalVolume: totalVolume._sum.volume || 0,
      })
    }

    return NextResponse.json({ error: 'Invalid tab' }, { status: 400 })
  } catch (error: any) {
    console.error('[market-maker] GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Approve, deny, set prices, or sync
export async function POST(request: NextRequest) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { action } = body

    // ─── APPROVE MARKET ───
    if (action === 'approve') {
      const { marketId, homePrice, drawPrice, awayPrice } = body
      if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 })

      const hp = parseFloat(homePrice)
      const dp = parseFloat(drawPrice)
      const ap = parseFloat(awayPrice)

      if (isNaN(hp) || isNaN(dp) || isNaN(ap)) {
        return NextResponse.json({ error: 'All three prices are required' }, { status: 400 })
      }
      if (hp < 0.01 || hp > 0.99 || dp < 0.01 || dp > 0.99 || ap < 0.01 || ap > 0.99) {
        return NextResponse.json({ error: 'Prices must be between 1% and 99%' }, { status: 400 })
      }
      if (hp + dp + ap > 1.0) {
        return NextResponse.json({ error: `Prices sum to ${((hp + dp + ap) * 100).toFixed(0)}% which exceeds 100%. Reduce prices before approving.` }, { status: 400 })
      }

      const market = await prisma.market.findUnique({ where: { id: marketId } })
      if (!market) return NextResponse.json({ error: 'Market not found' }, { status: 404 })
      if (market.status !== 'PENDING_APPROVAL') {
        return NextResponse.json({ error: 'Market is not pending approval' }, { status: 400 })
      }

      const updated = await prisma.market.update({
        where: { id: marketId },
        data: {
          status: 'ACTIVE',
          yesPrice: hp,
          noPrice: ap,
          drawPrice: dp,
        }
      })

      return NextResponse.json({ message: 'Market approved', market: updated })
    }

    // ─── BULK APPROVE ───
    if (action === 'bulk-approve') {
      const { marketIds, homePrice, drawPrice, awayPrice } = body
      if (!Array.isArray(marketIds) || marketIds.length === 0) {
        return NextResponse.json({ error: 'marketIds array required' }, { status: 400 })
      }

      const hp = parseFloat(homePrice)
      const dp = parseFloat(drawPrice)
      const ap = parseFloat(awayPrice)

      if (isNaN(hp) || isNaN(dp) || isNaN(ap)) {
        return NextResponse.json({ error: 'All three prices are required' }, { status: 400 })
      }
      if (hp + dp + ap > 1.0) {
        return NextResponse.json({ error: `Prices sum to ${((hp + dp + ap) * 100).toFixed(0)}% which exceeds 100%. Reduce prices before approving.` }, { status: 400 })
      }

      const result = await prisma.market.updateMany({
        where: { id: { in: marketIds }, status: 'PENDING_APPROVAL' },
        data: {
          status: 'ACTIVE',
          yesPrice: hp,
          noPrice: ap,
          drawPrice: dp,
        }
      })

      return NextResponse.json({ message: `Approved ${result.count} markets` })
    }

    // ─── DENY MARKET ───
    if (action === 'deny') {
      const { marketId } = body
      if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 })

      const market = await prisma.market.findUnique({ where: { id: marketId } })
      if (!market) return NextResponse.json({ error: 'Market not found' }, { status: 404 })

      await prisma.market.update({
        where: { id: marketId },
        data: { status: 'CANCELLED' }
      })

      return NextResponse.json({ message: 'Market denied' })
    }

    // ─── SET PRICES (without approving) ───
    if (action === 'set-price') {
      const { marketId, homePrice, drawPrice, awayPrice } = body
      if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 })

      const updates: any = {}
      if (homePrice !== undefined) updates.yesPrice = parseFloat(homePrice)
      if (awayPrice !== undefined) updates.noPrice = parseFloat(awayPrice)
      if (drawPrice !== undefined) updates.drawPrice = parseFloat(drawPrice)

      const updated = await prisma.market.update({
        where: { id: marketId },
        data: updates,
      })

      return NextResponse.json({ message: 'Prices updated', market: updated })
    }

    // ─── SYNC GAMES ───
    if (action === 'sync') {
      const { league } = body
      const leagues: CompetitionCode[] = league && FREE_TIER_COMPS.includes(league)
        ? [league as CompetitionCode]
        : FREE_TIER_COMPS.slice(0, 2) // Default: first 2 to avoid timeout

      const matches = await getMatchesForLeagues(leagues, 14)
      if (!matches || matches.length === 0) {
        return NextResponse.json({ message: 'No upcoming matches found', created: 0, skipped: 0, leagues })
      }

      let systemUser = await prisma.user.findFirst({ where: { email: 'system@betipredict.com' } })
      if (!systemUser) {
        systemUser = await prisma.user.create({
          data: {
            email: 'system@betipredict.com',
            username: 'BetiPredict',
            fullName: 'BetiPredict System',
            password: crypto.randomBytes(32).toString('hex'),
            isVerified: true,
            balance: 0,
          }
        })
      }

      let created = 0, skipped = 0
      const errors: string[] = []

      for (const match of matches) {
        try {
          const existingGame = await prisma.scheduledGame.findUnique({
            where: { externalId: match.id },
            include: { market: { select: { id: true, status: true } } }
          })

          if (existingGame?.marketId && existingGame.market) {
            if (['PENDING_APPROVAL', 'ACTIVE', 'RESOLVED', 'FINALIZING'].includes(existingGame.market.status)) {
              skipped++
              continue
            }
          }

          const matchDate = new Date(match.utcDate)
          if (matchDate <= new Date(Date.now() + 60 * 60 * 1000)) {
            skipped++
            continue
          }

          const homeShort = match.homeTeam.shortName || match.homeTeam.name
          const awayShort = match.awayTeam.shortName || match.awayTeam.name
          const title = `${homeShort} vs ${awayShort}`
          const question = `Who will win: ${match.homeTeam.name} vs ${match.awayTeam.name}?`

          await prisma.$transaction(async (tx) => {
            const newMarket = await tx.market.create({
              data: {
                title,
                description: `${match.competition.name} - Matchday ${match.matchday || 'N/A'}`,
                category: 'Football',
                subcategory: match.competition.name,
                question,
                resolveTime: matchDate,
                creatorId: systemUser!.id,
                status: 'PENDING_APPROVAL',
                marketType: 'TRI_OUTCOME',
                pricingEngine: 'CLOB',
                yesPrice: 0.33,
                noPrice: 0.33,
                drawPrice: 0.33,
                liquidity: 0,
                volume: 0,
                homeTeam: homeShort,
                awayTeam: awayShort,
                league: match.competition.name,
              }
            })

            if (existingGame) {
              await tx.scheduledGame.update({
                where: { id: existingGame.id },
                data: { marketId: newMarket.id }
              })
            } else {
              await tx.scheduledGame.create({
                data: {
                  externalId: match.id,
                  competition: match.competition.name,
                  competitionCode: match.competition.code || '',
                  homeTeam: homeShort,
                  awayTeam: awayShort,
                  homeTeamCrest: match.homeTeam.crest || null,
                  awayTeamCrest: match.awayTeam.crest || null,
                  matchday: match.matchday || null,
                  utcDate: matchDate,
                  status: 'SCHEDULED',
                  marketId: newMarket.id,
                }
              })
            }
          })

          created++
        } catch (e: any) {
          errors.push(`${match.id}: ${e.message}`)
        }
      }

      return NextResponse.json({ message: `Synced ${leagues.join(',')}`, created, skipped, errors, leagues })
    }

    // ─── APPROVE SUGGESTION ───
    if (action === 'approve-suggestion') {
      const { suggestionId, homePrice, drawPrice, awayPrice, category, title, question } = body
      if (!suggestionId) return NextResponse.json({ error: 'suggestionId required' }, { status: 400 })

      const suggestion = await prisma.marketSuggestion.findUnique({
        where: { id: suggestionId },
        include: { suggester: true }
      })
      if (!suggestion) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })

      const hp = parseFloat(homePrice) || 0.5
      const dp = parseFloat(drawPrice) || 0
      const ap = parseFloat(awayPrice) || 0.5

      // Validate price sum
      const sum = hp + dp + ap
      if (sum > 1.0) {
        return NextResponse.json({ error: `Prices sum to ${(sum * 100).toFixed(0)}% which exceeds 100%` }, { status: 400 })
      }

      const finalTitle = (title || '').trim() || suggestion.title
      const finalQuestion = (question || '').trim() || suggestion.question
      const finalCategory = (category || '').trim() || suggestion.category
      const isTri = dp > 0
      const marketType = isTri ? 'TRI_OUTCOME' : 'BINARY'

      // Create market from suggestion
      const market = await prisma.$transaction(async (tx) => {
        const newMarket = await tx.market.create({
          data: {
            title: finalTitle,
            description: suggestion.description || '',
            category: finalCategory,
            question: finalQuestion,
            resolveTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days
            creatorId: suggestion.suggesterId,
            status: 'ACTIVE',
            pricingEngine: 'CLOB',
            marketType,
            yesPrice: hp,
            noPrice: ap,
            drawPrice: isTri ? dp : undefined,
            liquidity: 0,
            volume: 0,
          }
        })

        await tx.marketSuggestion.update({
          where: { id: suggestionId },
          data: {
            status: 'APPROVED',
            marketId: newMarket.id,
            title: finalTitle,
            question: finalQuestion,
            category: finalCategory,
          }
        })

        return newMarket
      })

      return NextResponse.json({ message: 'Suggestion approved', market })
    }

    // ─── DENY SUGGESTION ───
    if (action === 'deny-suggestion') {
      const { suggestionId, reason } = body
      if (!suggestionId) return NextResponse.json({ error: 'suggestionId required' }, { status: 400 })

      await prisma.marketSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'REJECTED', rejectionReason: reason || 'Rejected by market maker' }
      })

      return NextResponse.json({ message: 'Suggestion denied' })
    }

    // ─── REVERT ACTIVE MARKETS TO PENDING (for legacy 50% markets) ───
    if (action === 'revert-to-pending') {
      const { marketId } = body
      if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 })

      const market = await prisma.market.findUnique({ where: { id: marketId } })
      if (!market) return NextResponse.json({ error: 'Market not found' }, { status: 404 })

      await prisma.market.update({
        where: { id: marketId },
        data: { status: 'PENDING_APPROVAL' }
      })

      return NextResponse.json({ message: 'Market reverted to pending approval' })
    }

    // ─── REVERT ALL LEGACY ACTIVE MARKETS (with default 50% pricing) ───
    if (action === 'revert-legacy') {
      // Find ACTIVE sports markets still at 50/50 or 33/33/33 default pricing with zero volume
      const legacy = await prisma.market.findMany({
        where: {
          status: 'ACTIVE',
          category: { in: ['Sports', 'Football'] },
          volume: 0,
        }
      })

      let reverted = 0
      for (const m of legacy) {
        await prisma.market.update({
          where: { id: m.id },
          data: { status: 'PENDING_APPROVAL' }
        })
        reverted++
      }

      return NextResponse.json({ message: `Reverted ${reverted} legacy markets to pending approval` })
    }

    // ─── MANAGE CATEGORIES ───
    if (action === 'get-categories') {
      // Return current categories from settings or defaults
      try {
        const setting = await (prisma as any).platformSetting.findUnique({ where: { key: 'categories' } })
        if (setting?.value) {
          return NextResponse.json({ categories: JSON.parse(setting.value) })
        }
      } catch {
        // PlatformSetting model may not exist yet
      }
      // Return defaults
      const { DEFAULT_CATEGORIES } = await import('@/lib/categories')
      return NextResponse.json({ categories: DEFAULT_CATEGORIES })
    }

    if (action === 'save-categories') {
      const { categories } = body
      if (!Array.isArray(categories)) {
        return NextResponse.json({ error: 'categories array required' }, { status: 400 })
      }
      // Validate each category has value, label, icon
      for (const cat of categories) {
        if (!cat.value || !cat.label) {
          return NextResponse.json({ error: 'Each category must have value and label' }, { status: 400 })
        }
      }
      // Store in platformSetting if the model exists, otherwise just acknowledge
      try {
        await (prisma as any).platformSetting.upsert({
          where: { key: 'categories' },
          create: { key: 'categories', value: JSON.stringify(categories) },
          update: { value: JSON.stringify(categories) },
        })
      } catch {
        // PlatformSetting model may not exist yet — categories will use defaults
      }
      return NextResponse.json({ message: `Saved ${categories.length} categories` })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('[market-maker] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
