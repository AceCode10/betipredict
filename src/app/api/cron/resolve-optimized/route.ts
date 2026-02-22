import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'
import { getMatchesToCheckNow, checkMatchesForResolution } from '@/lib/sports-api-optimized'
import crypto from 'crypto'

// Optimized resolution cron for MVP using football-data.org free tier
// Strategy: Smart batching + intelligent scheduling + rate limiting
// Runs every 5 minutes to stay within 10 calls/minute limit

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

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resolved: { marketId: string; outcome: string; error?: string }[] = []
  const apiCallsUsed = { live: 0, individual: 0, total: 0 }

  try {
    console.log('[optimized-resolve] Starting optimized resolution cycle')

    // ─── Phase 1: Smart match selection (1 API call) ───
    const matchesToCheck = await getMatchesToCheckNow()
    apiCallsUsed.live = 1
    apiCallsUsed.total = 1

    if (matchesToCheck.length === 0) {
      return NextResponse.json({ 
        message: 'No matches require checking (all too recent)',
        apiCallsUsed,
        resolved: [] 
      })
    }

    console.log(`[optimized-resolve] Checking ${matchesToCheck.length} matches likely to finish soon`)

    // ─── Phase 2: Find associated markets ───
    const liveGames = await prisma.scheduledGame.findMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        externalId: { in: matchesToCheck.map(id => id.toString()) },
        marketId: { not: null }
      },
      select: { 
        id: true, 
        externalId: true, 
        marketId: true, 
        homeTeam: true, 
        awayTeam: true 
      }
    })

    if (liveGames.length === 0) {
      return NextResponse.json({ 
        message: 'No associated markets found for matches',
        matchesChecked: matchesToCheck.length,
        apiCallsUsed,
        resolved: [] 
      })
    }

    // ─── Phase 3: Batch check with rate limiting ───
    const matchIdsToCheck = liveGames.map(game => parseInt(game.externalId!))
    const statusResults = await checkMatchesForResolution(matchIdsToCheck)
    apiCallsUsed.individual = matchIdsToCheck.length
    apiCallsUsed.total += matchIdsToCheck.length

    console.log(`[optimized-resolve] Used ${apiCallsUsed.total} API calls (limit: 10/minute)`)

    // ─── Phase 4: Resolve finished matches ───
    for (const result of statusResults) {
      const game = liveGames.find(g => parseInt(g.externalId!) === result.matchId)
      if (!game || !game.marketId) continue

      if (result.isFinished && result.winner) {
        try {
          // Map winner to market outcome
          let winningOutcome: 'YES' | 'NO' | null = null
          if (result.winner === 'HOME_TEAM') {
            winningOutcome = 'YES'  // "Will home team win?"
          } else {
            winningOutcome = 'NO'   // Away team win or draw
          }

          if (winningOutcome) {
            // Update game status
            await prisma.scheduledGame.update({
              where: { id: game.id },
              data: {
                status: 'FINISHED',
                winner: result.winner
              }
            })

            // Resolve the market
            await MarketResolver.resolveMarket(game.marketId, winningOutcome)
            resolved.push({ 
              marketId: game.marketId, 
              outcome: winningOutcome 
            })

            console.log(`[optimized-resolve] Resolved ${game.homeTeam} vs ${game.awayTeam}: ${winningOutcome}`)
          }
        } catch (err: any) {
          console.error(`[optimized-resolve] Failed to resolve market ${game.marketId}:`, err)
          resolved.push({ 
            marketId: game.marketId, 
            outcome: 'ERROR', 
            error: err.message 
          })
        }
      }
    }

    // ─── Phase 5: Clean up stale games (no API call needed) ───
    const staleCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours
    const staleGames = await prisma.scheduledGame.updateMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        utcDate: { lt: staleCutoff }
      },
      data: { status: 'FINISHED' }
    })

    if (staleGames.count > 0) {
      console.log(`[optimized-resolve] Marked ${staleGames.count} stale games as finished`)
    }

    return NextResponse.json({
      message: `Optimized cycle complete: resolved ${resolved.filter(r => !r.error).length} markets`,
      matchesChecked: matchesToCheck.length,
      marketsFound: liveGames.length,
      apiCallsUsed,
      staleGamesCleaned: staleGames.count,
      resolved
    })

  } catch (error: any) {
    console.error('[optimized-resolve] Error:', error)
    return NextResponse.json({ 
      error: 'Optimized resolution failed', 
      message: error.message,
      apiCallsUsed 
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
