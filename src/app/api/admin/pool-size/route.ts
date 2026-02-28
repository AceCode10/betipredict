import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { initializePool, initializeTriPool, getPrices, getTriPrices } from '@/lib/cpmm'
import { checkRateLimit } from '@/lib/rate-limit'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

/**
 * POST /api/admin/pool-size
 * Admin endpoint to adjust the virtual pool size (liquidity) for a specific market.
 * This re-initializes the CPMM pool with the new liquidity while preserving current prices.
 *
 * Body: { marketId: string, newLiquidity: number }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email.toLowerCase())) {
      return NextResponse.json({ error: 'Unauthorized — admin only' }, { status: 403 })
    }

    // Rate limit: 10 pool adjustments per minute per admin
    const rl = checkRateLimit(`admin-pool:${session.user.id}`, 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limited. Please wait.' }, { status: 429 })
    }

    const body = await request.json()
    const { marketId, newLiquidity } = body

    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 })
    }
    if (!newLiquidity || typeof newLiquidity !== 'number' || newLiquidity < 100 || newLiquidity > 1_000_000) {
      return NextResponse.json({ error: 'newLiquidity must be between 100 and 1,000,000' }, { status: 400 })
    }

    const market = await prisma.market.findUnique({ where: { id: marketId } })
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    if ((market as any).pricingEngine !== 'CPMM') {
      return NextResponse.json({ error: 'Pool size adjustment is only available for CPMM markets' }, { status: 400 })
    }

    if (market.status !== 'ACTIVE') {
      return NextResponse.json({ error: `Cannot adjust pool on ${market.status} market` }, { status: 400 })
    }

    const isTri = market.marketType === 'TRI_OUTCOME'
    let updateData: any

    if (isTri) {
      // Preserve current prices while reinitializing pool with new depth
      const homePrice = market.yesPrice || 0.33
      const drawPrice = market.drawPrice || 0.33
      const awayPrice = market.noPrice || 0.33
      const pool = initializeTriPool(newLiquidity, homePrice, drawPrice, awayPrice)
      const prices = getTriPrices(pool)
      updateData = {
        liquidity: newLiquidity,
        poolHomeShares: pool.homeShares,
        poolDrawShares: pool.drawShares,
        poolAwayShares: pool.awayShares,
        poolTriK: pool.k,
        yesPrice: Math.max(0.01, Math.min(0.99, prices.homePrice)),
        noPrice: Math.max(0.01, Math.min(0.99, prices.awayPrice)),
        drawPrice: Math.max(0.01, Math.min(0.99, prices.drawPrice)),
      }
    } else {
      // Binary market: preserve current yes price
      const currentYesPrice = market.yesPrice || 0.5
      const pool = initializePool(newLiquidity, currentYesPrice)
      const prices = getPrices(pool)
      updateData = {
        liquidity: newLiquidity,
        poolYesShares: pool.yesShares,
        poolNoShares: pool.noShares,
        poolK: pool.k,
        yesPrice: Math.max(0.01, Math.min(0.99, prices.yesPrice)),
        noPrice: Math.max(0.01, Math.min(0.99, prices.noPrice)),
      }
    }

    const updatedMarket = await prisma.market.update({
      where: { id: marketId },
      data: updateData,
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'ADJUST_POOL_SIZE',
        category: 'MARKET',
        actorId: session.user.id!,
        details: JSON.stringify({
          marketId,
          previousLiquidity: market.liquidity,
          newLiquidity,
          marketType: isTri ? 'TRI_OUTCOME' : 'BINARY',
        }),
      },
    })

    return NextResponse.json({
      success: true,
      marketId,
      previousLiquidity: market.liquidity,
      newLiquidity,
      maxBetNow: Math.round(newLiquidity * 0.10 * 100) / 100,
      updatedPrices: isTri
        ? { homePrice: updatedMarket.yesPrice, drawPrice: updatedMarket.drawPrice, awayPrice: updatedMarket.noPrice }
        : { yesPrice: updatedMarket.yesPrice, noPrice: updatedMarket.noPrice },
    })
  } catch (error: any) {
    console.error('[admin/pool-size] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to adjust pool size' }, { status: 500 })
  }
}
