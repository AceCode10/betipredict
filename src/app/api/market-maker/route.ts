import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMatchesForLeagues, FREE_TIER_COMPS, type CompetitionCode } from '@/lib/sports-api'
import { fetchOddsForLeague, findMatchOdds, isOddsApiConfigured, type MatchOdds } from '@/lib/odds-api'
import { LEAGUE_DISPLAY_NAMES } from '@/lib/league-names'
import { getCPMMTriInit, getCPMMBinaryInit } from '@/lib/fees'
import crypto from 'crypto'

// Allow longer execution for sync + refresh-odds (external API calls)
export const maxDuration = 60

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

    // ─── BULK APPROVE (per-market prices) ───
    if (action === 'bulk-approve') {
      const { marketPrices } = body
      if (!Array.isArray(marketPrices) || marketPrices.length === 0) {
        return NextResponse.json({ error: 'marketPrices array required' }, { status: 400 })
      }

      // Validate each market's prices
      for (const mp of marketPrices) {
        if (!mp.id || isNaN(mp.homePrice) || isNaN(mp.drawPrice) || isNaN(mp.awayPrice)) {
          return NextResponse.json({ error: `Invalid prices for market ${mp.id}` }, { status: 400 })
        }
        if (mp.homePrice + mp.drawPrice + mp.awayPrice > 1.05) {
          return NextResponse.json({ error: `Prices for market ${mp.id} sum to ${((mp.homePrice + mp.drawPrice + mp.awayPrice) * 100).toFixed(0)}% which exceeds 100%` }, { status: 400 })
        }
      }

      // Approve each market with its individual prices
      let approved = 0
      for (const mp of marketPrices) {
        try {
          await prisma.market.update({
            where: { id: mp.id, status: 'PENDING_APPROVAL' },
            data: {
              status: 'ACTIVE',
              yesPrice: mp.homePrice,
              noPrice: mp.awayPrice,
              drawPrice: mp.drawPrice,
            }
          })
          approved++
        } catch {
          // Skip markets that don't exist or aren't pending
        }
      }

      return NextResponse.json({ message: `Approved ${approved} markets with individual prices` })
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

      // Fetch odds for each league (if Odds API is configured)
      const oddsMap = new Map<string, MatchOdds[]>()
      let oddsCount = 0
      if (isOddsApiConfigured()) {
        for (const lg of leagues) {
          try {
            const odds = await fetchOddsForLeague(lg)
            if (odds.length > 0) {
              oddsMap.set(lg, odds)
              oddsCount += odds.length
            }
          } catch (err: any) {
            console.warn(`[market-maker sync] Failed to fetch odds for ${lg}:`, err.message)
          }
        }
      }

      let created = 0, skipped = 0, oddsApplied = 0
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

          // Look up odds for this match
          const leagueCode = match.competition.code || ''
          const leagueOdds = oddsMap.get(leagueCode as string) || []
          const matchOdds = findMatchOdds(
            leagueOdds,
            match.homeTeam.name,
            match.awayTeam.name,
            matchDate
          )

          // Use odds-based pricing if available, otherwise default 0.33/0.33/0.33
          let yesPrice = 0.33
          let noPrice = 0.33
          let drawPrice = 0.33

          if (matchOdds) {
            yesPrice = matchOdds.homePrice
            drawPrice = matchOdds.drawPrice
            noPrice = matchOdds.awayPrice
            oddsApplied++
            console.log(`[market-maker sync] Odds for ${title}: H=${yesPrice.toFixed(2)} D=${drawPrice.toFixed(2)} A=${noPrice.toFixed(2)}`)
          }

          const displayLeague = LEAGUE_DISPLAY_NAMES[match.competition.name] || match.competition.name

          await prisma.$transaction(async (tx) => {
            const newMarket = await tx.market.create({
              data: {
                title,
                description: `${displayLeague} - Matchday ${match.matchday || 'N/A'}`,
                category: 'Football',
                subcategory: match.competition.name,
                question,
                resolveTime: matchDate,
                creatorId: systemUser!.id,
                status: 'PENDING_APPROVAL',
                marketType: 'TRI_OUTCOME',
                ...getCPMMTriInit(yesPrice, drawPrice, noPrice),
                volume: 0,
                homeTeam: homeShort,
                awayTeam: awayShort,
                league: displayLeague,
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

      return NextResponse.json({ message: `Synced ${leagues.join(',')}`, created, skipped, oddsApplied, oddsCount, errors, leagues })
    }

    // ─── APPROVE SUGGESTION ───
    if (action === 'approve-suggestion') {
      const { suggestionId, homePrice, drawPrice, awayPrice, category, title, question, description } = body
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
      const finalDescription = description !== undefined ? (description || '').trim() : (suggestion.description || '')
      const isTri = dp > 0
      const marketType = isTri ? 'TRI_OUTCOME' : 'BINARY'

      // Check if this is a multi-option suggestion
      const isMulti = suggestion.questionType !== 'yes-no' && suggestion.options

      if (isMulti) {
        // Multi-option: create MarketGroup + child Markets
        const options: string[] = JSON.parse(suggestion.options!)
        const group = await prisma.$transaction(async (tx) => {
          const g = await tx.marketGroup.create({
            data: {
              title: finalTitle,
              description: finalDescription,
              category: finalCategory,
              displayType: suggestion.questionType === 'yes-no' ? 'multi-option' : suggestion.questionType,
              icon: suggestion.questionType === 'sentiment' ? '📊' : suggestion.questionType === 'range' ? '📈' : suggestion.questionType === 'date' ? '📅' : suggestion.questionType === 'head-to-head' ? '⚔️' : '🏆',
              creatorId: suggestion.suggesterId,
            }
          })
          for (const opt of options) {
            await tx.market.create({
              data: {
                title: opt,
                question: `${finalTitle} — ${opt}`,
                description: `Option "${opt}" for: ${finalTitle}`,
                category: finalCategory,
                resolveTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                creatorId: suggestion.suggesterId,
                groupId: g.id,
                status: 'ACTIVE',
                marketType: 'BINARY',
                ...getCPMMBinaryInit(0.5),
              }
            })
          }
          await tx.marketSuggestion.update({
            where: { id: suggestionId },
            data: { status: 'APPROVED', groupId: g.id, title: finalTitle, question: finalQuestion, category: finalCategory }
          })
          return g
        })
        return NextResponse.json({ message: `Suggestion approved as group with ${options.length} options`, group })
      }

      // Single market (yes/no or tri-outcome)
      const market = await prisma.$transaction(async (tx) => {
        const newMarket = await tx.market.create({
          data: {
            title: finalTitle,
            description: finalDescription,
            category: finalCategory,
            question: finalQuestion,
            resolveTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            creatorId: suggestion.suggesterId,
            status: 'ACTIVE',
            ...(isTri ? getCPMMTriInit(hp, dp, ap) : getCPMMBinaryInit(hp)),
            marketType,
            volume: 0,
          }
        })
        await tx.marketSuggestion.update({
          where: { id: suggestionId },
          data: { status: 'APPROVED', marketId: newMarket.id, title: finalTitle, question: finalQuestion, category: finalCategory }
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

    // ─── REFRESH ODDS on existing pending markets ───
    if (action === 'refresh-odds') {
      if (!isOddsApiConfigured()) {
        return NextResponse.json({ error: 'Odds API not configured' }, { status: 503 })
      }

      // Get all pending markets with scheduledGame data (no marketType filter — older markets may have BINARY default)
      const pendingWithGames = await prisma.market.findMany({
        where: { status: 'PENDING_APPROVAL' },
        include: {
          scheduledGame: {
            select: { competitionCode: true, homeTeam: true, awayTeam: true, utcDate: true }
          }
        }
      })

      if (pendingWithGames.length === 0) {
        return NextResponse.json({ message: 'No pending markets to refresh', updated: 0 })
      }

      // Collect unique league codes
      const leagueCodes = new Set<string>()
      for (const m of pendingWithGames) {
        if (m.scheduledGame?.competitionCode) leagueCodes.add(m.scheduledGame.competitionCode)
      }

      // Fetch odds for each league
      const oddsMap = new Map<string, MatchOdds[]>()
      for (const code of leagueCodes) {
        try {
          const odds = await fetchOddsForLeague(code)
          if (odds.length > 0) oddsMap.set(code, odds)
        } catch (err: any) {
          console.warn(`[refresh-odds] Failed for ${code}:`, err.message)
        }
      }

      let updated = 0, noOdds = 0
      for (const market of pendingWithGames) {
        const sg = market.scheduledGame
        if (!sg) { noOdds++; continue }

        const leagueOdds = oddsMap.get(sg.competitionCode) || []
        const matchOdds = findMatchOdds(leagueOdds, sg.homeTeam, sg.awayTeam, new Date(sg.utcDate))

        if (matchOdds) {
          await prisma.market.update({
            where: { id: market.id },
            data: {
              yesPrice: matchOdds.homePrice,
              drawPrice: matchOdds.drawPrice,
              noPrice: matchOdds.awayPrice,
              marketType: 'TRI_OUTCOME', // Ensure correct type
            }
          })
          updated++
        } else {
          // Set sane defaults if still at Prisma defaults (0.5/0.5) or uniform 0.33
          const isDefault = (
            (market.yesPrice === 0.5 && market.noPrice === 0.5) ||
            (Math.round(market.yesPrice * 100) === 33 && Math.round(market.noPrice * 100) === 33)
          )
          if (isDefault) {
            // Already at defaults, no odds available — count but don't re-update
            noOdds++
          } else {
            noOdds++
          }
        }
      }

      return NextResponse.json({
        message: updated > 0
          ? `Refreshed odds: ${updated} updated with real odds, ${noOdds} no odds available`
          : `Found ${pendingWithGames.length} pending markets but no odds available from API. Markets keep current prices.`,
        updated,
        noOdds,
        total: pendingWithGames.length,
      })
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
