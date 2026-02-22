import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MarketResolver } from '@/lib/market-resolution'
import crypto from 'crypto'

// Webhook endpoint for instant match status updates
// Sports data providers can POST here when matches finish
// Provides immediate resolution without polling delays

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''

function verifyWebhookSignature(request: NextRequest): boolean {
  if (!WEBHOOK_SECRET) return false
  
  const signature = request.headers.get('x-webhook-signature')
  if (!signature) return false

  const body = request.body
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )
}

interface MatchStatusWebhook {
  matchId: number
  status: 'FINISHED' | 'IN_PLAY' | 'CANCELLED'
  winner?: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW'
  finalScore?: {
    home: number
    away: number
  }
  timestamp: string
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook authenticity
    if (!verifyWebhookSignature(request)) {
      console.warn('[webhook] Invalid signature received')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload: MatchStatusWebhook = await request.json()
    
    // Validate payload
    if (!payload.matchId || !payload.status) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    console.log(`[webhook] Match ${payload.matchId} status: ${payload.status}`)

    // Find associated game and market
    const game = await prisma.scheduledGame.findFirst({
      where: {
        externalId: payload.matchId.toString(),
        marketId: { not: null }
      },
      include: {
        market: {
          select: { id: true, status: true }
        }
      }
    })

    if (!game || !game.marketId) {
      console.log(`[webhook] No market found for match ${payload.matchId}`)
      return NextResponse.json({ message: 'No associated market' })
    }

    // Only process if market is still active
    if (game.market?.status !== 'ACTIVE') {
      console.log(`[webhook] Market ${game.marketId} already processed`)
      return NextResponse.json({ message: 'Market already resolved' })
    }

    // Handle finished matches
    if (payload.status === 'FINISHED' && payload.winner) {
      try {
        // Update game status
        await prisma.scheduledGame.update({
          where: { id: game.id },
          data: {
            status: 'FINISHED',
            winner: payload.winner
          }
        })

        // Map winner to market outcome
        let winningOutcome: 'YES' | 'NO' | null = null
        if (payload.winner === 'HOME_TEAM') {
          winningOutcome = 'YES'  // "Will home team win?"
        } else {
          winningOutcome = 'NO'   // Away team win or draw
        }

        if (winningOutcome) {
          // Resolve the market immediately
          await MarketResolver.resolveMarket(game.marketId, winningOutcome)
          
          console.log(`[webhook] Immediately resolved market ${game.marketId}: ${winningOutcome}`)
          
          return NextResponse.json({
            message: 'Market resolved immediately',
            marketId: game.marketId,
            outcome: winningOutcome,
            timestamp: new Date().toISOString()
          })
        }
      } catch (err: any) {
        console.error(`[webhook] Failed to resolve market ${game.marketId}:`, err)
        return NextResponse.json({ 
          error: 'Resolution failed', 
          message: err.message 
        }, { status: 500 })
      }
    }

    // Handle cancelled matches
    if (payload.status === 'CANCELLED') {
      try {
        await prisma.scheduledGame.update({
          where: { id: game.id },
          data: { status: 'CANCELLED' }
        })

        // For cancelled matches, you might want to refund all bets
        // This would require custom logic in MarketResolver
        console.log(`[webhook] Match ${payload.matchId} cancelled`)
        
        return NextResponse.json({
          message: 'Match cancelled',
          marketId: game.marketId,
          status: 'CANCELLED'
        })
      } catch (err: any) {
        console.error(`[webhook] Failed to handle cancellation:`, err)
        return NextResponse.json({ 
          error: 'Cancellation failed', 
          message: err.message 
        }, { status: 500 })
      }
    }

    return NextResponse.json({ message: 'Status updated' })

  } catch (error: any) {
    console.error('[webhook] Error:', error)
    return NextResponse.json({ 
      error: 'Webhook processing failed', 
      message: error.message 
    }, { status: 500 })
  }
}
