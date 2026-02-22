import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { initializePool } from '@/lib/cpmm'
import { MarketResolver } from '@/lib/market-resolution'

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || ''

// Maximum age (ms) a DB-only live game is shown before being auto-expired
const MAX_LIVE_AGE_MS = 4 * 60 * 60 * 1000 // 4 hours

interface LiveMatchData {
  id: number
  homeTeam: string
  awayTeam: string
  homeTeamCrest: string | null
  awayTeamCrest: string | null
  competition: string
  competitionCode: string
  status: string
  minute: number | null
  homeScore: number | null
  awayScore: number | null
  marketId: string | null
  marketTitle: string | null
  yesPrice: number | null
  noPrice: number | null
  volume: number | null
  liquidity: number | null
}

export async function GET(request: NextRequest) {
  try {
    const liveMatches: LiveMatchData[] = []
    const apiLiveIds = new Set<number>()

    // ─── 1. Fetch currently live matches from football-data.org ───
    if (FOOTBALL_DATA_API_KEY) {
      try {
        const res = await fetch('https://api.football-data.org/v4/matches?status=IN_PLAY,PAUSED', {
          headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY },
          next: { revalidate: 30 },
        })

        if (res.ok) {
          const data = await res.json()
          for (const match of (data.matches || [])) {
            const id = match.id as number
            apiLiveIds.add(id)
            liveMatches.push({
              id,
              homeTeam: match.homeTeam?.shortName || match.homeTeam?.name || 'Home',
              awayTeam: match.awayTeam?.shortName || match.awayTeam?.name || 'Away',
              homeTeamCrest: match.homeTeam?.crest || null,
              awayTeamCrest: match.awayTeam?.crest || null,
              competition: match.competition?.name || '',
              competitionCode: match.competition?.code || '',
              status: match.status,
              minute: match.minute || null,
              homeScore: match.score?.fullTime?.home ?? match.score?.halfTime?.home ?? null,
              awayScore: match.score?.fullTime?.away ?? match.score?.halfTime?.away ?? null,
              marketId: null,
              marketTitle: null,
              yesPrice: null,
              noPrice: null,
              volume: null,
              liquidity: null,
            })
          }
        }
      } catch (err) {
        console.error('[Live Matches] Error fetching from football-data.org:', err)
      }
    }

    // ─── 2. Enrich API matches with linked market data ───
    if (liveMatches.length > 0) {
      const externalIds = liveMatches.map(m => m.id)
      const linkedGames = await prisma.scheduledGame.findMany({
        where: { externalId: { in: externalIds }, marketId: { not: null } },
        select: { externalId: true, marketId: true },
      })

      const marketIds = linkedGames.filter(g => g.marketId).map(g => g.marketId!)
      const markets = marketIds.length > 0 ? await prisma.market.findMany({
        where: { id: { in: marketIds } },
        select: { id: true, title: true, yesPrice: true, noPrice: true, volume: true, liquidity: true, status: true },
      }) : []

      const gameToMarket = new Map<number, string>()
      for (const g of linkedGames) {
        if (g.marketId) gameToMarket.set(g.externalId, g.marketId)
      }
      const marketMap = new Map(markets.map(m => [m.id, m]))

      // Update DB status to IN_PLAY for all games the API says are live
      await prisma.scheduledGame.updateMany({
        where: { externalId: { in: externalIds }, status: { not: 'IN_PLAY' } },
        data: { status: 'IN_PLAY' },
      }).catch(() => {})

      let systemUser: { id: string } | null = null

      for (const match of liveMatches) {
        const marketId = gameToMarket.get(match.id)
        if (marketId) {
          const market = marketMap.get(marketId)
          if (market) {
            // Skip markets that are already resolved/finalized
            if (['RESOLVED', 'FINALIZED', 'FINALIZING', 'CANCELLED'].includes(market.status)) continue
            match.marketId = market.id
            match.marketTitle = market.title
            match.yesPrice = market.yesPrice
            match.noPrice = market.noPrice
            match.volume = market.volume || null
            match.liquidity = market.liquidity || null
          }
        } else {
          // Auto-create market for live match that has no linked market
          try {
            if (!systemUser) {
              systemUser = await prisma.user.findFirst({ where: { email: 'system@betipredict.com' }, select: { id: true } })
              if (!systemUser) {
                const crypto = await import('crypto')
                systemUser = await prisma.user.create({
                  data: {
                    email: 'system@betipredict.com',
                    username: 'BetiPredict',
                    fullName: 'BetiPredict System',
                    password: crypto.randomBytes(32).toString('hex'),
                    isVerified: true,
                    balance: 0,
                  },
                  select: { id: true },
                })
              }
            }

            const title = `${match.homeTeam} vs ${match.awayTeam}`
            const question = `Who will win: ${match.homeTeam} vs ${match.awayTeam}?`
            const initialLiquidity = 10000
            const pool = initializePool(initialLiquidity, 0.5)

            const newMarket = await prisma.$transaction(async (tx) => {
              const m = await tx.market.create({
                data: {
                  title,
                  description: `${match.competition} - Live Match`,
                  category: 'Sports',
                  subcategory: match.competition,
                  question,
                  resolveTime: new Date(Date.now() + 4 * 60 * 60 * 1000),
                  creatorId: systemUser!.id,
                  status: 'ACTIVE',
                  yesPrice: 0.5,
                  noPrice: 0.5,
                  liquidity: initialLiquidity,
                  volume: 0,
                  homeTeam: match.homeTeam,
                  awayTeam: match.awayTeam,
                  league: match.competition,
                  poolYesShares: pool.yesShares,
                  poolNoShares: pool.noShares,
                  poolK: pool.k,
                },
              })
              const existingGame = await tx.scheduledGame.findUnique({ where: { externalId: match.id } })
              if (existingGame) {
                await tx.scheduledGame.update({ where: { id: existingGame.id }, data: { marketId: m.id, status: 'IN_PLAY' } })
              } else {
                await tx.scheduledGame.create({
                  data: {
                    externalId: match.id,
                    competition: match.competition,
                    competitionCode: match.competitionCode,
                    homeTeam: match.homeTeam,
                    awayTeam: match.awayTeam,
                    homeTeamCrest: match.homeTeamCrest,
                    awayTeamCrest: match.awayTeamCrest,
                    utcDate: new Date(),
                    status: 'IN_PLAY',
                    homeScore: match.homeScore,
                    awayScore: match.awayScore,
                    marketId: m.id,
                  },
                })
              }
              return m
            })
            match.marketId = newMarket.id
            match.marketTitle = newMarket.title
            match.yesPrice = newMarket.yesPrice
            match.noPrice = newMarket.noPrice
            match.volume = 0
            match.liquidity = initialLiquidity
            console.log(`[Live Matches] Auto-created market for live match: ${title}`)
          } catch (createErr) {
            console.error(`[Live Matches] Failed to auto-create market for match ${match.id}:`, createErr)
          }
        }
      }
    }

    // ─── 3. Expire stale DB games that the API no longer reports as live ───
    // Games marked IN_PLAY/LIVE in DB but NOT in the current API response
    // and older than MAX_LIVE_AGE_MS are almost certainly finished.
    const staleCutoff = new Date(Date.now() - MAX_LIVE_AGE_MS)
    const staleGames = await prisma.scheduledGame.findMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        utcDate: { lt: staleCutoff },
        ...(apiLiveIds.size > 0 ? { externalId: { notIn: [...apiLiveIds] } } : {}),
      },
      select: { id: true, externalId: true, marketId: true, homeTeam: true, awayTeam: true },
    })

    // Mark stale games as FINISHED and trigger resolution for their markets
    for (const game of staleGames) {
      try {
        await prisma.scheduledGame.update({
          where: { id: game.id },
          data: { status: 'FINISHED' },
        })
        // Attempt auto-resolution if the market is still active
        if (game.marketId) {
          const market = await prisma.market.findUnique({
            where: { id: game.marketId },
            select: { status: true },
          })
          if (market?.status === 'ACTIVE') {
            // Try to fetch the real result from the API
            const result = await fetchMatchResult(game.externalId)
            if (result) {
              await MarketResolver.resolveMarket(game.marketId, result).catch((e: any) =>
                console.error(`[Live Matches] Auto-resolve failed for ${game.homeTeam} vs ${game.awayTeam}:`, e.message)
              )
              console.log(`[Live Matches] Auto-resolved stale game ${game.homeTeam} vs ${game.awayTeam} → ${result}`)
            } else {
              console.log(`[Live Matches] Stale game ${game.homeTeam} vs ${game.awayTeam} marked FINISHED, no API result yet`)
            }
          }
        }
      } catch (err) {
        console.error(`[Live Matches] Error expiring stale game ${game.id}:`, err)
      }
    }

    // ─── 4. DB fallback: only recent games (last 4h) not already from API ───
    const recentCutoff = new Date(Date.now() - MAX_LIVE_AGE_MS)
    const dbLiveGames = await prisma.scheduledGame.findMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        utcDate: { gte: recentCutoff },
      },
      select: {
        externalId: true, homeTeam: true, awayTeam: true,
        homeTeamCrest: true, awayTeamCrest: true,
        competition: true, competitionCode: true,
        status: true, homeScore: true, awayScore: true, marketId: true,
      },
    })

    const dbGamesToMerge = dbLiveGames.filter(g => !apiLiveIds.has(g.externalId))

    if (dbGamesToMerge.length > 0) {
      const dbMarketIds = dbGamesToMerge.map(g => g.marketId).filter((id): id is string => !!id)
      const dbMarkets = dbMarketIds.length > 0 ? await prisma.market.findMany({
        where: { id: { in: dbMarketIds }, status: 'ACTIVE' },
        select: { id: true, title: true, yesPrice: true, noPrice: true, volume: true, liquidity: true },
      }) : []
      const dbMarketMap = new Map(dbMarkets.map(m => [m.id, m]))

      for (const game of dbGamesToMerge) {
        const market = game.marketId ? dbMarketMap.get(game.marketId) : null
        if (!market) continue // skip games without an active market
        liveMatches.push({
          id: game.externalId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          homeTeamCrest: game.homeTeamCrest,
          awayTeamCrest: game.awayTeamCrest,
          competition: game.competition,
          competitionCode: game.competitionCode,
          status: 'IN_PLAY',
          minute: null,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          marketId: market.id,
          marketTitle: market.title,
          yesPrice: market.yesPrice,
          noPrice: market.noPrice,
          volume: market.volume || null,
          liquidity: market.liquidity || null,
        })
      }
    }

    // Filter out matches whose linked market is not tradable
    const tradableMatches = liveMatches.filter(m => m.marketId)

    return NextResponse.json({
      matches: tradableMatches,
      count: tradableMatches.length,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Live Matches] Error:', error)
    return NextResponse.json({ matches: [], count: 0, error: 'Failed to fetch live matches' }, { status: 500 })
  }
}

/**
 * Fetch match result from football-data.org.
 * Returns 'YES' if home wins, 'NO' if away wins or draw.
 */
async function fetchMatchResult(matchId: number): Promise<'YES' | 'NO' | null> {
  if (!FOOTBALL_DATA_API_KEY) return null
  try {
    const res = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, {
      headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 'FINISHED') return null
    const winner = data.score?.winner
    if (!winner) return null
    if (winner === 'HOME_TEAM') return 'YES'
    if (winner === 'AWAY_TEAM' || winner === 'DRAW') return 'NO'
    return null
  } catch {
    return null
  }
}
