/**
 * Central Limit Order Book (CLOB) for BetiPredict
 * 
 * Real-time price discovery through supply and demand.
 * Shares trade between 1¢ and 99¢ (0.01–0.99 Kwacha).
 * Winning shares pay K1.00 at resolution.
 * 
 * For BINARY markets: YES and NO are complementary (YES price + NO price ≈ K1)
 *   - Buying YES at 40¢ is equivalent to selling NO at 60¢
 *   - The book only stores YES-side orders; NO orders are translated
 * 
 * For TRI_OUTCOME markets: HOME, DRAW, AWAY each have independent books
 *   - Each outcome trades 1¢–99¢ independently
 *   - Prices need NOT sum to 100¢ (arbitrage corrects this over time)
 * 
 * Matching: Price-time priority (best price first, then earliest timestamp)
 * Order types: LIMIT (rests on book) and MARKET (sweeps the book)
 */

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

export interface CLOBOrder {
  id: string
  userId: string
  side: 'BUY' | 'SELL'
  price: number       // 0.01–0.99 in Kwacha (1¢–99¢)
  size: number         // number of shares
  filled: number       // shares filled so far
  remaining: number    // size - filled
  timestamp: number    // Date.now() for time priority
  type: 'LIMIT' | 'MARKET'
}

export interface Fill {
  makerOrderId: string
  takerOrderId: string
  makerId: string
  takerId: string
  price: number
  size: number
  takerSide: 'BUY' | 'SELL'
}

export interface MatchResult {
  fills: Fill[]
  totalFilled: number
  totalCost: number      // total Kwacha spent/received
  avgPrice: number       // weighted average fill price
  remainingOrder: CLOBOrder | null  // unfilled portion (LIMIT only)
}

export interface BookLevel {
  price: number
  size: number       // total shares at this level
  orders: number     // count of orders at this level
}

export interface BookSnapshot {
  bids: BookLevel[]   // buy orders, sorted best (highest) first
  asks: BookLevel[]   // sell orders, sorted best (lowest) first
  bestBid: number | null
  bestAsk: number | null
  spread: number | null
  midPrice: number | null
  lastPrice: number | null
}

// ═══════════════════════════════════════════════════════
// OrderBook — one book per outcome
// ═══════════════════════════════════════════════════════

export class OrderBook {
  // Bids sorted by price DESC, then timestamp ASC (best bid first)
  private bids: CLOBOrder[] = []
  // Asks sorted by price ASC, then timestamp ASC (best ask first)
  private asks: CLOBOrder[] = []
  private lastTradePrice: number | null = null

  constructor(initialLastPrice?: number) {
    if (initialLastPrice != null) {
      this.lastTradePrice = initialLastPrice
    }
  }

  /**
   * Place an order on the book. Returns fills and any resting remainder.
   */
  placeOrder(order: CLOBOrder): MatchResult {
    // Validate price
    if (order.type === 'LIMIT') {
      if (order.price < 0.01 || order.price > 0.99) {
        return { fills: [], totalFilled: 0, totalCost: 0, avgPrice: 0, remainingOrder: null }
      }
      // Round to nearest ngwee
      order.price = Math.round(order.price * 100) / 100
    }

    const fills: Fill[] = []
    let remaining = order.remaining

    if (order.side === 'BUY') {
      // Match against asks (sellers) — lowest ask first
      while (remaining > 0 && this.asks.length > 0) {
        const bestAsk = this.asks[0]
        // For LIMIT: only fill if ask price <= our bid price
        // For MARKET: fill at any price
        if (order.type === 'LIMIT' && bestAsk.price > order.price) break

        const fillSize = Math.min(remaining, bestAsk.remaining)
        const fillPrice = bestAsk.price // maker's price

        fills.push({
          makerOrderId: bestAsk.id,
          takerOrderId: order.id,
          makerId: bestAsk.userId,
          takerId: order.userId,
          price: fillPrice,
          size: fillSize,
          takerSide: 'BUY',
        })

        remaining -= fillSize
        bestAsk.remaining -= fillSize
        bestAsk.filled += fillSize

        if (bestAsk.remaining <= 0.0001) {
          this.asks.shift() // fully filled, remove
        }

        this.lastTradePrice = fillPrice
      }
    } else {
      // SELL: match against bids (buyers) — highest bid first
      while (remaining > 0 && this.bids.length > 0) {
        const bestBid = this.bids[0]
        if (order.type === 'LIMIT' && bestBid.price < order.price) break

        const fillSize = Math.min(remaining, bestBid.remaining)
        const fillPrice = bestBid.price // maker's price

        fills.push({
          makerOrderId: bestBid.id,
          takerOrderId: order.id,
          makerId: bestBid.userId,
          takerId: order.userId,
          price: fillPrice,
          size: fillSize,
          takerSide: 'SELL',
        })

        remaining -= fillSize
        bestBid.remaining -= fillSize
        bestBid.filled += fillSize

        if (bestBid.remaining <= 0.0001) {
          this.bids.shift()
        }

        this.lastTradePrice = fillPrice
      }
    }

    // Update order state
    const totalFilled = order.size - remaining
    order.filled = totalFilled
    order.remaining = remaining

    // Rest unfilled portion on book (LIMIT orders only)
    let remainingOrder: CLOBOrder | null = null
    if (order.type === 'LIMIT' && remaining > 0.0001) {
      remainingOrder = { ...order, remaining }
      if (order.side === 'BUY') {
        this.insertBid(remainingOrder)
      } else {
        this.insertAsk(remainingOrder)
      }
    }

    const totalCost = fills.reduce((sum, f) => sum + f.price * f.size, 0)
    const avgPrice = totalFilled > 0 ? totalCost / totalFilled : 0

    return { fills, totalFilled, totalCost, avgPrice, remainingOrder }
  }

  /**
   * Cancel a resting order by ID. Returns true if found and removed.
   */
  cancelOrder(orderId: string): CLOBOrder | null {
    let idx = this.bids.findIndex(o => o.id === orderId)
    if (idx >= 0) {
      const [removed] = this.bids.splice(idx, 1)
      return removed
    }
    idx = this.asks.findIndex(o => o.id === orderId)
    if (idx >= 0) {
      const [removed] = this.asks.splice(idx, 1)
      return removed
    }
    return null
  }

  /**
   * Get order book snapshot for display.
   */
  getSnapshot(depth: number = 10): BookSnapshot {
    const aggregateLevels = (orders: CLOBOrder[], maxLevels: number): BookLevel[] => {
      const levels: Map<number, { size: number; orders: number }> = new Map()
      for (const o of orders) {
        const p = Math.round(o.price * 100) / 100
        const existing = levels.get(p) || { size: 0, orders: 0 }
        existing.size += o.remaining
        existing.orders++
        levels.set(p, existing)
      }
      return Array.from(levels.entries())
        .map(([price, { size, orders }]) => ({ price, size, orders }))
        .slice(0, maxLevels)
    }

    const bids = aggregateLevels(this.bids, depth)
    const asks = aggregateLevels(this.asks, depth)

    const bestBid = bids.length > 0 ? bids[0].price : null
    const bestAsk = asks.length > 0 ? asks[0].price : null
    const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null
    const midPrice = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null

    return { bids, asks, bestBid, bestAsk, spread, midPrice, lastPrice: this.lastTradePrice }
  }

  getLastPrice(): number | null {
    return this.lastTradePrice
  }

  getBestBid(): number | null {
    return this.bids.length > 0 ? this.bids[0].price : null
  }

  getBestAsk(): number | null {
    return this.asks.length > 0 ? this.asks[0].price : null
  }

  getMidPrice(): number | null {
    const bid = this.getBestBid()
    const ask = this.getBestAsk()
    if (bid != null && ask != null) return (bid + ask) / 2
    if (bid != null) return bid
    if (ask != null) return ask
    return this.lastTradePrice
  }

  /**
   * Get resting orders for a specific user
   */
  getUserOrders(userId: string): CLOBOrder[] {
    return [
      ...this.bids.filter(o => o.userId === userId),
      ...this.asks.filter(o => o.userId === userId),
    ]
  }

  // ─── Internals ─────────────────────────────────

  private insertBid(order: CLOBOrder) {
    // Insert maintaining: price DESC, then timestamp ASC
    let i = 0
    while (i < this.bids.length) {
      if (order.price > this.bids[i].price) break
      if (order.price === this.bids[i].price && order.timestamp < this.bids[i].timestamp) break
      i++
    }
    this.bids.splice(i, 0, order)
  }

  private insertAsk(order: CLOBOrder) {
    // Insert maintaining: price ASC, then timestamp ASC
    let i = 0
    while (i < this.asks.length) {
      if (order.price < this.asks[i].price) break
      if (order.price === this.asks[i].price && order.timestamp < this.asks[i].timestamp) break
      i++
    }
    this.asks.splice(i, 0, order)
  }

  /**
   * Serialize the book state to JSON for DB persistence
   */
  serialize(): string {
    return JSON.stringify({
      bids: this.bids,
      asks: this.asks,
      lastTradePrice: this.lastTradePrice,
    })
  }

  /**
   * Restore book state from serialized JSON
   */
  static deserialize(json: string): OrderBook {
    const data = JSON.parse(json)
    const book = new OrderBook(data.lastTradePrice)
    book.bids = data.bids || []
    book.asks = data.asks || []
    return book
  }
}

// ═══════════════════════════════════════════════════════
// Market-level helpers
// ═══════════════════════════════════════════════════════

/**
 * Get the display price for a market outcome.
 * Priority: lastTradePrice > midPrice > null
 */
export function getDisplayPrice(book: OrderBook): number | null {
  const last = book.getLastPrice()
  if (last != null) return last
  return book.getMidPrice()
}

/**
 * Estimate cost to buy N shares at market price (sweep the asks).
 * Returns total cost and average price without actually executing.
 */
export function estimateMarketBuyCost(book: OrderBook, shares: number): { cost: number; avgPrice: number; fillable: number } {
  const snapshot = book.getSnapshot(50)
  let remaining = shares
  let totalCost = 0
  let totalFilled = 0

  for (const level of snapshot.asks) {
    if (remaining <= 0) break
    const fillSize = Math.min(remaining, level.size)
    totalCost += fillSize * level.price
    totalFilled += fillSize
    remaining -= fillSize
  }

  return {
    cost: Math.round(totalCost * 100) / 100,
    avgPrice: totalFilled > 0 ? totalCost / totalFilled : 0,
    fillable: totalFilled,
  }
}

/**
 * Estimate proceeds from selling N shares at market price (sweep the bids).
 */
export function estimateMarketSellProceeds(book: OrderBook, shares: number): { proceeds: number; avgPrice: number; fillable: number } {
  const snapshot = book.getSnapshot(50)
  let remaining = shares
  let totalProceeds = 0
  let totalFilled = 0

  for (const level of snapshot.bids) {
    if (remaining <= 0) break
    const fillSize = Math.min(remaining, level.size)
    totalProceeds += fillSize * level.price
    totalFilled += fillSize
    remaining -= fillSize
  }

  return {
    proceeds: Math.round(totalProceeds * 100) / 100,
    avgPrice: totalFilled > 0 ? totalProceeds / totalFilled : 0,
    fillable: totalFilled,
  }
}
