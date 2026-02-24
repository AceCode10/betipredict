import { prisma } from './prisma'
import { calculateResolutionFee } from './fees'

// Dispute window duration: 2 hours (Polymarket-style challenge period)
// Sports markets with clear API-verified outcomes use short windows.
const DISPUTE_WINDOW_MS = 2 * 60 * 60 * 1000

export class MarketResolver {
  /**
   * Phase 1: Resolve a market and open a 24h dispute window.
   * No payouts are made yet — users can dispute during this window.
   */
  static async resolveMarket(marketId: string, outcome: 'YES' | 'NO' | 'HOME' | 'DRAW' | 'AWAY') {
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
      // Fetch resting orders BEFORE cancelling them so we can refund
      const restingOrders = await prisma.order.findMany({
        where: { marketId, status: { in: ['OPEN', 'PARTIALLY_FILLED'] }, remaining: { gt: 0 } },
        select: { id: true, userId: true, side: true, outcome: true, price: true, remaining: true },
      })

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
        // Cancel all open/partial orders immediately (no more trading)
        prisma.order.updateMany({
          where: { marketId, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
          data: { status: 'CANCELLED', remaining: 0 }
        }),
      ])

      // Refund reserved funds for cancelled resting CLOB orders
      for (const order of restingOrders) {
        try {
          if (order.side === 'BUY') {
            // Refund: remaining shares * price * (1 + fee rate)
            const refund = order.remaining * order.price * 1.02
            if (refund > 0) {
              await prisma.user.update({
                where: { id: order.userId },
                data: { balance: { increment: refund } },
              })
              await prisma.transaction.create({
                data: {
                  type: 'REFUND',
                  amount: refund,
                  feeAmount: 0,
                  description: `Refund for cancelled BUY order (market resolved): ${order.remaining.toFixed(2)} ${order.outcome} shares`,
                  status: 'COMPLETED',
                  userId: order.userId,
                },
              })
            }
          } else {
            // SELL order: return locked shares to position
            if (order.remaining > 0) {
              const position = await prisma.position.findUnique({
                where: { userId_marketId_outcome: { userId: order.userId, marketId, outcome: order.outcome } },
              })
              if (position) {
                await prisma.position.update({
                  where: { id: position.id },
                  data: { size: { increment: order.remaining }, isClosed: false },
                })
              } else {
                await prisma.position.create({
                  data: { userId: order.userId, marketId, outcome: order.outcome, size: order.remaining, averagePrice: order.price },
                })
              }
            }
          }
        } catch (refundErr) {
          console.error(`[Resolution] Failed to refund order ${order.id}:`, refundErr)
        }
      }

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
          message: `"${market.title}" resolved to ${outcome}. Payouts will be processed after the 2h dispute window (${disputeDeadline.toLocaleString()}).`,
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

      const outcome = market.winningOutcome
      if (!outcome) {
        await prisma.market.update({ where: { id: marketId }, data: { status: 'RESOLVED' } })
        throw new Error('No winning outcome set')
      }

      // Process winning positions with resolution fee deduction
      const winningPositions = await prisma.position.findMany({
        where: { marketId, outcome, isClosed: false }
      })

      let totalFeesCollected = 0

      for (const position of winningPositions) {
        if (position.isClosed) continue

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

      // Close losing positions — all positions NOT matching the winning outcome
      const losingPositions = await prisma.position.findMany({
        where: { marketId, outcome: { not: outcome }, isClosed: false }
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

  /**
   * Admin early finalization: skip the dispute window when outcome is clearly correct.
   * Only admins should call this. Bypasses the disputeDeadline check.
   */
  static async earlyFinalizeMarket(marketId: string) {
    try {
      const market = await prisma.market.findUnique({ where: { id: marketId } })
      if (!market) throw new Error('Market not found')
      if (market.status !== 'RESOLVED') throw new Error('Market must be RESOLVED to early-finalize')

      // Check for open disputes — cannot early-finalize if disputed
      const openDisputes = await prisma.marketDispute.count({
        where: { marketId, status: 'OPEN' }
      })
      if (openDisputes > 0) throw new Error('Cannot early-finalize: market has open disputes')

      // Force the dispute deadline to now so finalizeMarket can proceed
      await prisma.market.update({
        where: { id: marketId },
        data: { disputeDeadline: new Date() }
      })

      return this.finalizeMarket(marketId)
    } catch (error) {
      console.error('Error early-finalizing market:', error)
      throw error
    }
  }

  /**
   * Void a market: refund all position holders their cost basis.
   * Used when a match ends in a DRAW (binary market can't resolve to either side).
   */
  static async voidMarket(marketId: string, reason: string = 'Match ended in a draw') {
    try {
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        include: { positions: true }
      })
      if (!market) throw new Error('Market not found')
      if (market.status === 'FINALIZED' || market.status === 'CANCELLED') {
        return { success: true, voided: 'already', refunds: 0 }
      }

      const openPositions = market.positions.filter(p => !p.isClosed)
      const payouts: { userId: string; amount: number }[] = []
      for (const pos of openPositions) {
        const refund = pos.size * pos.averagePrice
        if (refund > 0) payouts.push({ userId: pos.userId, amount: refund })
      }

      await prisma.$transaction(async (tx) => {
        await tx.market.update({
          where: { id: marketId },
          data: { status: 'FINALIZED', winningOutcome: 'VOID', resolvedAt: new Date() }
        })
        await tx.order.updateMany({
          where: { marketId, status: 'OPEN' },
          data: { status: 'CANCELLED' }
        })
        for (const payout of payouts) {
          await tx.user.update({
            where: { id: payout.userId },
            data: { balance: { increment: payout.amount } }
          })
          await tx.transaction.create({
            data: {
              type: 'TRADE',
              amount: payout.amount,
              description: `Refund: ${reason} — "${market.title}"`,
              status: 'COMPLETED',
              userId: payout.userId,
              metadata: JSON.stringify({ marketId, winningOutcome: 'VOID', type: 'REFUND' })
            }
          })
        }
        await tx.position.updateMany({
          where: { marketId },
          data: { isClosed: true }
        })
      })

      const totalRefunded = payouts.reduce((s, p) => s + p.amount, 0)
      console.log(`Market ${marketId} VOIDED (${reason}). Refunded ${payouts.length} positions, total K${totalRefunded.toFixed(2)}`)
      return { success: true, voided: 'VOID', refunds: payouts.length, totalRefunded }
    } catch (error) {
      console.error('Error voiding market:', error)
      throw error
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

        let outcome: 'YES' | 'NO' | 'HOME' | 'DRAW' | 'AWAY' | null = null
        const isTri = (market as any).marketType === 'TRI_OUTCOME'

        if (linkedGame && linkedGame.externalId && FOOTBALL_DATA_API_KEY) {
          try {
            const res = await fetch(`https://api.football-data.org/v4/matches/${linkedGame.externalId}`, {
              headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY },
              cache: 'no-store',
            })
            if (res.ok) {
              const data = await res.json()
              if (data.status === 'FINISHED') {
                const winner = data.score?.winner
                await prisma.scheduledGame.update({
                  where: { id: linkedGame.id },
                  data: {
                    status: 'FINISHED',
                    homeScore: data.score?.fullTime?.home ?? null,
                    awayScore: data.score?.fullTime?.away ?? null,
                    winner: winner || null,
                  },
                }).catch(() => {})

                if (isTri) {
                  // 3-outcome market: HOME/DRAW/AWAY are all valid outcomes
                  if (winner === 'HOME_TEAM') outcome = 'HOME'
                  else if (winner === 'AWAY_TEAM') outcome = 'AWAY'
                  else if (winner === 'DRAW') outcome = 'DRAW'
                } else {
                  // Legacy binary market: DRAW still voids
                  if (winner === 'HOME_TEAM') outcome = 'YES'
                  else if (winner === 'AWAY_TEAM') outcome = 'NO'
                  else if (winner === 'DRAW') {
                    await this.voidMarket(market.id, 'Match ended in a draw')
                    console.log(`[autoResolve] DRAW — voided binary market "${market.title}"`)
                    continue
                  }
                }
              }
            }
          } catch (apiErr) {
            console.error(`[autoResolve] API fetch failed for match ${linkedGame.externalId}:`, apiErr)
          }
        }

        if (!outcome) {
          const hoursPast = (Date.now() - new Date(market.resolveTime).getTime()) / 3600000
          if (hoursPast < 2) continue
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
