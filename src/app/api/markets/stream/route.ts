import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// SSE endpoint for real-time market data updates
// Clients connect and receive periodic market snapshots + recent activity
// Security: read-only, no auth required for public market data

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Stream closed
        }
      }

      // Send initial market snapshot
      try {
        const markets = await prisma.market.findMany({
          where: { status: { in: ['ACTIVE', 'PENDING'] } },
          select: {
            id: true,
            title: true,
            question: true,
            yesPrice: true,
            noPrice: true,
            volume: true,
            liquidity: true,
            status: true,
            category: true,
            subcategory: true,
            resolveTime: true,
          },
          orderBy: { volume: 'desc' },
          take: 50,
        })
        send('snapshot', { markets, timestamp: Date.now() })
      } catch (err) {
        console.error('[SSE] snapshot error:', err)
      }

      // Poll for updates every 10 seconds (gentle on connection pool)
      let consecutiveErrors = 0
      const interval = setInterval(async () => {
        // Back off if DB is struggling — skip polls after repeated failures
        if (consecutiveErrors >= 3) {
          consecutiveErrors = Math.max(0, consecutiveErrors - 1) // slowly recover
          return
        }
        try {
          // Fetch current prices + liquidity for all active markets
          const markets = await prisma.market.findMany({
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              yesPrice: true,
              noPrice: true,
              volume: true,
              liquidity: true,
            },
          })
          send('prices', { markets, timestamp: Date.now() })
          consecutiveErrors = 0

          // Fetch recent trades (last 15 seconds)
          const since = new Date(Date.now() - 15_000)
          const recentOrders = await prisma.order.findMany({
            where: {
              createdAt: { gte: since },
              status: 'FILLED',
            },
            select: {
              id: true,
              side: true,
              outcome: true,
              price: true,
              amount: true,
              createdAt: true,
              marketId: true,
              user: { select: { username: true } },
              market: { select: { title: true, question: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
          })

          if (recentOrders.length > 0) {
            send('trades', { trades: recentOrders, timestamp: Date.now() })
          }
        } catch (err: any) {
          consecutiveErrors++
          // Only log first error to avoid spam
          if (consecutiveErrors === 1) {
            console.warn('[SSE] poll error (will back off):', err?.code || err?.message || 'unknown')
          }
        }
      }, 10000)

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(interval)
          clearInterval(heartbeat)
        }
      }, 30000)

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        clearInterval(interval)
        clearInterval(heartbeat)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
