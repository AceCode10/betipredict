import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Watchlist is stored in UserSettings.language field as JSON (repurposing until schema migration)
// Better approach: use a dedicated Watchlist model. For now, store in a simple in-memory + DB approach.
// We'll use Notification model with type='WATCHLIST' as a lightweight storage mechanism.

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get watchlist entries (stored as notifications with type WATCHLIST)
    const watchlistEntries = await prisma.notification.findMany({
      where: {
        userId: session.user.id,
        type: 'WATCHLIST',
      },
      select: {
        id: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const marketIds = watchlistEntries
      .map(e => { try { return JSON.parse(e.metadata || '{}').marketId } catch { return null } })
      .filter(Boolean)

    // Fetch market data for watchlisted markets
    const markets = marketIds.length > 0
      ? await prisma.market.findMany({
          where: { id: { in: marketIds } },
          select: {
            id: true,
            title: true,
            question: true,
            yesPrice: true,
            noPrice: true,
            volume: true,
            status: true,
            category: true,
            resolveTime: true,
          }
        })
      : []

    return NextResponse.json({ watchlist: markets })
  } catch (error) {
    console.error('Error fetching watchlist:', error)
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { marketId } = await request.json()
    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'Market ID required' }, { status: 400 })
    }

    // Check if already watchlisted
    const existing = await prisma.notification.findFirst({
      where: {
        userId: session.user.id,
        type: 'WATCHLIST',
        metadata: { contains: marketId },
      }
    })

    if (existing) {
      // Remove from watchlist
      await prisma.notification.delete({ where: { id: existing.id } })
      return NextResponse.json({ watched: false })
    }

    // Add to watchlist
    await prisma.notification.create({
      data: {
        userId: session.user.id,
        type: 'WATCHLIST',
        title: 'Watchlist',
        message: 'Market added to watchlist',
        metadata: JSON.stringify({ marketId }),
        isRead: true,
      }
    })

    return NextResponse.json({ watched: true })
  } catch (error) {
    console.error('Error toggling watchlist:', error)
    return NextResponse.json({ error: 'Failed to update watchlist' }, { status: 500 })
  }
}
