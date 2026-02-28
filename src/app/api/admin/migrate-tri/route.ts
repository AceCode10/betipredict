import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCPMMTriInit } from '@/lib/fees'

// Migrate existing BINARY sports markets to TRI_OUTCOME with CPMM pricing
// Only accessible by admin users
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    if (!adminEmails.includes(session.user.email.toLowerCase())) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Find all BINARY sports markets that have a "vs" in the title (match-winner markets)
    const binaryMatchMarkets = await prisma.market.findMany({
      where: {
        marketType: 'BINARY',
        category: 'Sports',
        status: 'ACTIVE',
        title: { contains: ' vs ' },
      },
      select: {
        id: true,
        title: true,
        yesPrice: true,
        noPrice: true,
        liquidity: true,
        volume: true,
      }
    })

    const results = { migrated: 0, skipped: 0, errors: [] as string[] }

    for (const market of binaryMatchMarkets) {
      try {
        // Derive initial placeholder prices from current yes/no
        const currentHome = market.yesPrice || 0.5
        const currentAway = market.noPrice || 0.5
        const drawPct = 0.25
        const homeScaled = currentHome * (1 - drawPct)
        const awayScaled = currentAway * (1 - drawPct)
        const total = homeScaled + drawPct + awayScaled
        const homePrice = homeScaled / total
        const drawPrice = drawPct / total
        const awayPrice = awayScaled / total

        // Migrate to TRI_OUTCOME with CPMM pricing + initialized pool
        const cpmmInit = getCPMMTriInit(homePrice, drawPrice, awayPrice)
        await (prisma.market.update as any)({
          where: { id: market.id },
          data: {
            marketType: 'TRI_OUTCOME',
            ...cpmmInit,
            // Clear binary pool state
            poolYesShares: null,
            poolNoShares: null,
            poolK: null,
          }
        })

        results.migrated++
      } catch (err: any) {
        results.errors.push(`${market.id}: ${err.message}`)
      }
    }

    return NextResponse.json({
      message: `Migration complete. Found ${binaryMatchMarkets.length} BINARY sports markets. Migrated to TRI_OUTCOME + CPMM.`,
      ...results,
    })
  } catch (error: any) {
    console.error('[migrate-tri] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
