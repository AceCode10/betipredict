import { prisma } from './prisma'
import { calculateResolutionFee } from './fees'

// Dispute window duration: 24 hours
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000

export class MarketResolver {
  /**
   * Phase 1: Resolve a market and open a 24h dispute window.
   * No payouts are made yet — users can dispute during this window.
   */
  static async resolveMarket(marketId: string, outcome: 'YES' | 'NO') {
    try {
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        include: { orders: true, positions: true }
      })

      if (!market) throw new Error('Market not found')
      if (market.status !== 'ACTIVE') throw new Error('Market is not active')

      const now = new Date()
      const disputeDeadline = new Date(now.getTime() + DISPUTE_WINDOW_MS)

      // Update market status to RESOLVED with dispute window
      await prisma.$transaction([
        prisma.market.update({
          where: { id: marketId },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            winningOutcome: outcome,
            disputeDeadline,
          }
        }),
        // Cancel all open orders immediately (no more trading)
        prisma.order.updateMany({
          where: { marketId, status: 'OPEN' },
          data: { status: 'CANCELLED' }
        }),
      ])

      // Notify all position holders about resolution and dispute window
      const positionHolders = await prisma.position.findMany({
        where: { marketId, isClosed: false },
        select: { userId: true, outcome: true }
      })

      const uniqueUserIds = [...new Set(positionHolders.map(p => p.userId))]
      await prisma.notification.createMany({
        data: uniqueUserIds.map(userId => ({
          type: 'MARKET_RESOLVED',
          title: 'Market Resolved',
          message: `"${market.title}" resolved to ${outcome}. Payouts will be processed after the 24h dispute window (${disputeDeadline.toISOString()}).`,
          userId,
          metadata: JSON.stringify({ marketId, outcome, disputeDeadline }),
        }))
      })

      console.log(`Market ${marketId} resolved to ${outcome}. Dispute window until ${disputeDeadline.toISOString()}`)
      return { success: true, resolved: outcome, disputeDeadline }

    } catch (error) {
      console.error('Error resolving market:', error)
      throw error
    }
  }

  /**
   * Phase 2: Finalize a resolved market after the dispute window has passed.
   * Processes payouts with resolution fee deduction.
   */
  static async finalizeMarket(marketId: string) {
    try {
      // ── Atomic finalization lock ──────────────────────────────
      // Use updateMany with WHERE status='RESOLVED' to atomically claim
      // finalization rights. If count === 0, another caller already claimed it
      // or the market isn't in the right state. This prevents double-payout
      // when cron and admin fire concurrently.
      const claimed = await prisma.market.updateMany({
        where: {
          id: marketId,
          status: 'RESOLVED',
          disputeDeadline: { lte: new Date() },
          disputes: { none: { status: 'OPEN' } },
        },
        data: { status: 'FINALIZING' },
      })

      if (claimed.count === 0) {
        // Either already finalized/finalizing, has open disputes, or window not passed
        const market = await prisma.market.findUnique({
          where: { id: marketId },
          select: { status: true, disputeDeadline: true },
        })
        if (!market) throw new Error('Market not found')
        if (market.status === 'FINALIZED' || market.status === 'FINALIZING') {
          return { success: true, finalized: 'already', feesCollected: 0 }
        }
        if (market.status !== 'RESOLVED') throw new Error(`Market is in ${market.status} state, not RESOLVED`)
        if (market.disputeDeadline && new Date() < market.disputeDeadline) {
          throw new Error(`Dispute window is still open until ${market.disputeDeadline.toISOString()}`)
        }
        throw new Error('Market has open dispute(s). Resolve disputes before finalizing.')
      }

      // We now hold the lock (status = FINALIZING). Process payouts.
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        include: { positions: true },
      })

      if (!market) throw new Error('Market not found after lock')

      const outcome = market.winningOutcome as 'YES' | 'NO'
      if (!outcome) {
        // Rollback lock
        await prisma.market.update({ where: { id: marketId }, data: { status: 'RESOLVED' } })
        throw new Error('No winning outcome set')
      }

      // Process winning positions with resolution fee deduction
      const winningPositions = await prisma.position.findMany({
        where: { marketId, outcome, isClosed: false }
      })

      let totalFeesCollected = 0

      for (const position of winningPositions) {
        const grossPayout = position.size * 1.0
        const { feeAmount, netAmount } = calculateResolutionFee(grossPayout)
        totalFeesCollected += feeAmount

        await prisma.$transaction([
          prisma.user.update({
            where: { id: position.userId },
            data: { balance: { increment: netAmount } }
          }),
          prisma.transaction.create({
            data: {
              userId: position.userId,
              type: 'WINNINGS',
              amount: netAmount,
              feeAmount,
              description: `Payout for ${outcome} position in "${market.title}" (1% resolution fee: K${feeAmount.toFixed(2)})`,
              status: 'COMPLETED',
              metadata: JSON.stringify({ marketId, outcome, positionId: position.id, grossPayout, feeAmount })
            }
          }),
          prisma.platformRevenue.create({
            data: {
              feeType: 'RESOLUTION_FEE',
              amount: feeAmount,
              description: `Resolution fee on K${grossPayout.toFixed(2)} payout for: ${market.title}`,
              sourceType: 'RESOLUTION',
              sourceId: position.id,
              userId: position.userId,
            }
          }),
          prisma.position.update({
            where: { id: position.id },
            data: { isClosed: true, realizedPnl: netAmount - (position.averagePrice * position.size) }
          })
        ])
      }

      // Close losing positions — set realizedPnl to negative cost basis (total loss)
      const losingPositions = await prisma.position.findMany({
        where: { marketId, outcome: outcome === 'YES' ? 'NO' : 'YES', isClosed: false }
      })
      for (const lp of losingPositions) {
        const costBasis = lp.size * lp.averagePrice
        await prisma.position.update({
          where: { id: lp.id },
          data: { isClosed: true, realizedPnl: -costBasis }
        })
      }

      // Finalize market (transition from FINALIZING → FINALIZED)
      await prisma.market.update({
        where: { id: marketId },
        data: { status: 'FINALIZED' }
      })

      console.log(`Market ${marketId} finalized. Fees collected: K${totalFeesCollected.toFixed(2)}`)
      return { success: true, finalized: outcome, feesCollected: totalFeesCollected }

    } catch (error) {
      // If we crash mid-finalization, rollback the lock so it can be retried
      await prisma.market.updateMany({
        where: { id: marketId, status: 'FINALIZING' },
        data: { status: 'RESOLVED' },
      }).catch(() => {})
      console.error('Error finalizing market:', error)
      throw error
    }
  }

  /**
   * Get markets that are resolved and past their dispute deadline, ready for finalization.
   */
  static async getMarketsReadyForFinalization() {
    return prisma.market.findMany({
      where: {
        status: 'RESOLVED',
        disputeDeadline: { lte: new Date() },
        disputes: { none: { status: 'OPEN' } },
      }
    })
  }

  /**
   * Auto-finalize all markets past their dispute window with no open disputes.
   */
  static async autoFinalizeMarkets() {
    const markets = await this.getMarketsReadyForFinalization()
    for (const market of markets) {
      try {
        await this.finalizeMarket(market.id)
      } catch (error) {
        console.error(`Failed to finalize market ${market.id}:`, error)
      }
    }
  }

  static async getMarketsNeedingResolution() {
    return prisma.market.findMany({
      where: {
        status: 'ACTIVE',
        resolveTime: { lte: new Date() }
      }
    })
  }

  /**
   * Auto-resolve markets using real match results from football-data.org.
   * Falls back to skipping if no result is available yet.
   */
  static async autoResolveMarkets() {
    const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || ''
    const markets = await this.getMarketsNeedingResolution()

    for (const market of markets) {
      try {
        // Find linked scheduled game
        const linkedGame = await prisma.scheduledGame.findFirst({
          where: { marketId: market.id },
          select: { id: true, externalId: true, homeTeam: true, awayTeam: true, status: true },
        })

        let outcome: 'YES' | 'NO' | null = null

        if (linkedGame && linkedGame.externalId && FOOTBALL_DATA_API_KEY) {
          // Fetch real result from football-data.org
          try {
            const res = await fetch(`https://api.football-data.org/v4/matches/${linkedGame.externalId}`, {
              headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY },
              cache: 'no-store',
            })
            if (res.ok) {
              const data = await res.json()
              if (data.status === 'FINISHED') {
                const winner = data.score?.winner
                if (winner === 'HOME_TEAM') outcome = 'YES'
                else if (winner === 'AWAY_TEAM' || winner === 'DRAW') outcome = 'NO'

                // Update game status in DB
                await prisma.scheduledGame.update({
                  where: { id: linkedGame.id },
                  data: {
                    status: 'FINISHED',
                    homeScore: data.score?.fullTime?.home ?? null,
                    awayScore: data.score?.fullTime?.away ?? null,
                    winner: winner || null,
                  },
                }).catch(() => {})
              }
            }
          } catch (apiErr) {
            console.error(`[autoResolve] API fetch failed for match ${linkedGame.externalId}:`, apiErr)
          }
        }

        if (!outcome) {
          // No result yet — skip, will retry on next cron run
          const hoursPast = (Date.now() - new Date(market.resolveTime).getTime()) / 3600000
          if (hoursPast < 2) continue // grace period
          console.log(`[autoResolve] No result for "${market.title}" (${hoursPast.toFixed(1)}h past resolve time)`)
          continue
        }

        await this.resolveMarket(market.id, outcome)
        console.log(`[autoResolve] Resolved "${market.title}" → ${outcome}`)
      } catch (error) {
        console.error(`Failed to resolve market ${market.id}:`, error)
      }
    }

    // Also finalize any markets past their dispute window
    await this.autoFinalizeMarkets()
  }
}
