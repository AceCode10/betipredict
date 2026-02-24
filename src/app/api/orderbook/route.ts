import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { OrderBook } from '@/lib/clob'

/**
 * GET /api/orderbook?marketId=xxx&outcome=YES
 * Returns the order book snapshot for a specific market outcome.
 * For TRI_OUTCOME markets, outcome must be HOME, DRAW, or AWAY.
 * For BINARY markets, outcome must be YES or NO.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const marketId = searchParams.get('marketId')
    const outcome = searchParams.get('outcome')
    const depthStr = searchParams.get('depth')
    const depth = depthStr ? Math.min(parseInt(depthStr), 50) : 10

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 })
    }

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: {
        id: true,
        marketType: true,
        pricingEngine: true,
        bookYes: true,
        bookNo: true,
        bookDraw: true,
        yesPrice: true,
        noPrice: true,
        drawPrice: true,
        status: true,
      }
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    if ((market as any).pricingEngine !== 'CLOB') {
      // For legacy CPMM markets, return synthetic "book" from pool prices
      return NextResponse.json({
        marketId,
        pricingEngine: 'CPMM',
        message: 'This market uses automated market maker pricing, not an order book.',
        prices: {
          yesPrice: market.yesPrice,
          noPrice: market.noPrice,
          drawPrice: market.drawPrice,
        }
      })
    }

    const isTri = (market as any).marketType === 'TRI_OUTCOME'

    // If specific outcome requested, return just that book
    if (outcome) {
      const validOutcomes = isTri ? ['HOME', 'DRAW', 'AWAY'] : ['YES', 'NO']
      if (!validOutcomes.includes(outcome)) {
        return NextResponse.json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}` }, { status: 400 })
      }

      const book = loadBookFromMarket(market, outcome, isTri)
      const snapshot = book.getSnapshot(depth)

      return NextResponse.json({
        marketId,
        outcome,
        ...snapshot,
      })
    }

    // No outcome specified — return all books
    const outcomes = isTri ? ['HOME', 'DRAW', 'AWAY'] : ['YES', 'NO']
    const books: Record<string, any> = {}

    for (const oc of outcomes) {
      const book = loadBookFromMarket(market, oc, isTri)
      books[oc] = book.getSnapshot(depth)
    }

    return NextResponse.json({
      marketId,
      pricingEngine: 'CLOB',
      books,
    })

  } catch (error: any) {
    console.error('[orderbook] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch order book' }, { status: 500 })
  }
}

function loadBookFromMarket(market: any, outcome: string, isTri: boolean): OrderBook {
  let field: string
  if (isTri) {
    field = outcome === 'HOME' ? 'bookYes' : outcome === 'DRAW' ? 'bookDraw' : 'bookNo'
  } else {
    field = outcome === 'YES' ? 'bookYes' : 'bookNo'
  }

  const json = market[field]
  if (json && typeof json === 'string') {
    try { return OrderBook.deserialize(json) } catch { /* fallthrough */ }
  }
  return new OrderBook()
}
