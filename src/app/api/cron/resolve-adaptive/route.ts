import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'
import { getMatchesToCheckNow, checkMatchesForResolution, getTodayFinishedMatches } from '@/lib/sports-api-optimized'
import crypto from 'crypto'

// Adaptive resolution that adjusts frequency based on match patterns
// - More frequent during peak match times
// - Less frequent during quiet periods
// - Respects 10 calls/minute limit intelligently

const CRON_SECRET = process.env.CRON_SECRET || ''

function verifyCronAuth(request: NextRequest): boolean {
  if (!CRON_SECRET) return false
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(CRON_SECRET))
  } catch {
    return false
  }
}

// Determine if we're in peak match time
function isPeakMatchTime(): boolean {
  const now = new Date()
  const hour = now.getHours()
  const dayOfWeek = now.getDay()
  
  // Peak times: 
  // - Weekdays: 6PM-10PM UTC (most European matches)
  // - Weekends: 2PM-10PM UTC (full day of matches)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Monday-Friday
    return hour >= 18 && hour <= 22
  } else { // Saturday-Sunday
    return hour >= 14 && hour <= 22
  }
}

// Calculate optimal check interval based on current conditions
function getOptimalInterval(): number {
  const peakTime = isPeakMatchTime()
  const now = new Date()
  const hour = now.getHours()
  
  if (peakTime) {
    return 3 * 60 * 1000 // 3 minutes during peak times
  } else if (hour >= 12 && hour <= 23) {
    return 5 * 60 * 1000 // 5 minutes during daytime
  } else {
    return 10 * 60 * 1000 // 10 minutes overnight
  }
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resolved: { marketId: string; outcome: string; error?: string }[] = []
  const stats = {
    apiCallsUsed: 0,
    peakTime: isPeakMatchTime(),
    intervalMinutes: Math.round(getOptimalInterval() / 60000),
    strategy: ''
  }

  // Global deadline: return before cron-job.org 30s timeout
  const DEADLINE_MS = 25_000
  const startTime = Date.now()
  const isOverDeadline = () => Date.now() - startTime > DEADLINE_MS

  try {
    console.log(`[adaptive-resolve] Starting adaptive cycle (peak: ${stats.peakTime}, interval: ${stats.intervalMinutes}min)`)

    // ─── Strategy 1: Check for recently finished matches (1 API call) ───
    const todayFinished = await getTodayFinishedMatches()
    stats.apiCallsUsed += 1
    stats.strategy = 'finished-check'

    // Find markets that should be resolved but aren't
    const recentlyFinishedIds = todayFinished.map(m => Number(m.id))
    const pendingGames = await prisma.scheduledGame.findMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        externalId: { in: recentlyFinishedIds },
        marketId: { not: null }
      }
    })

    // Resolve any missed matches immediately
    for (const game of pendingGames) {
      const matchData = todayFinished.find(m => Number(m.id) === game.externalId)
      if (matchData && matchData.score?.winner) {
        try {
          let winningOutcome: 'YES' | 'NO' | null = null
          if (matchData.score.winner === 'HOME_TEAM') {
            winningOutcome = 'YES'
          } else {
            winningOutcome = 'NO'
          }

          if (winningOutcome && game.marketId) {
            await prisma.scheduledGame.update({
              where: { id: game.id },
              data: { status: 'FINISHED', winner: matchData.score.winner }
            })

            await MarketResolver.resolveMarket(game.marketId, winningOutcome)
            resolved.push({ marketId: game.marketId, outcome: winningOutcome })
            console.log(`[adaptive-resolve] Caught missed match: ${game.homeTeam} vs ${game.awayTeam}`)
          }
        } catch (err: any) {
          console.error(`[adaptive-resolve] Failed to resolve missed match ${game.marketId ?? game.id}:`, err)
        }
      }
    }

    // ─── Strategy 2: Proactive checking during peak times ───
    if (stats.peakTime && stats.apiCallsUsed < 8 && !isOverDeadline()) { // Leave room for error margin
      stats.strategy = 'proactive-check'
      const matchesToCheck = await getMatchesToCheckNow()
      stats.apiCallsUsed += 1

      if (matchesToCheck.length > 0 && stats.apiCallsUsed + matchesToCheck.length <= 10) {
        const liveGames = await prisma.scheduledGame.findMany({
          where: {
            status: { in: ['IN_PLAY', 'LIVE'] },
            externalId: { in: matchesToCheck },
            marketId: { not: null }
          }
        })

        if (liveGames.length > 0) {
          const matchIdsToCheck = liveGames.map(g => g.externalId)
          const statusResults = await checkMatchesForResolution(matchIdsToCheck)
          stats.apiCallsUsed += matchIdsToCheck.length

          for (const result of statusResults) {
            if (isOverDeadline()) break
            const game = liveGames.find(g => g.externalId === result.matchId)
            if (!game || !game.marketId) continue

            if (result.isFinished && result.winner) {
              try {
                let winningOutcome: 'YES' | 'NO' | null = null
                if (result.winner === 'HOME_TEAM') {
                  winningOutcome = 'YES'
                } else {
                  winningOutcome = 'NO'
                }

                if (winningOutcome && game.marketId) {
                  await prisma.scheduledGame.update({
                    where: { id: game.id },
                    data: { status: 'FINISHED', winner: result.winner }
                  })

                  await MarketResolver.resolveMarket(game.marketId, winningOutcome)
                  resolved.push({ marketId: game.marketId, outcome: winningOutcome })
                }
              } catch (err: any) {
                console.error(`[adaptive-resolve] Failed to resolve ${game.marketId}:`, err)
                resolved.push({ marketId: game.marketId, outcome: 'ERROR', error: err.message })
              }
            }
          }
        }
      }
    }

    // ─── Strategy 3: Cleanup stale games (no API call) ───
    const staleCutoff = new Date(Date.now() - 8 * 60 * 60 * 1000) // 8 hours
    const staleGames = await prisma.scheduledGame.updateMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        utcDate: { lt: staleCutoff }
      },
      data: { status: 'FINISHED' }
    })

    return NextResponse.json({
      message: `Adaptive cycle complete: resolved ${resolved.filter(r => !r.error).length} markets`,
      strategy: stats.strategy,
      stats: {
        ...stats,
        staleGamesCleaned: staleGames.count,
        nextCheckMinutes: stats.intervalMinutes
      },
      resolved
    })

  } catch (error: any) {
    console.error('[adaptive-resolve] Error:', error)
    return NextResponse.json({ 
      error: 'Adaptive resolution failed', 
      message: error.message,
      stats 
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
