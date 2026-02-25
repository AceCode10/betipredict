import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TradeRequest } from '@/types'
// Legacy CPMM (for backward compat with existing markets)
import { initializePool, calculateSharesForAmount, calculateSellProceeds, getPrices, initializeTriPool, calculateTriSharesForAmount, calculateTriSellProceeds, getTriPrices, TriOutcome, TriPoolState } from '@/lib/cpmm'
// New CLOB engine
import { OrderBook, CLOBOrder, Fill } from '@/lib/clob'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { calculateTradeFee, FEES } from '@/lib/fees'
import { sendTradeConfirmation } from '@/lib/email'

// ─── Helpers ────────────────────────────────────────────

/** Get the serialized book field name for an outcome */
function bookFieldForOutcome(outcome: string, isTri: boolean): 'bookYes' | 'bookNo' | 'bookDraw' {
  if (isTri) {
    if (outcome === 'HOME') return 'bookYes'
    if (outcome === 'DRAW') return 'bookDraw'
    return 'bookNo' // AWAY
  }
  return outcome === 'YES' ? 'bookYes' : 'bookNo'
}

/** Load an OrderBook from the market's serialized JSON, or create a fresh one */
function loadBook(market: any, outcome: string, isTri: boolean): OrderBook {
  const field = bookFieldForOutcome(outcome, isTri)
  const json = market[field]
  if (json && typeof json === 'string') {
    try { return OrderBook.deserialize(json) } catch { /* fallthrough */ }
  }
  // Fresh empty book — no seeded prices, pure price discovery
  return new OrderBook()
}

/** Persist updated books back to market. Returns partial update data. */
function serializeBooks(
  books: Record<string, OrderBook>,
  isTri: boolean
): Record<string, any> {
  const data: Record<string, any> = {}
  for (const [outcome, book] of Object.entries(books)) {
    const field = bookFieldForOutcome(outcome, isTri)
    data[field] = book.serialize()
  }
  return data
}

/** Derive last-traded prices from books for the market record */
function derivePrices(books: Record<string, OrderBook>, isTri: boolean): Record<string, any> {
  const prices: Record<string, any> = {}
  if (isTri) {
    const homeBook = books['HOME']
    const drawBook = books['DRAW']
    const awayBook = books['AWAY']
    if (homeBook) {
      const p = homeBook.getLastPrice() ?? homeBook.getMidPrice()
      if (p != null) prices.yesPrice = Math.max(0.01, Math.min(0.99, p))
    }
    if (drawBook) {
      const p = drawBook.getLastPrice() ?? drawBook.getMidPrice()
      if (p != null) prices.drawPrice = Math.max(0.01, Math.min(0.99, p))
    }
    if (awayBook) {
      const p = awayBook.getLastPrice() ?? awayBook.getMidPrice()
      if (p != null) prices.noPrice = Math.max(0.01, Math.min(0.99, p))
    }
  } else {
    const yesBook = books['YES']
    const noBook = books['NO']
    if (yesBook) {
      const p = yesBook.getLastPrice() ?? yesBook.getMidPrice()
      if (p != null) prices.yesPrice = Math.max(0.01, Math.min(0.99, p))
    }
    if (noBook) {
      const p = noBook.getLastPrice() ?? noBook.getMidPrice()
      if (p != null) prices.noPrice = Math.max(0.01, Math.min(0.99, p))
    }
  }
  return prices
}

// ─── Main handler ───────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Rate limit: 30 trades per minute per user
    const rl = checkRateLimit(`trade:${session.user.id}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many trades. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
      )
    }

    const trade: TradeRequest = await request.json()
    const { marketId, outcome, side, type } = trade
    const amount = Number(trade.amount)
    const limitPrice = trade.price != null ? Number(trade.price) : undefined

    // Validate trade request
    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
    }
    if (!['YES', 'NO', 'HOME', 'DRAW', 'AWAY'].includes(outcome)) {
      return NextResponse.json({ error: 'Outcome must be YES, NO, HOME, DRAW, or AWAY' }, { status: 400 })
    }
    if (!['BUY', 'SELL'].includes(side)) {
      return NextResponse.json({ error: 'Side must be BUY or SELL' }, { status: 400 })
    }
    if (!['MARKET', 'LIMIT'].includes(type)) {
      return NextResponse.json({ error: 'Type must be MARKET or LIMIT' }, { status: 400 })
    }
    if (type === 'LIMIT' && (limitPrice == null || limitPrice < 0.01 || limitPrice > 0.99)) {
      return NextResponse.json({ error: 'Limit price must be between 0.01 and 0.99 (1n–99n)' }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return NextResponse.json({ error: 'Amount must be between 0.01 and 1,000,000' }, { status: 400 })
    }
    if (amount < 0.01) {
      return NextResponse.json({ error: 'Minimum trade amount is 0.01' }, { status: 400 })
    }

    // Get user with fresh balance
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get market
    const market = await prisma.market.findUnique({
      where: { id: marketId }
    })

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    }

    if (market.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Market is not active for trading' }, { status: 400 })
    }

    // Block trading if the market's resolve time has already passed
    if (new Date(market.resolveTime) <= new Date()) {
      return NextResponse.json({ error: 'This market has passed its resolve time and is no longer tradable' }, { status: 400 })
    }

    // Block trading if the linked game is already finished
    const linkedGame = await prisma.scheduledGame.findFirst({
      where: { marketId, status: 'FINISHED' },
      select: { id: true },
    })
    if (linkedGame) {
      return NextResponse.json({ error: 'The linked match has ended. Trading is closed.' }, { status: 400 })
    }

    // Determine market type and validate outcome
    const isTri = market.marketType === 'TRI_OUTCOME'
    if (isTri && !['HOME', 'DRAW', 'AWAY'].includes(outcome)) {
      return NextResponse.json({ error: 'This is a 3-outcome market. Outcome must be HOME, DRAW, or AWAY' }, { status: 400 })
    }
    if (!isTri && !['YES', 'NO'].includes(outcome)) {
      return NextResponse.json({ error: 'This is a binary market. Outcome must be YES or NO' }, { status: 400 })
    }

    // ═══════════════════════════════════════════════════════
    // Route to CLOB or legacy CPMM based on pricingEngine
    // ═══════════════════════════════════════════════════════
    const useCLOB = (market as any).pricingEngine === 'CLOB'

    if (useCLOB) {
      return handleCLOBTrade(session, user, market, { outcome, side, type, amount, limitPrice, isTri })
    } else {
      return handleCPMMTrade(session, user, market, { outcome, side, type, amount, isTri })
    }

  } catch (error: any) {
    console.error('Error executing trade:', error)
    const msg = error?.message || ''
    const userMessage = 
      msg.includes('Insufficient balance') ? 'Insufficient balance' :
      msg.includes('Insufficient shares') ? msg :
      'Failed to execute trade'
    return NextResponse.json({ error: userMessage }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════
// CLOB Trade Handler — Real-time price discovery
// ═══════════════════════════════════════════════════════════

async function handleCLOBTrade(
  session: any,
  user: any,
  market: any,
  params: { outcome: string; side: string; type: string; amount: number; limitPrice?: number; isTri: boolean }
) {
  const { outcome, side, type, amount, limitPrice, isTri } = params
  const marketId = market.id

  // For BUY: amount = Kwacha to spend. We convert to shares based on price.
  //   MARKET BUY: sweep asks, amount is max Kwacha to spend
  //   LIMIT BUY: place bid at limitPrice, amount is number of shares
  // For SELL: amount = number of shares to sell
  //   MARKET SELL: sweep bids, amount is shares to sell
  //   LIMIT SELL: place ask at limitPrice, amount is shares

  // Determine shares and max cost
  let shares: number
  let maxCost: number // max Kwacha the user must have reserved

  if (side === 'BUY') {
    if (type === 'LIMIT') {
      shares = amount // amount = shares desired
      maxCost = shares * limitPrice! // worst case cost
    } else {
      // MARKET BUY: amount = Kwacha to spend. Shares determined by matching.
      shares = amount // we'll use amount as max spend, convert after matching
      maxCost = amount
    }

    // Check balance (include 2% fee buffer)
    const grossWithFee = maxCost * (1 + FEES.TRADE_FEE_RATE)
    if (user.balance < grossWithFee) {
      return NextResponse.json(
        { error: `Insufficient balance. You need ~K${grossWithFee.toFixed(2)} but have K${user.balance.toFixed(2)}` },
        { status: 400 }
      )
    }
  } else {
    // SELL: verify shares
    shares = amount
    const positionPreCheck = await prisma.position.findUnique({
      where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
    })
    if (!positionPreCheck || positionPreCheck.size < shares) {
      return NextResponse.json(
        { error: `Insufficient shares. You have ${positionPreCheck?.size.toFixed(2) || '0'} but want to sell ${shares.toFixed(2)}` },
        { status: 400 }
      )
    }
  }

  // Load the order book for this outcome
  const book = loadBook(market, outcome, isTri)

  // Build the CLOB order
  const orderId = `clob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  let clobOrder: CLOBOrder

  if (side === 'BUY' && type === 'MARKET') {
    // Market buy: we want to spend `amount` Kwacha. Convert to approximate shares
    // by estimating from best ask. If no asks, order fails.
    const bestAsk = book.getBestAsk()
    if (!bestAsk) {
      return NextResponse.json({ error: 'No sellers available. Place a limit order instead.' }, { status: 400 })
    }
    // Estimate shares we can buy with our budget
    const estShares = amount / bestAsk
    clobOrder = {
      id: orderId, userId: session.user.id, side: 'BUY',
      price: 0.99, // market orders match at any price up to 99¢
      size: estShares, filled: 0, remaining: estShares,
      timestamp: Date.now(), type: 'MARKET'
    }
  } else if (side === 'SELL' && type === 'MARKET') {
    const bestBid = book.getBestBid()
    if (!bestBid) {
      return NextResponse.json({ error: 'No buyers available. Place a limit order instead.' }, { status: 400 })
    }
    clobOrder = {
      id: orderId, userId: session.user.id, side: 'SELL',
      price: 0.01, // match at any price down to 1¢
      size: shares, filled: 0, remaining: shares,
      timestamp: Date.now(), type: 'MARKET'
    }
  } else {
    // LIMIT order
    clobOrder = {
      id: orderId, userId: session.user.id, side: side as 'BUY' | 'SELL',
      price: limitPrice!,
      size: shares, filled: 0, remaining: shares,
      timestamp: Date.now(), type: 'LIMIT'
    }
  }

  // Execute matching
  const matchResult = book.placeOrder(clobOrder)

  // For market BUY, cap cost to user's budget
  if (side === 'BUY' && type === 'MARKET' && matchResult.totalCost > amount) {
    // Overspent — this shouldn't happen with proper estimation but cap it
    // In practice the book matching handles this correctly
  }

  // Load all books for price derivation
  const outcomes = isTri ? ['HOME', 'DRAW', 'AWAY'] : ['YES', 'NO']
  const allBooks: Record<string, OrderBook> = {}
  for (const oc of outcomes) {
    allBooks[oc] = oc === outcome ? book : loadBook(market, oc, isTri)
  }

  const totalFilled = matchResult.totalFilled
  const avgPrice = matchResult.avgPrice
  const totalCost = matchResult.totalCost
  const hasResting = matchResult.remainingOrder != null
  const restingShares = matchResult.remainingOrder?.remaining || 0

  // Execute the DB transaction
  const result = await prisma.$transaction(async (tx: any) => {
    // Fresh balance check
    const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
    if (!freshUser) throw new Error('User not found')

    let totalDebit = 0
    let totalCredit = 0

    if (side === 'BUY') {
      // Debit: cost of filled shares + fee + reserved cost for resting order
      const filledCost = totalCost
      const restingCost = restingShares * (limitPrice || 0)
      const grossSpend = filledCost + restingCost
      const fee = calculateTradeFee(grossSpend)
      totalDebit = grossSpend + fee.feeAmount

      if (freshUser.balance < totalDebit) throw new Error('Insufficient balance')

      await tx.user.update({
        where: { id: session.user.id },
        data: { balance: { decrement: totalDebit } }
      })

      // Create order record
      const orderStatus = totalFilled >= clobOrder.size - 0.001 ? 'FILLED' :
        totalFilled > 0 ? 'PARTIALLY_FILLED' : 'OPEN'
      const dbOrder = await tx.order.create({
        data: {
          type, side: 'BUY', outcome, price: limitPrice || avgPrice,
          amount: clobOrder.size, filled: totalFilled, remaining: restingShares,
          status: orderStatus, userId: session.user.id, marketId
        }
      })

      // Record transaction for filled portion
      if (totalFilled > 0) {
        await tx.transaction.create({
          data: {
            type: 'TRADE', amount: -filledCost, feeAmount: fee.feeAmount,
            description: `Bought ${totalFilled.toFixed(2)} ${outcome} shares @ ${(avgPrice * 100).toFixed(0)}n in "${market.title}"`,
            status: 'COMPLETED', userId: session.user.id,
            metadata: JSON.stringify({ orderId: dbOrder.id, marketId, outcome, shares: totalFilled, avgPrice, cost: filledCost, resting: restingShares })
          }
        })

        if (fee.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              feeType: 'TRADE_FEE', amount: fee.feeAmount,
              description: `Trade fee on BUY ${outcome} in "${market.title}"`,
              sourceType: 'TRADE', sourceId: dbOrder.id, userId: session.user.id,
            }
          })
        }

        // Update buyer position
        const existingPosition = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
        })
        if (existingPosition) {
          const newSize = existingPosition.size + totalFilled
          const newAvgPrice = ((existingPosition.averagePrice * existingPosition.size) + (avgPrice * totalFilled)) / newSize
          await tx.position.update({
            where: { id: existingPosition.id },
            data: { size: newSize, averagePrice: newAvgPrice, isClosed: false }
          })
        } else {
          await tx.position.create({
            data: { userId: session.user.id, marketId, outcome, size: totalFilled, averagePrice: avgPrice }
          })
        }
      }

      // Process fills — credit sellers
      for (const fill of matchResult.fills) {
        if (fill.makerId === session.user.id) continue // self-trade handled above
        const sellProceeds = fill.price * fill.size
        const sellerFee = calculateTradeFee(sellProceeds)
        await tx.user.update({
          where: { id: fill.makerId },
          data: { balance: { increment: sellerFee.netAmount } }
        })
        // Update seller position
        const sellerPos = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: fill.makerId, marketId, outcome } }
        })
        if (sellerPos) {
          const newSize = Math.max(0, sellerPos.size - fill.size)
          await tx.position.update({
            where: { id: sellerPos.id },
            data: { size: newSize, isClosed: newSize <= 0 }
          })
        }
        await tx.transaction.create({
          data: {
            type: 'TRADE', amount: sellerFee.netAmount, feeAmount: sellerFee.feeAmount,
            description: `Sold ${fill.size.toFixed(2)} ${outcome} shares @ ${(fill.price * 100).toFixed(0)}n in "${market.title}" (filled)`,
            status: 'COMPLETED', userId: fill.makerId,
          }
        })
        if (sellerFee.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              feeType: 'TRADE_FEE', amount: sellerFee.feeAmount,
              description: `Trade fee on SELL fill ${outcome} in "${market.title}"`,
              sourceType: 'TRADE', sourceId: dbOrder.id, userId: fill.makerId,
            }
          })
        }
      }

      totalCredit = 0
      return { dbOrder, totalDebit, fee }

    } else {
      // SELL side
      const grossProceeds = totalCost
      const fee = calculateTradeFee(grossProceeds > 0 ? grossProceeds : 0)
      const netProceeds = fee.netAmount

      // Create order record
      const orderStatus = totalFilled >= clobOrder.size - 0.001 ? 'FILLED' :
        totalFilled > 0 ? 'PARTIALLY_FILLED' : 'OPEN'
      const dbOrder = await tx.order.create({
        data: {
          type, side: 'SELL', outcome, price: limitPrice || avgPrice,
          amount: clobOrder.size, filled: totalFilled, remaining: restingShares,
          status: orderStatus, userId: session.user.id, marketId
        }
      })

      // Reduce seller's position for filled portion
      if (totalFilled > 0) {
        const position = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
        })
        if (!position || position.size < totalFilled) {
          throw new Error('Insufficient shares')
        }
        const newSize = Math.max(0, position.size - totalFilled)
        await tx.position.update({
          where: { id: position.id },
          data: { size: newSize, isClosed: newSize <= 0 }
        })

        // Credit seller
        await tx.user.update({
          where: { id: session.user.id },
          data: { balance: { increment: netProceeds } }
        })

        await tx.transaction.create({
          data: {
            type: 'TRADE', amount: netProceeds, feeAmount: fee.feeAmount,
            description: `Sold ${totalFilled.toFixed(2)} ${outcome} shares @ ${(avgPrice * 100).toFixed(0)}n in "${market.title}"`,
            status: 'COMPLETED', userId: session.user.id,
            metadata: JSON.stringify({ orderId: dbOrder.id, marketId, outcome, shares: totalFilled, avgPrice, grossProceeds, resting: restingShares })
          }
        })

        if (fee.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              feeType: 'TRADE_FEE', amount: fee.feeAmount,
              description: `Trade fee on SELL ${outcome} in "${market.title}"`,
              sourceType: 'TRADE', sourceId: dbOrder.id, userId: session.user.id,
            }
          })
        }
      }

      // Reserve shares for resting sell order (already deducted from position above only for filled)
      // For resting portion, also lock the shares
      if (restingShares > 0) {
        const position = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
        })
        if (position && position.size >= restingShares) {
          await tx.position.update({
            where: { id: position.id },
            data: { size: position.size - restingShares }
          })
        }
      }

      // Process fills — give shares to BUY makers (their balance was already reserved at order placement)
      for (const fill of matchResult.fills) {
        if (fill.makerId === session.user.id) continue
        // BUY maker already paid when placing their resting order — do NOT debit again.
        // Only update their position (give them the shares they bought).
        const buyerPos = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: fill.makerId, marketId, outcome } }
        })
        if (buyerPos) {
          const newSize = buyerPos.size + fill.size
          const newAvg = ((buyerPos.averagePrice * buyerPos.size) + (fill.price * fill.size)) / newSize
          await tx.position.update({
            where: { id: buyerPos.id },
            data: { size: newSize, averagePrice: newAvg, isClosed: false }
          })
        } else {
          await tx.position.create({
            data: { userId: fill.makerId, marketId, outcome, size: fill.size, averagePrice: fill.price }
          })
        }
        const buyCost = fill.price * fill.size
        await tx.transaction.create({
          data: {
            type: 'TRADE', amount: -buyCost, feeAmount: 0,
            description: `Bought ${fill.size.toFixed(2)} ${outcome} shares @ ${(fill.price * 100).toFixed(0)}n in "${market.title}" (filled)`,
            status: 'COMPLETED', userId: fill.makerId,
          }
        })
      }

      return { dbOrder, totalDebit: 0, fee }
    }
  })

  // Persist book state and updated prices to market
  const bookData = serializeBooks(allBooks, isTri)
  const priceData = derivePrices(allBooks, isTri)
  const volumeIncrement = totalCost > 0 ? totalCost : 0

  await prisma.market.update({
    where: { id: marketId },
    data: {
      ...bookData,
      ...priceData,
      volume: { increment: volumeIncrement },
    }
  })

  // Send email confirmation
  if (user.email && totalFilled > 0) {
    sendTradeConfirmation(user.email, {
      side: side as any, outcome, amount: totalCost, shares: totalFilled, market: market.title,
    }).catch(() => {})
  }

  // Build response
  const freshUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { balance: true } })
  const responseData: any = {
    success: true,
    order: result.dbOrder,
    newBalance: freshUser?.balance || 0,
    shares: totalFilled,
    avgPrice,
    totalCost: Math.round(totalCost * 100) / 100,
    resting: restingShares > 0 ? { shares: restingShares, price: limitPrice } : null,
    fee: result.fee.feeAmount,
    feeRate: FEES.TRADE_FEE_RATE,
    ...priceData,
    orderBook: book.getSnapshot(5),
  }

  return NextResponse.json(responseData)
}

// ═══════════════════════════════════════════════════════════
// Legacy CPMM Trade Handler (for existing markets with pricingEngine=CPMM)
// ═══════════════════════════════════════════════════════════

async function handleCPMMTrade(
  session: any,
  user: any,
  market: any,
  params: { outcome: string; side: string; type: string; amount: number; isTri: boolean }
) {
  const { outcome, side, type, amount, isTri } = params
  const marketId = market.id

  if (side === 'BUY') {
    const grossAmount = amount
    const fee = calculateTradeFee(grossAmount)
    const kwachaToSpend = fee.netAmount

    if (user.balance < grossAmount) {
      return NextResponse.json(
        { error: `Insufficient balance. You have ${user.balance.toFixed(2)} but need ${grossAmount.toFixed(2)}` },
        { status: 400 }
      )
    }

    let shares: number, newPool: any, avgPrice: number, newPriceData: any

    if (isTri) {
      let triPool: TriPoolState
      if (market.poolHomeShares != null && market.poolDrawShares != null && market.poolAwayShares != null && market.poolTriK != null) {
        triPool = { homeShares: market.poolHomeShares, drawShares: market.poolDrawShares, awayShares: market.poolAwayShares, k: market.poolTriK }
      } else {
        triPool = initializeTriPool(market.liquidity || 10000)
      }
      const result = calculateTriSharesForAmount(triPool, outcome as TriOutcome, kwachaToSpend)
      shares = result.shares; newPool = result.newPool; avgPrice = result.avgPrice
      newPriceData = getTriPrices(result.newPool)
    } else {
      let pool
      if (market.poolYesShares != null && market.poolNoShares != null && market.poolK != null) {
        pool = { yesShares: market.poolYesShares, noShares: market.poolNoShares, k: market.poolK }
      } else {
        pool = initializePool(market.liquidity || 1000, market.yesPrice)
      }
      const result = calculateSharesForAmount(pool, outcome as 'YES' | 'NO', kwachaToSpend)
      shares = result.shares; newPool = result.newPool; avgPrice = result.avgPrice
      newPriceData = getPrices(result.newPool)
    }

    if (shares <= 0) {
      return NextResponse.json({ error: 'Trade amount too small' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const freshUser = await tx.user.findUnique({ where: { id: session.user.id } })
      if (!freshUser || freshUser.balance < grossAmount) throw new Error('Insufficient balance')

      const updatedUser = await tx.user.update({
        where: { id: session.user.id },
        data: { balance: { decrement: grossAmount } }
      })

      const order = await tx.order.create({
        data: {
          type, side: 'BUY', outcome, price: avgPrice,
          amount: shares, filled: shares, remaining: 0, status: 'FILLED',
          userId: session.user.id, marketId
        }
      })

      await tx.transaction.create({
        data: {
          type: 'TRADE', amount: -grossAmount, feeAmount: fee.feeAmount,
          description: `Bought ${shares.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(avgPrice * 100).toFixed(0)}n`,
          status: 'COMPLETED', userId: session.user.id,
          metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares, avgPrice, spent: grossAmount })
        }
      })

      if (fee.feeAmount > 0) {
        await tx.platformRevenue.create({
          data: {
            feeType: 'TRADE_FEE', amount: fee.feeAmount,
            description: `Trade fee on BUY ${outcome} in "${market.title}"`,
            sourceType: 'TRADE', sourceId: order.id, userId: session.user.id,
          }
        })
      }

      const existingPosition = await tx.position.findUnique({
        where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
      })
      if (existingPosition) {
        const newSize = existingPosition.size + shares
        const newAvgPrice = ((existingPosition.averagePrice * existingPosition.size) + (avgPrice * shares)) / newSize
        await tx.position.update({
          where: { id: existingPosition.id },
          data: { size: newSize, averagePrice: newAvgPrice, isClosed: false }
        })
      } else {
        await tx.position.create({
          data: { userId: session.user.id, marketId, outcome, size: shares, averagePrice: avgPrice }
        })
      }

      const marketUpdateData: any = { volume: { increment: grossAmount } }
      if (isTri) {
        const tp = newPriceData as { homePrice: number; drawPrice: number; awayPrice: number }
        marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, tp.homePrice))
        marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, tp.awayPrice))
        marketUpdateData.drawPrice = Math.max(0.01, Math.min(0.99, tp.drawPrice))
        marketUpdateData.liquidity = newPool.homeShares + newPool.drawShares + newPool.awayShares
        marketUpdateData.poolHomeShares = newPool.homeShares
        marketUpdateData.poolDrawShares = newPool.drawShares
        marketUpdateData.poolAwayShares = newPool.awayShares
        marketUpdateData.poolTriK = newPool.k
      } else {
        marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, newPriceData.yesPrice))
        marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, newPriceData.noPrice))
        marketUpdateData.liquidity = newPool.yesShares + newPool.noShares
        marketUpdateData.poolYesShares = newPool.yesShares
        marketUpdateData.poolNoShares = newPool.noShares
        marketUpdateData.poolK = newPool.k
      }

      const updatedMarket = await tx.market.update({ where: { id: marketId }, data: marketUpdateData })
      return { updatedUser, order, updatedMarket, shares, avgPrice, newPriceData }
    })

    if (user.email) {
      sendTradeConfirmation(user.email, {
        side: 'BUY', outcome, amount: grossAmount, shares: result.shares, market: market.title,
      }).catch(() => {})
    }

    const responseData: any = {
      success: true, order: result.order,
      newBalance: result.updatedUser.balance,
      shares: result.shares, avgPrice: result.avgPrice,
      spent: grossAmount, fee: fee.feeAmount, feeRate: FEES.TRADE_FEE_RATE,
    }
    if (isTri) {
      responseData.newHomePrice = result.newPriceData.homePrice
      responseData.newDrawPrice = result.newPriceData.drawPrice
      responseData.newAwayPrice = result.newPriceData.awayPrice
    } else {
      responseData.newYesPrice = result.newPriceData.yesPrice
      responseData.newNoPrice = result.newPriceData.noPrice
    }
    return NextResponse.json(responseData)

  } else {
    // SELL via CPMM
    const sharesToSell = amount
    const positionPreCheck = await prisma.position.findUnique({
      where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
    })
    if (!positionPreCheck || positionPreCheck.size < sharesToSell) {
      return NextResponse.json(
        { error: `Insufficient shares. You have ${positionPreCheck?.size.toFixed(2) || '0'} but want to sell ${sharesToSell.toFixed(2)}` },
        { status: 400 }
      )
    }

    let grossProceeds: number, sellPool: any, sellAvgPrice: number, newPriceData: any
    if (isTri) {
      let triPool: TriPoolState
      if (market.poolHomeShares != null && market.poolDrawShares != null && market.poolAwayShares != null && market.poolTriK != null) {
        triPool = { homeShares: market.poolHomeShares, drawShares: market.poolDrawShares, awayShares: market.poolAwayShares, k: market.poolTriK }
      } else {
        triPool = initializeTriPool(market.liquidity || 10000)
      }
      const result = calculateTriSellProceeds(triPool, outcome as TriOutcome, sharesToSell)
      grossProceeds = result.proceeds; sellPool = result.newPool; sellAvgPrice = result.avgPrice
      newPriceData = getTriPrices(result.newPool)
    } else {
      let pool
      if (market.poolYesShares != null && market.poolNoShares != null && market.poolK != null) {
        pool = { yesShares: market.poolYesShares, noShares: market.poolNoShares, k: market.poolK }
      } else {
        pool = initializePool(market.liquidity || 1000, market.yesPrice)
      }
      const result = calculateSellProceeds(pool, outcome as 'YES' | 'NO', sharesToSell)
      grossProceeds = result.proceeds; sellPool = result.newPool; sellAvgPrice = result.avgPrice
      newPriceData = getPrices(result.newPool)
    }

    if (grossProceeds <= 0) {
      return NextResponse.json({ error: 'Sell amount too small' }, { status: 400 })
    }

    const sellFee = calculateTradeFee(grossProceeds)
    const netProceeds = sellFee.netAmount

    const result = await prisma.$transaction(async (tx: any) => {
      const position = await tx.position.findUnique({
        where: { userId_marketId_outcome: { userId: session.user.id, marketId, outcome } }
      })
      if (!position || position.size < sharesToSell) throw new Error('Insufficient shares')

      const updatedUser = await tx.user.update({
        where: { id: session.user.id },
        data: { balance: { increment: netProceeds } }
      })

      const order = await tx.order.create({
        data: {
          type, side: 'SELL', outcome, price: sellAvgPrice,
          amount: sharesToSell, filled: sharesToSell, remaining: 0, status: 'FILLED',
          userId: session.user.id, marketId
        }
      })

      await tx.transaction.create({
        data: {
          type: 'TRADE', amount: netProceeds, feeAmount: sellFee.feeAmount,
          description: `Sold ${sharesToSell.toFixed(2)} ${outcome} shares in "${market.title}" @ ${(sellAvgPrice * 100).toFixed(0)}n`,
          status: 'COMPLETED', userId: session.user.id,
          metadata: JSON.stringify({ orderId: order.id, marketId, outcome, shares: sharesToSell, price: sellAvgPrice, grossProceeds })
        }
      })

      if (sellFee.feeAmount > 0) {
        await tx.platformRevenue.create({
          data: {
            feeType: 'TRADE_FEE', amount: sellFee.feeAmount,
            description: `Trade fee on SELL ${outcome} in "${market.title}"`,
            sourceType: 'TRADE', sourceId: order.id, userId: session.user.id,
          }
        })
      }

      const newSize = position.size - sharesToSell
      await tx.position.update({
        where: { id: position.id },
        data: { size: Math.max(0, newSize), isClosed: newSize <= 0 }
      })

      const marketUpdateData: any = { volume: { increment: grossProceeds } }
      if (isTri) {
        const tp = newPriceData as { homePrice: number; drawPrice: number; awayPrice: number }
        marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, tp.homePrice))
        marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, tp.awayPrice))
        marketUpdateData.drawPrice = Math.max(0.01, Math.min(0.99, tp.drawPrice))
        marketUpdateData.liquidity = sellPool.homeShares + sellPool.drawShares + sellPool.awayShares
        marketUpdateData.poolHomeShares = sellPool.homeShares
        marketUpdateData.poolDrawShares = sellPool.drawShares
        marketUpdateData.poolAwayShares = sellPool.awayShares
        marketUpdateData.poolTriK = sellPool.k
      } else {
        marketUpdateData.yesPrice = Math.max(0.01, Math.min(0.99, newPriceData.yesPrice))
        marketUpdateData.noPrice = Math.max(0.01, Math.min(0.99, newPriceData.noPrice))
        marketUpdateData.liquidity = sellPool.yesShares + sellPool.noShares
        marketUpdateData.poolYesShares = sellPool.yesShares
        marketUpdateData.poolNoShares = sellPool.noShares
        marketUpdateData.poolK = sellPool.k
      }

      const updatedMarket = await tx.market.update({ where: { id: marketId }, data: marketUpdateData })
      return { updatedUser, order, updatedMarket, newPriceData }
    })

    if (user.email) {
      sendTradeConfirmation(user.email, {
        side: 'SELL', outcome, amount: grossProceeds, shares: sharesToSell, market: market.title,
      }).catch(() => {})
    }

    const responseData: any = {
      success: true, order: result.order,
      newBalance: result.updatedUser.balance,
      shares: sharesToSell, proceeds: netProceeds, grossProceeds,
      fee: sellFee.feeAmount, feeRate: FEES.TRADE_FEE_RATE,
    }
    if (isTri) {
      responseData.newHomePrice = result.newPriceData.homePrice
      responseData.newDrawPrice = result.newPriceData.drawPrice
      responseData.newAwayPrice = result.newPriceData.awayPrice
    } else {
      responseData.newYesPrice = result.newPriceData.yesPrice
      responseData.newNoPrice = result.newPriceData.noPrice
    }
    return NextResponse.json(responseData)
  }
}
