import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'
import crypto from 'crypto'

// Automatic market resolution endpoint
// Called by a cron service (e.g., Vercel Cron, external scheduler)
// Security: requires CRON_SECRET header to prevent unauthorized calls
//
// This cron does TWO things:
// 1. Resolves active markets past their resolveTime (opens 24h dispute window)
// 2. Finalizes resolved markets past their dispute deadline (processes payouts)

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
  const finalized: { marketId: string; outcome: string; feesCollected?: number; error?: string }[] = []

  try {
    // ─── Phase 0: Expire stale live games in DB ───
    // Games stuck as IN_PLAY for >4h that the football API no longer reports as live
    const staleCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000)
    const staleGames = await prisma.scheduledGame.findMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
        utcDate: { lt: staleCutoff },
      },
      select: { id: true, externalId: true, marketId: true, homeTeam: true, awayTeam: true },
    })

    for (const game of staleGames) {
      await prisma.scheduledGame.update({
        where: { id: game.id },
        data: { status: 'FINISHED' },
      }).catch(() => {})
    }

    // ─── Phase 1: Resolve active markets past their resolve time ───
    const marketsToResolve = await prisma.market.findMany({
      where: {
        status: 'ACTIVE',
        resolveTime: { lte: new Date() },
      },
    })

    for (const market of marketsToResolve) {
      try {
        const linkedGame = await prisma.scheduledGame.findFirst({
          where: { marketId: market.id },
        })

        let winningOutcome: 'YES' | 'NO' | null = null

        if (linkedGame && linkedGame.externalId) {
          winningOutcome = await fetchMatchResult(linkedGame.externalId, market)

          if (winningOutcome) {
            await prisma.scheduledGame.update({
              where: { id: linkedGame.id },
              data: {
                status: 'FINISHED',
                winner: winningOutcome === 'YES' ? 'HOME_TEAM' : 'AWAY_TEAM',
              },
            }).catch(() => {})
          }
        }

        if (!winningOutcome) {
          // Grace period: wait 2h past resolveTime before flagging
          const hoursPast = (Date.now() - new Date(market.resolveTime).getTime()) / 3600000
          if (hoursPast < 2) continue
          resolved.push({ marketId: market.id, outcome: 'PENDING', error: 'No result available from API' })
          continue
        }

        // Use MarketResolver: sets status=RESOLVED, opens 24h dispute window, NO payouts yet
        await MarketResolver.resolveMarket(market.id, winningOutcome)
        resolved.push({ marketId: market.id, outcome: winningOutcome })
      } catch (err: any) {
        console.error(`[cron] Failed to resolve market ${market.id}:`, err)
        resolved.push({ marketId: market.id, outcome: 'ERROR', error: err.message })
      }
    }

    // ─── Phase 2: Finalize resolved markets past dispute deadline ───
    const marketsToFinalize = await MarketResolver.getMarketsReadyForFinalization()

    for (const market of marketsToFinalize) {
      try {
        const result = await MarketResolver.finalizeMarket(market.id)
        finalized.push({ marketId: market.id, outcome: result.finalized, feesCollected: result.feesCollected })
      } catch (err: any) {
        console.error(`[cron] Failed to finalize market ${market.id}:`, err)
        finalized.push({ marketId: market.id, outcome: 'ERROR', error: err.message })
      }
    }

    return NextResponse.json({
      message: `Resolved ${resolved.filter(r => !r.error).length}, finalized ${finalized.filter(f => !f.error).length}`,
      resolved,
      finalized,
    })
  } catch (error: any) {
    console.error('[cron] Resolution error:', error)
    return NextResponse.json({ error: 'Resolution failed', message: error.message }, { status: 500 })
  }
}

/**
 * Fetch match result from football-data.org API
 * Returns 'YES' if home team wins, 'NO' if away team wins or draw
 * (simplified binary outcome matching the market question "Will [home] beat [away]?")
 */
async function fetchMatchResult(matchId: number, market: any): Promise<'YES' | 'NO' | null> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, {
      headers: { 'X-Auth-Token': apiKey },
      cache: 'no-store',
    })

    if (!res.ok) return null

    const data = await res.json()

    if (data.status !== 'FINISHED') return null

    // Determine outcome based on match result
    const winner = data.score?.winner
    if (!winner) return null

    // "Will [home team] beat [away team]?" → YES = home wins, NO = away wins or draw
    if (winner === 'HOME_TEAM') return 'YES'
    if (winner === 'AWAY_TEAM' || winner === 'DRAW') return 'NO'

    return null
  } catch (err) {
    console.error(`[cron] Error fetching match ${matchId}:`, err)
    return null
  }
}

// Also support GET for Vercel Cron (which uses GET by default)
export async function GET(request: NextRequest) {
  return POST(request)
}
