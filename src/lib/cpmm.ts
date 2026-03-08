/**
 * Constant Product Market Maker (CPMM) for binary outcome markets
 * 
 * Uses the formula: yesShares * noShares = k (constant)
 * Price of YES = yesShares / (yesShares + noShares)
 * Price of NO  = noShares / (yesShares + noShares)
 * 
 * Buying YES increases yesShares → YES price goes UP (correct behavior)
 * All amounts are in Kwacha (K)
 */

export interface PoolState {
  yesShares: number
  noShares: number
  k: number // invariant constant
}

// ════════════════════════════════════════════════════════════════
// 3-Outcome CPMM (TriPool) for sports markets: Home / Draw / Away
// Uses: homeShares * drawShares * awayShares = k  (constant)
// Price(X) = shares(X) / (homeShares + drawShares + awayShares)
// Buying X increases X shares → X price goes UP. Prices sum to ~1.00
// ════════════════════════════════════════════════════════════════

export type TriOutcome = 'HOME' | 'DRAW' | 'AWAY'

export interface TriPoolState {
  homeShares: number
  drawShares: number
  awayShares: number
  k: number // invariant: home * draw * away
}

export function initializeTriPool(
  liquidity: number,
  initialHomePrice: number = 0.4,
  initialDrawPrice: number = 0.25,
  initialAwayPrice: number = 0.35,
): TriPoolState {
  // Normalize prices to sum to 1
  const total = initialHomePrice + initialDrawPrice + initialAwayPrice
  const pH = initialHomePrice / total
  const pD = initialDrawPrice / total
  const pA = initialAwayPrice / total

  // For 3-outcome CPMM: price(X) = shares(X) / totalShares
  // So shares(X) ∝ price(X), scaled by liquidity
  const homeShares = liquidity * pH
  const drawShares = liquidity * pD
  const awayShares = liquidity * pA
  const k = homeShares * drawShares * awayShares

  return { homeShares, drawShares, awayShares, k }
}

export function getTriPrices(pool: TriPoolState): { homePrice: number; drawPrice: number; awayPrice: number } {
  const { homeShares: h, drawShares: d, awayShares: a } = pool
  // Direct proportion pricing: price(X) = shares(X) / totalShares
  // Buying X increases X shares, so X price goes up — correct behavior
  const total = h + d + a
  if (total === 0) return { homePrice: 0.33, drawPrice: 0.34, awayPrice: 0.33 }
  return {
    homePrice: h / total,
    drawPrice: d / total,
    awayPrice: a / total,
  }
}

function getTriShares(pool: TriPoolState, outcome: TriOutcome): number {
  return outcome === 'HOME' ? pool.homeShares : outcome === 'DRAW' ? pool.drawShares : pool.awayShares
}

function setTriShares(pool: TriPoolState, outcome: TriOutcome, val: number): TriPoolState {
  const p = { ...pool }
  if (outcome === 'HOME') p.homeShares = val
  else if (outcome === 'DRAW') p.drawShares = val
  else p.awayShares = val
  return p
}

export function calculateTriBuyCost(
  pool: TriPoolState,
  outcome: TriOutcome,
  shares: number
): { cost: number; newPool: TriPoolState; avgPrice: number } {
  if (shares <= 0) return { cost: 0, newPool: pool, avgPrice: 0 }

  // Buying X shares: X pool increases, others rebalance to maintain k
  // New_X = X + shares. Distribute reduction across other two pools proportionally.
  const curX = getTriShares(pool, outcome)
  const newX = curX + shares

  // Others: we need other1 * other2 = k / newX
  const others: TriOutcome[] = (['HOME', 'DRAW', 'AWAY'] as TriOutcome[]).filter(o => o !== outcome)
  const o1 = getTriShares(pool, others[0])
  const o2 = getTriShares(pool, others[1])
  const targetProduct = pool.k / newX
  // Maintain ratio between the two others
  const ratio = o1 / o2
  const newO2 = Math.sqrt(targetProduct / ratio)
  const newO1 = targetProduct / newO2

  const cost = shares - ((o1 - newO1) + (o2 - newO2))

  let newPool = setTriShares(pool, outcome, newX)
  newPool = setTriShares(newPool, others[0], newO1)
  newPool = setTriShares(newPool, others[1], newO2)
  newPool.k = pool.k // preserve invariant

  const avgPrice = shares > 0 ? Math.max(0, cost) / shares : 0
  return {
    cost: Math.max(0, cost),
    newPool,
    avgPrice: Math.min(1, Math.max(0, avgPrice)),
  }
}

export function calculateTriSharesForAmount(
  pool: TriPoolState,
  outcome: TriOutcome,
  amount: number
): { shares: number; newPool: TriPoolState; avgPrice: number } {
  if (amount <= 0) return { shares: 0, newPool: pool, avgPrice: 0 }

  const prices = getTriPrices(pool)
  const currentPrice = outcome === 'HOME' ? prices.homePrice : outcome === 'DRAW' ? prices.drawPrice : prices.awayPrice

  let lo = 0
  let hi = currentPrice > 0 ? (amount / currentPrice) * 2 : amount * 10

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    const { cost } = calculateTriBuyCost(pool, outcome, mid)
    if (Math.abs(cost - amount) < 0.001) {
      const result = calculateTriBuyCost(pool, outcome, mid)
      return { shares: mid, newPool: result.newPool, avgPrice: mid > 0 ? amount / mid : 0 }
    }
    if (cost < amount) lo = mid; else hi = mid
  }

  const finalShares = (lo + hi) / 2
  const result = calculateTriBuyCost(pool, outcome, finalShares)
  return { shares: finalShares, newPool: result.newPool, avgPrice: finalShares > 0 ? amount / finalShares : 0 }
}

export function calculateTriSellProceeds(
  pool: TriPoolState,
  outcome: TriOutcome,
  shares: number
): { proceeds: number; newPool: TriPoolState; avgPrice: number } {
  if (shares <= 0) return { proceeds: 0, newPool: pool, avgPrice: 0 }

  const curX = getTriShares(pool, outcome)
  const maxSellable = curX * 0.95
  const effectiveShares = Math.min(shares, maxSellable)
  if (effectiveShares <= 0) return { proceeds: 0, newPool: pool, avgPrice: 0 }

  const newX = curX - effectiveShares
  const others: TriOutcome[] = (['HOME', 'DRAW', 'AWAY'] as TriOutcome[]).filter(o => o !== outcome)
  const o1 = getTriShares(pool, others[0])
  const o2 = getTriShares(pool, others[1])
  const targetProduct = pool.k / newX
  const ratio = o1 / o2
  const newO2 = Math.sqrt(targetProduct / ratio)
  const newO1 = targetProduct / newO2

  const proceeds = ((newO1 - o1) + (newO2 - o2)) + effectiveShares

  let newPool = setTriShares(pool, outcome, newX)
  newPool = setTriShares(newPool, others[0], newO1)
  newPool = setTriShares(newPool, others[1], newO2)
  newPool.k = pool.k

  const avgPrice = effectiveShares > 0 ? Math.max(0, proceeds) / effectiveShares : 0
  return {
    proceeds: Math.max(0, proceeds),
    newPool,
    avgPrice: Math.min(1, Math.max(0, avgPrice)),
  }
}

export function estimateTriPriceImpact(
  pool: TriPoolState,
  outcome: TriOutcome,
  amount: number
): { priceImpact: number; newPrices: { homePrice: number; drawPrice: number; awayPrice: number } } {
  const currentPrices = getTriPrices(pool)
  const { newPool } = calculateTriSharesForAmount(pool, outcome, amount)
  const newPrices = getTriPrices(newPool)
  const currentPrice = outcome === 'HOME' ? currentPrices.homePrice : outcome === 'DRAW' ? currentPrices.drawPrice : currentPrices.awayPrice
  const newPrice = outcome === 'HOME' ? newPrices.homePrice : outcome === 'DRAW' ? newPrices.drawPrice : newPrices.awayPrice
  const priceImpact = currentPrice > 0 ? ((newPrice - currentPrice) / currentPrice) * 100 : 0
  return { priceImpact, newPrices }
}

/**
 * Initialize a new liquidity pool
 * @param liquidity - Initial liquidity in Kwacha (split equally)
 * @param initialYesPrice - Initial YES price (0-1), default 0.5
 */
export function initializePool(liquidity: number, initialYesPrice: number = 0.5): PoolState {
  // Derive share amounts from desired price and total liquidity
  // Price(YES) = yesShares / (yesShares + noShares) = initialYesPrice
  // Total = yesShares + noShares ≈ liquidity
  const yesShares = liquidity * initialYesPrice
  const noShares = liquidity * (1 - initialYesPrice)
  const k = yesShares * noShares

  return { yesShares, noShares, k }
}

/**
 * Calculate current prices from pool state
 */
export function getPrices(pool: PoolState): { yesPrice: number; noPrice: number } {
  const total = pool.yesShares + pool.noShares
  if (total === 0) return { yesPrice: 0.5, noPrice: 0.5 }

  return {
    yesPrice: pool.yesShares / total,
    noPrice: pool.noShares / total
  }
}

/**
 * Calculate cost to buy a given number of outcome shares
 * Buying YES shares removes from noShares pool, buying NO removes from yesShares pool
 * 
 * @param pool - Current pool state
 * @param outcome - 'YES' or 'NO'
 * @param shares - Number of shares to buy
 * @returns cost in Kwacha and new pool state
 */
export function calculateBuyCost(
  pool: PoolState,
  outcome: 'YES' | 'NO',
  shares: number
): { cost: number; newPool: PoolState; avgPrice: number } {
  if (shares <= 0) return { cost: 0, newPool: pool, avgPrice: 0 }

  let newYes = pool.yesShares
  let newNo = pool.noShares

  if (outcome === 'YES') {
    // Buying YES: user puts Kwacha in, gets YES shares out
    // New noShares = k / (yesShares - shares_out)... 
    // Actually, CPMM for prediction markets:
    // Cost = newNo - pool.noShares where newNo = k / (pool.yesShares - shares)
    // But we need to ensure yesShares > shares
    
    // Alternative: LMSR-like approach using CPMM
    // When buying YES shares: 
    // The AMM mints both YES and NO shares, then sells the NO shares back
    // Cost = shares - (pool.noShares - k / (pool.yesShares + shares))
    
    newYes = pool.yesShares + shares
    newNo = pool.k / newYes
    const cost = shares - (pool.noShares - newNo)
    const avgPrice = shares > 0 ? cost / shares : 0

    return {
      cost: Math.max(0, cost),
      newPool: { yesShares: newYes, noShares: newNo, k: pool.k },
      avgPrice: Math.min(1, Math.max(0, avgPrice))
    }
  } else {
    // Buying NO shares
    newNo = pool.noShares + shares
    newYes = pool.k / newNo
    const cost = shares - (pool.yesShares - newYes)
    const avgPrice = shares > 0 ? cost / shares : 0

    return {
      cost: Math.max(0, cost),
      newPool: { yesShares: newYes, noShares: newNo, k: pool.k },
      avgPrice: Math.min(1, Math.max(0, avgPrice))
    }
  }
}

/**
 * Calculate how many shares you get for a given Kwacha amount
 * @param pool - Current pool state  
 * @param outcome - 'YES' or 'NO'
 * @param amount - Amount in Kwacha to spend
 * @returns shares received and new pool state
 */
export function calculateSharesForAmount(
  pool: PoolState,
  outcome: 'YES' | 'NO',
  amount: number
): { shares: number; newPool: PoolState; avgPrice: number } {
  if (amount <= 0) return { shares: 0, newPool: pool, avgPrice: 0 }

  // Binary search for the number of shares that costs `amount`
  let lo = 0
  let hi = amount * 10 // Upper bound guess
  const prices = getPrices(pool)
  const currentPrice = outcome === 'YES' ? prices.yesPrice : prices.noPrice
  
  // Better upper bound
  if (currentPrice > 0) {
    hi = amount / currentPrice * 2
  }

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    const { cost } = calculateBuyCost(pool, outcome, mid)
    
    if (Math.abs(cost - amount) < 0.001) {
      const result = calculateBuyCost(pool, outcome, mid)
      return { 
        shares: mid, 
        newPool: result.newPool,
        avgPrice: mid > 0 ? amount / mid : 0
      }
    }
    
    if (cost < amount) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const finalShares = (lo + hi) / 2
  const result = calculateBuyCost(pool, outcome, finalShares)
  return {
    shares: finalShares,
    newPool: result.newPool,
    avgPrice: finalShares > 0 ? amount / finalShares : 0
  }
}

/**
 * Calculate proceeds from selling shares back to the pool.
 * Selling YES shares is the reverse of buying: pool absorbs shares, user gets Kwacha.
 * 
 * @param pool - Current pool state
 * @param outcome - 'YES' or 'NO'
 * @param shares - Number of shares to sell
 * @returns proceeds in Kwacha and new pool state
 */
export function calculateSellProceeds(
  pool: PoolState,
  outcome: 'YES' | 'NO',
  shares: number
): { proceeds: number; newPool: PoolState; avgPrice: number } {
  if (shares <= 0) return { proceeds: 0, newPool: pool, avgPrice: 0 }

  let newYes = pool.yesShares
  let newNo = pool.noShares

  if (outcome === 'YES') {
    // Selling YES shares back: yesShares decrease, noShares increase
    // Clamp to prevent selling more than 95% of pool (prevents exploit)
    const maxSellable = pool.yesShares * 0.95
    const effectiveShares = Math.min(shares, maxSellable)
    if (effectiveShares <= 0) return { proceeds: 0, newPool: pool, avgPrice: 0 }

    newYes = pool.yesShares - effectiveShares
    newNo = pool.k / newYes
    const proceeds = (newNo - pool.noShares) + effectiveShares
    const avgPrice = effectiveShares > 0 ? Math.max(0, proceeds / effectiveShares) : 0

    return {
      proceeds: Math.max(0, proceeds),
      newPool: { yesShares: newYes, noShares: newNo, k: pool.k },
      avgPrice: Math.min(1, avgPrice),
    }
  } else {
    // Selling NO shares back
    const maxSellable = pool.noShares * 0.95
    const effectiveShares = Math.min(shares, maxSellable)
    if (effectiveShares <= 0) return { proceeds: 0, newPool: pool, avgPrice: 0 }

    newNo = pool.noShares - effectiveShares
    newYes = pool.k / newNo
    const proceeds = (newYes - pool.yesShares) + effectiveShares
    const avgPrice = effectiveShares > 0 ? Math.max(0, proceeds / effectiveShares) : 0

    return {
      proceeds: Math.max(0, proceeds),
      newPool: { yesShares: newYes, noShares: newNo, k: pool.k },
      avgPrice: Math.min(1, avgPrice),
    }
  }
}

/**
 * Calculate potential payout if outcome wins
 * @param shares - Number of shares held
 * @returns Payout in Kwacha (each winning share = K1)
 */
export function calculatePayout(shares: number): number {
  return shares // Each winning share pays K1
}

/**
 * Estimate price impact of a trade
 */
export function estimatePriceImpact(
  pool: PoolState,
  outcome: 'YES' | 'NO',
  amount: number
): { priceImpact: number; newYesPrice: number; newNoPrice: number } {
  const currentPrices = getPrices(pool)
  const { newPool } = calculateSharesForAmount(pool, outcome, amount)
  const newPrices = getPrices(newPool)

  const currentPrice = outcome === 'YES' ? currentPrices.yesPrice : currentPrices.noPrice
  const newPrice = outcome === 'YES' ? newPrices.yesPrice : newPrices.noPrice
  const priceImpact = currentPrice > 0 ? ((newPrice - currentPrice) / currentPrice) * 100 : 0

  return {
    priceImpact,
    newYesPrice: newPrices.yesPrice,
    newNoPrice: newPrices.noPrice
  }
}
