/**
 * BetiPredict Fee Configuration & Business Model
 * 
 * Revenue streams:
 * 1. Trading Fee    - 2% on every trade (buy/sell)
 * 2. Withdrawal Fee - 1.5% on Airtel Money withdrawals (min K5)
 * 3. Market Creation Fee - K50 flat fee to create a custom market
 * 4. Resolution Fee - 1% on winning payouts when markets resolve
 * 5. Spread Revenue - CPMM bid-ask spread naturally benefits the platform pool
 * 
 * All fees are collected into a platform revenue ledger.
 */

// ─── Fee Rates ───────────────────────────────────────────────
export const FEES = {
  // Trading fee: percentage deducted from the trade amount
  TRADE_FEE_RATE: 0.02, // 2%

  // Withdrawal fee: percentage deducted from withdrawal amount
  WITHDRAW_FEE_RATE: 0.015, // 1.5%
  WITHDRAW_FEE_MIN: 5, // Minimum K5 fee
  WITHDRAW_MIN_AMOUNT: 10, // Minimum withdrawal K10
  WITHDRAW_MAX_AMOUNT: 500_000, // Maximum withdrawal K500,000

  // Deposit limits (no fee on deposits to encourage inflow)
  DEPOSIT_MIN_AMOUNT: 1, // Minimum deposit K1
  DEPOSIT_MAX_AMOUNT: 1_000_000, // Maximum deposit K1,000,000

  // Market creation fee: flat fee in Kwacha
  MARKET_CREATION_FEE: 50, // K50

  // Resolution fee: percentage deducted from winning payouts
  RESOLUTION_FEE_RATE: 0.01, // 1%

  // Initial liquidity seeded by the platform for new markets
  DEFAULT_INITIAL_LIQUIDITY: 1000, // K1,000
} as const

// ─── Fee Calculation Helpers ─────────────────────────────────

export interface FeeBreakdown {
  grossAmount: number
  feeAmount: number
  netAmount: number
  feeRate: number
  feeType: string
}

/**
 * Calculate trading fee for a buy/sell order.
 * Fee is deducted from the user's spend amount (buy) or proceeds (sell).
 */
export function calculateTradeFee(amount: number): FeeBreakdown {
  const feeAmount = roundToNgwee(amount * FEES.TRADE_FEE_RATE)
  return {
    grossAmount: amount,
    feeAmount,
    netAmount: roundToNgwee(amount - feeAmount),
    feeRate: FEES.TRADE_FEE_RATE,
    feeType: 'TRADE_FEE',
  }
}

/**
 * Calculate withdrawal fee.
 * Fee is deducted from the withdrawal amount; user receives (amount - fee).
 */
export function calculateWithdrawalFee(amount: number): FeeBreakdown {
  const percentageFee = amount * FEES.WITHDRAW_FEE_RATE
  const feeAmount = roundToNgwee(Math.max(percentageFee, FEES.WITHDRAW_FEE_MIN))
  return {
    grossAmount: amount,
    feeAmount,
    netAmount: roundToNgwee(amount - feeAmount),
    feeRate: FEES.WITHDRAW_FEE_RATE,
    feeType: 'WITHDRAWAL_FEE',
  }
}

/**
 * Calculate resolution fee on winning payouts.
 */
export function calculateResolutionFee(winnings: number): FeeBreakdown {
  const feeAmount = roundToNgwee(winnings * FEES.RESOLUTION_FEE_RATE)
  return {
    grossAmount: winnings,
    feeAmount,
    netAmount: roundToNgwee(winnings - feeAmount),
    feeRate: FEES.RESOLUTION_FEE_RATE,
    feeType: 'RESOLUTION_FEE',
  }
}

/**
 * Get market creation fee (flat).
 */
export function getMarketCreationFee(): FeeBreakdown {
  return {
    grossAmount: FEES.MARKET_CREATION_FEE,
    feeAmount: FEES.MARKET_CREATION_FEE,
    netAmount: 0,
    feeRate: 1, // 100% — it's a flat fee
    feeType: 'MARKET_CREATION_FEE',
  }
}

/**
 * Format fee for display (e.g., "2%" or "K50")
 */
export function formatFeeRate(feeType: string): string {
  switch (feeType) {
    case 'TRADE_FEE':
      return `${(FEES.TRADE_FEE_RATE * 100).toFixed(0)}%`
    case 'WITHDRAWAL_FEE':
      return `${(FEES.WITHDRAW_FEE_RATE * 100).toFixed(1)}%`
    case 'RESOLUTION_FEE':
      return `${(FEES.RESOLUTION_FEE_RATE * 100).toFixed(0)}%`
    case 'MARKET_CREATION_FEE':
      return `K${FEES.MARKET_CREATION_FEE}`
    default:
      return ''
  }
}

/**
 * Round to nearest ngwee (2 decimal places).
 */
function roundToNgwee(amount: number): number {
  return Math.round(amount * 100) / 100
}
