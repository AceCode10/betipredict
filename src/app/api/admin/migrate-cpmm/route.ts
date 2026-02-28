import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCPMMBinaryInit, getCPMMTriInit } from '@/lib/fees'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

/**
 * POST /api/admin/migrate-cpmm
 * Migrates ALL existing CLOB markets (with no pool state) to CPMM.
 * Preserves current prices; initializes pool shares and K values.
 * Safe to run multiple times — only touches markets missing pool data.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email.toLowerCase())) {
      return NextResponse.json({ error: 'Unauthorized — admin only' }, { status: 403 })
    }

    // Find all active markets that are still on CLOB or missing pool state
    const markets = await prisma.market.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { pricingEngine: 'CLOB' },
          { poolK: null, poolTriK: null },
        ],
      },
    })

    let migrated = 0
    let skipped = 0
    const results: any[] = []

    for (const market of markets) {
      const isTri = market.marketType === 'TRI_OUTCOME'

      try {
        if (isTri) {
          const homePrice = market.yesPrice || 0.34
          const drawPrice = market.drawPrice || 0.33
          const awayPrice = market.noPrice || 0.33
          const init = getCPMMTriInit(homePrice, drawPrice, awayPrice)

          await prisma.market.update({
            where: { id: market.id },
            data: {
              pricingEngine: 'CPMM',
              liquidity: init.liquidity,
              yesPrice: init.yesPrice,
              noPrice: init.noPrice,
              drawPrice: init.drawPrice,
              poolHomeShares: init.poolHomeShares,
              poolDrawShares: init.poolDrawShares,
              poolAwayShares: init.poolAwayShares,
              poolTriK: init.poolTriK,
            },
          })
          results.push({ id: market.id, title: market.title, type: 'TRI', status: 'migrated' })
          migrated++
        } else {
          const yesPrice = market.yesPrice || 0.5
          const init = getCPMMBinaryInit(yesPrice)

          await prisma.market.update({
            where: { id: market.id },
            data: {
              pricingEngine: 'CPMM',
              liquidity: init.liquidity,
              yesPrice: init.yesPrice,
              noPrice: init.noPrice,
              poolYesShares: init.poolYesShares,
              poolNoShares: init.poolNoShares,
              poolK: init.poolK,
            },
          })
          results.push({ id: market.id, title: market.title, type: 'BINARY', status: 'migrated' })
          migrated++
        }
      } catch (err: any) {
        results.push({ id: market.id, title: market.title, status: 'error', error: err.message })
        skipped++
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'MIGRATE_CLOB_TO_CPMM',
        category: 'SYSTEM',
        actorId: session.user.id!,
        details: JSON.stringify({ total: markets.length, migrated, skipped }),
      },
    })

    return NextResponse.json({
      success: true,
      total: markets.length,
      migrated,
      skipped,
      results,
    })
  } catch (error: any) {
    console.error('[admin/migrate-cpmm] Error:', error)
    return NextResponse.json({ error: error.message || 'Migration failed' }, { status: 500 })
  }
}
