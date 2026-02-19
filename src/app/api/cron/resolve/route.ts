import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// Automatic market resolution endpoint
// Called by a cron service (e.g., Vercel Cron, external scheduler)
// Security: requires CRON_SECRET header to prevent unauthorized calls

const CRON_SECRET = process.env.CRON_SECRET || ''

function verifyCronAuth(request: NextRequest): boolean {
  if (!CRON_SECRET) return false
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(CRON_SECRET))
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  // Verify cron authentication
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: { marketId: string; outcome: string; payouts: number; error?: string }[] = []

  try {
    // 1. Find all active markets past their resolve time
    const marketsToResolve = await prisma.market.findMany({
      where: {
        status: 'ACTIVE',
        resolveTime: { lte: new Date() },
      },
      include: {
        positions: { where: { isClosed: false } },
      },
    })

    if (marketsToResolve.length === 0) {
      return NextResponse.json({ message: 'No markets to resolve', resolved: 0 })
    }

    // 2. For each market, try to determine the outcome from sports API
    for (const market of marketsToResolve) {
      try {
        // Check if this market is linked to a scheduled game
        const linkedGame = await prisma.scheduledGame.findFirst({
          where: { marketId: market.id },
        })

        let winningOutcome: 'YES' | 'NO' | null = null

        if (linkedGame && linkedGame.externalId) {
          // Try to fetch real result from football-data.org
          winningOutcome = await fetchMatchResult(linkedGame.externalId, market)

          // Update the scheduled game record
          if (winningOutcome) {
            await prisma.scheduledGame.update({
              where: { id: linkedGame.id },
              data: {
                status: 'FINISHED',
                winner: winningOutcome === 'YES' ? 'HOME_TEAM' : 'AWAY_TEAM',
              },
            }).catch(() => {}) // Non-critical update
          }
        }

        // If we couldn't determine from API, check if the market is significantly past resolve time
        // (more than 4 hours past) — in that case, leave it for manual resolution
        if (!winningOutcome) {
          const hoursPast = (Date.now() - new Date(market.resolveTime).getTime()) / 3600000
          if (hoursPast < 4) {
            // Not enough time past — skip, will retry on next cron run
            continue
          }
          // If significantly past and no API result, skip — needs manual resolution
          results.push({ marketId: market.id, outcome: 'PENDING', payouts: 0, error: 'No result available from API' })
          continue
        }

        // 3. Execute resolution in a transaction
        await prisma.$transaction(async (tx) => {
          // Update market
          await tx.market.update({
            where: { id: market.id },
            data: {
              status: 'RESOLVED',
              winningOutcome,
              resolvedAt: new Date(),
            },
          })

          // Process payouts for winners
          let totalPaid = 0
          const winningPositions = market.positions.filter(p => p.outcome === winningOutcome)

          for (const pos of winningPositions) {
            const payout = pos.size // Each winning share pays K1
            totalPaid += payout

            await tx.user.update({
              where: { id: pos.userId },
              data: { balance: { increment: payout } },
            })

            await tx.transaction.create({
              data: {
                type: 'TRADE',
                amount: payout,
                description: `Payout: ${winningOutcome} wins in "${market.title}"`,
                status: 'COMPLETED',
                userId: pos.userId,
                metadata: JSON.stringify({ marketId: market.id, winningOutcome, type: 'AUTO_PAYOUT' }),
              },
            })

            // Send notification
            await tx.notification.create({
              data: {
                type: pos.outcome === winningOutcome ? 'BET_WON' : 'BET_LOST',
                title: pos.outcome === winningOutcome ? 'You won!' : 'Market resolved',
                message: pos.outcome === winningOutcome
                  ? `Your ${pos.outcome} bet on "${market.title}" won! Payout: K${payout.toFixed(2)}`
                  : `"${market.title}" resolved to ${winningOutcome}. Your ${pos.outcome} position lost.`,
                userId: pos.userId,
              },
            })
          }

          // Notify losers too
          const losingPositions = market.positions.filter(p => p.outcome !== winningOutcome)
          for (const pos of losingPositions) {
            await tx.notification.create({
              data: {
                type: 'BET_LOST',
                title: 'Market resolved',
                message: `"${market.title}" resolved to ${winningOutcome}. Your ${pos.outcome} position lost.`,
                userId: pos.userId,
              },
            })
          }

          // Close all positions
          await tx.position.updateMany({
            where: { marketId: market.id },
            data: { isClosed: true },
          })

          // Cancel open orders
          await tx.order.updateMany({
            where: { marketId: market.id, status: 'OPEN' },
            data: { status: 'CANCELLED' },
          })

          results.push({ marketId: market.id, outcome: winningOutcome!, payouts: totalPaid })
        })
      } catch (err: any) {
        console.error(`[cron] Failed to resolve market ${market.id}:`, err)
        results.push({ marketId: market.id, outcome: 'ERROR', payouts: 0, error: err.message })
      }
    }

    return NextResponse.json({
      message: `Processed ${marketsToResolve.length} markets`,
      resolved: results.filter(r => !r.error).length,
      results,
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
