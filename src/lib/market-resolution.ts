import { prisma } from './prisma'

export class MarketResolver {
  static async resolveMarket(marketId: string, outcome: 'YES' | 'NO') {
    try {
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        include: {
          orders: true,
          positions: true
        }
      })

      if (!market) {
        throw new Error('Market not found')
      }

      if (market.status !== 'ACTIVE') {
        throw new Error('Market is not active')
      }

      // Update market status
      await prisma.market.update({
        where: { id: marketId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          winningOutcome: outcome
        }
      })

      // Process winning positions
      const winningPositions = await prisma.position.findMany({
        where: {
          marketId,
          outcome
        }
      })

      for (const position of winningPositions) {
        const payout = position.size * 1.0 // Winning positions pay out 1.00 per share
        
        await prisma.user.update({
          where: { id: position.userId },
          data: {
            balance: {
              increment: payout
            }
          }
        })

        // Create transaction record
        await prisma.transaction.create({
          data: {
            userId: position.userId,
            type: 'WINNINGS',
            amount: payout,
            description: `Payout for ${outcome} position in market ${marketId}`,
            status: 'COMPLETED',
            metadata: JSON.stringify({ marketId, outcome, positionId: position.id })
          }
        })
      }

      // Close all open orders
      await prisma.order.updateMany({
        where: {
          marketId,
          status: 'OPEN'
        },
        data: {
          status: 'CANCELLED'
        }
      })

      console.log(`Market ${marketId} resolved to ${outcome}`)
      return { success: true, resolved: outcome }

    } catch (error) {
      console.error('Error resolving market:', error)
      throw error
    }
  }

  static async getMarketsNeedingResolution() {
    const markets = await prisma.market.findMany({
      where: {
        status: 'ACTIVE',
        resolveTime: {
          lte: new Date()
        }
      }
    })

    return markets
  }

  static async autoResolveMarkets() {
    const markets = await this.getMarketsNeedingResolution()
    
    for (const market of markets) {
      try {
        // In a real system, this would fetch actual results from a data provider
        // For demo purposes, we'll randomly resolve markets
        const outcome = Math.random() > 0.5 ? 'YES' : 'NO'
        await this.resolveMarket(market.id, outcome)
      } catch (error) {
        console.error(`Failed to resolve market ${market.id}:`, error)
      }
    }
  }
}
