/**
 * Constant Product Market Maker (CPMM) for binary outcome markets
 * 
 * Uses the formula: yesShares * noShares = k (constant)
 * Price of YES = noShares / (yesShares + noShares)
 * Price of NO  = yesShares / (yesShares + noShares)
 * 
 * All amounts are in Kwacha (K)
 */

export interface PoolState {
  yesShares: number
  noShares: number
  k: number // invariant constant
}

/**
 * Initialize a new liquidity pool
 * @param liquidity - Initial liquidity in Kwacha (split equally)
 * @param initialYesPrice - Initial YES price (0-1), default 0.5
 */
export function initializePool(liquidity: number, initialYesPrice: number = 0.5): PoolState {
  // Derive share amounts from desired price and total liquidity
  // Price(YES) = noShares / (yesShares + noShares) = initialYesPrice
  // Total = yesShares + noShares ≈ liquidity
  const noShares = liquidity * initialYesPrice
  const yesShares = liquidity * (1 - initialYesPrice)
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
    yesPrice: pool.noShares / total,
    noPrice: pool.yesShares / total
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
