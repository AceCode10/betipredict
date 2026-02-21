import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || ''

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
    // 1. Fetch live matches from football-data.org
    const liveMatches: LiveMatchData[] = []

    if (FOOTBALL_DATA_API_KEY) {
      try {
        const res = await fetch('https://api.football-data.org/v4/matches?status=IN_PLAY,PAUSED', {
          headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY },
          next: { revalidate: 30 }, // Cache for 30s
        })

        if (res.ok) {
          const data = await res.json()
          const matches = data.matches || []

          for (const match of matches) {
            liveMatches.push({
              id: match.id,
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

    // 2. Enrich with linked market data from our DB
    if (liveMatches.length > 0) {
      const externalIds = liveMatches.map(m => m.id)
      const linkedGames = await prisma.scheduledGame.findMany({
        where: { externalId: { in: externalIds }, marketId: { not: null } },
        select: { externalId: true, marketId: true },
      })

      const marketIds = linkedGames.filter(g => g.marketId).map(g => g.marketId!) 
      const markets = marketIds.length > 0 ? await prisma.market.findMany({
        where: { id: { in: marketIds } },
        select: { id: true, title: true, yesPrice: true, noPrice: true, volume: true, liquidity: true },
      }) : []

      const gameToMarket = new Map<number, string>()
      for (const g of linkedGames) {
        if (g.marketId) gameToMarket.set(g.externalId, g.marketId)
      }
      const marketMap = new Map(markets.map(m => [m.id, m]))

      for (const match of liveMatches) {
        const marketId = gameToMarket.get(match.id)
        if (marketId) {
          const market = marketMap.get(marketId)
          if (market) {
            match.marketId = market.id
            match.marketTitle = market.title
            match.yesPrice = market.yesPrice
            match.noPrice = market.noPrice
            match.volume = market.volume || null
            match.liquidity = market.liquidity || null
          }
        }
      }
    }

    // 3. Also fetch scheduled games that are IN_PLAY in our DB (fallback for API downtime)
    const dbLiveGames = await prisma.scheduledGame.findMany({
      where: { status: { in: ['IN_PLAY', 'LIVE'] } },
      select: {
        externalId: true,
        homeTeam: true,
        awayTeam: true,
        homeTeamCrest: true,
        awayTeamCrest: true,
        competition: true,
        competitionCode: true,
        status: true,
        homeScore: true,
        awayScore: true,
        marketId: true,
      },
    })

    // Merge DB live games that aren't already in the API results
    const apiIds = new Set(liveMatches.map(m => m.id))
    const dbGamesToMerge = dbLiveGames.filter(g => !apiIds.has(g.externalId))

    // Batch-fetch all linked markets to avoid N+1 queries
    const dbMarketIds = dbGamesToMerge.map(g => g.marketId).filter((id): id is string => !!id)
    const dbMarkets = dbMarketIds.length > 0 ? await prisma.market.findMany({
      where: { id: { in: dbMarketIds } },
      select: { id: true, title: true, yesPrice: true, noPrice: true, volume: true, liquidity: true },
    }) : []
    const dbMarketMap = new Map(dbMarkets.map(m => [m.id, m]))

    for (const game of dbGamesToMerge) {
      const market = game.marketId ? dbMarketMap.get(game.marketId) : null
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
        marketId: market?.id || null,
        marketTitle: market?.title || null,
        yesPrice: market?.yesPrice || null,
        noPrice: market?.noPrice || null,
        volume: market?.volume || null,
        liquidity: market?.liquidity || null,
      })
    }

    return NextResponse.json({
      matches: liveMatches,
      count: liveMatches.length,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Live Matches] Error:', error)
    return NextResponse.json({ matches: [], count: 0, error: 'Failed to fetch live matches' }, { status: 500 })
  }
}
