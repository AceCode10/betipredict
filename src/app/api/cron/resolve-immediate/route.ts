import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'
import { getMatchStatusRealtime, checkMatchesForResolution } from '@/lib/sports-api-realtime'
import crypto from 'crypto'

// Immediate resolution endpoint - runs every 2-3 minutes
// Uses real-time API for instant match status detection
// Complements the main 15-minute resolution cron

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

  try {
    // ─── Phase 1: Find active markets with live games ───
    const liveGames = await prisma.scheduledGame.findMany({
      where: {
        status: { in: ['IN_PLAY', 'LIVE'] },
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

    // ─── Phase 2: Batch check real-time status ───
    const matchIds = liveGames.map(game => game.externalId).filter((id): id is number => id != null)
    if (matchIds.length === 0) {
      return NextResponse.json({ message: 'No live games to check', resolved: [] })
    }

    console.log(`[immediate-resolve] Checking ${matchIds.length} live matches`)
    const statusResults = await checkMatchesForResolution(matchIds)

    // ─── Phase 3: Resolve finished matches immediately ───
    for (const result of statusResults) {
      const game = liveGames.find(g => g.externalId === result.matchId)
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
            // Update game status immediately
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

            console.log(`[immediate-resolve] Resolved market ${game.marketId}: ${winningOutcome}`)
          }
        } catch (err: any) {
          console.error(`[immediate-resolve] Failed to resolve market ${game.marketId}:`, err)
          resolved.push({ 
            marketId: game.marketId, 
            outcome: 'ERROR', 
            error: err.message 
          })
        }
      }
    }

    return NextResponse.json({
      message: `Immediately resolved ${resolved.filter(r => !r.error).length} markets`,
      checked: matchIds.length,
      resolved
    })

  } catch (error: any) {
    console.error('[immediate-resolve] Error:', error)
    return NextResponse.json({ 
      error: 'Immediate resolution failed', 
      message: error.message 
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
