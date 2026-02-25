import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { OrderBook } from '@/lib/clob'
import { FEES } from '@/lib/fees'

/**
 * POST /api/orders/cancel
 * Cancel a resting CLOB order. Refunds reserved balance (for buys) or shares (for sells).
 * Body: { orderId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { orderId } = await request.json()
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    // Find the order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { market: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not your order' }, { status: 403 })
    }

    if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') {
      return NextResponse.json({ error: 'Order is not cancellable (already filled or cancelled)' }, { status: 400 })
    }

    if (order.remaining <= 0) {
      return NextResponse.json({ error: 'No remaining shares to cancel' }, { status: 400 })
    }

    const market = order.market
    const isTri = (market as any).marketType === 'TRI_OUTCOME'
    const outcome = order.outcome

    // Load the book and remove the order
    const bookField = isTri
      ? (outcome === 'HOME' ? 'bookYes' : outcome === 'DRAW' ? 'bookDraw' : 'bookNo')
      : (outcome === 'YES' ? 'bookYes' : 'bookNo')

    const bookJson = (market as any)[bookField]
    let book: OrderBook
    if (bookJson && typeof bookJson === 'string') {
      try { book = OrderBook.deserialize(bookJson) } catch { book = new OrderBook() }
    } else {
      book = new OrderBook()
    }

    // Try to find and remove from book by scanning for matching CLOB order
    // The CLOB order ID format is `clob_<timestamp>_<random>` stored in the book
    // We need to find it by userId and approximate matching
    const userOrders = book.getUserOrders(session.user.id)
    let removedOrder = null
    for (const uo of userOrders) {
      // Match by price and side
      if (uo.side === order.side && Math.abs(uo.price - order.price) < 0.001) {
        removedOrder = book.cancelOrder(uo.id)
        if (removedOrder) break
      }
    }

    // Execute refund in transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', remaining: 0 },
      })

      if (order.side === 'BUY') {
        // Refund reserved Kwacha: remaining shares * price + fee on that amount
        const refundBase = order.remaining * order.price
        const refundTotal = refundBase * (1 + FEES.TRADE_FEE_RATE)

        await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { increment: refundTotal } },
        })

        await tx.transaction.create({
          data: {
            type: 'TRADE',
            amount: refundTotal,
            feeAmount: 0,
            description: `Cancelled BUY order: refund ${order.remaining.toFixed(2)} ${outcome} shares @ ${(order.price * 100).toFixed(0)}n`,
            status: 'COMPLETED',
            userId: session.user.id,
          },
        })

        return { refundType: 'balance', refundAmount: refundTotal }
      } else {
        // Refund reserved shares back to position
        const position = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: session.user.id, marketId: market.id, outcome } },
        })
        if (position) {
          await tx.position.update({
            where: { id: position.id },
            data: { size: position.size + order.remaining, isClosed: false },
          })
        } else {
          await tx.position.create({
            data: { userId: session.user.id, marketId: market.id, outcome, size: order.remaining, averagePrice: order.price },
          })
        }

        await tx.transaction.create({
          data: {
            type: 'TRADE',
            amount: 0,
            feeAmount: 0,
            description: `Cancelled SELL order: returned ${order.remaining.toFixed(2)} ${outcome} shares`,
            status: 'COMPLETED',
            userId: session.user.id,
          },
        })

        return { refundType: 'shares', refundAmount: order.remaining }
      }
    })

    // Persist updated book
    await prisma.market.update({
      where: { id: market.id },
      data: { [bookField]: book.serialize() },
    })

    const freshUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { balance: true } })

    return NextResponse.json({
      success: true,
      cancelled: {
        orderId,
        sharesReturned: order.remaining,
        ...result,
      },
      newBalance: freshUser?.balance || 0,
    })

  } catch (error: any) {
    console.error('[orders/cancel] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to cancel order' }, { status: 500 })
  }
}
