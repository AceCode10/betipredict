// Zambian Currency Utility Functions
// K = Kwacha, n = Ngwee (1 K = 100 n)

export interface CurrencyAmount {
  kwacha: number
  ngwee: number
}

/**
 * Convert decimal amount to Zambian currency format
 * @param amount - Amount in decimal (e.g., 0.45 for 45 ngwee)
 * @returns Formatted string (e.g., "K0.45" or "45n")
 */
export function formatZambianCurrency(amount: number, showNgwee: boolean = false): string {
  if (amount < 1 && showNgwee) {
    // Show in ngwee for amounts less than 1 Kwacha
    const ngwee = Math.round(amount * 100)
    return `${ngwee}n`
  } else {
    // Show in Kwacha
    return `K${amount.toFixed(2)}`
  }
}

/**
 * Convert price in decimal to cents-like format for display
 * @param price - Price as decimal (0-1)
 * @returns Formatted as ngwee (e.g., 45n for 0.45)
 */
export function formatPriceAsNgwee(price: number): string {
  const ngwee = Math.round(price * 100)
  return `${ngwee}n`
}

/**
 * Format volume for display in Kwacha
 * @param volume - Volume in Kwacha
 * @returns Formatted string (e.g., "K25.5M")
 */
export function formatVolume(volume: number): string {
  if (volume >= 1000000) {
    return `K${(volume / 1000000).toFixed(1)}M`
  } else if (volume >= 1000) {
    return `K${(volume / 1000).toFixed(0)}K`
  } else if (volume > 0) {
    return `K${volume.toFixed(0)}`
  } else {
    return 'K0'
  }
}

/**
 * Calculate total cost in Zambian currency
 * @param amount - Number of shares
 * @param price - Price per share (0-1)
 * @returns Total cost in Kwacha
 */
export function calculateTotalCost(amount: number, price: number): number {
  return amount * price
}

/**
 * Format total cost for display
 * @param amount - Number of shares
 * @param price - Price per share (0-1)
 * @returns Formatted string
 */
export function formatTotalCost(amount: number, price: number): string {
  const total = calculateTotalCost(amount, price)
  return formatZambianCurrency(total)
}

/**
 * Convert from ngwee to decimal
 * @param ngwee - Amount in ngwee
 * @returns Decimal amount
 */
export function ngweeToDecimal(ngwee: number): number {
  return ngwee / 100
}

/**
 * Convert from decimal to ngwee
 * @param decimal - Decimal amount
 * @returns Amount in ngwee
 */
export function decimalToNgwee(decimal: number): number {
  return Math.round(decimal * 100)
}

/**
 * Get currency symbol
 * @param amount - Amount to determine symbol for
 * @returns 'K' for Kwacha, 'n' for Ngwee
 */
export function getCurrencySymbol(amount: number): string {
  return amount >= 1 ? 'K' : 'n'
}

/**
 * Validate Zambian currency amount
 * @param amount - Amount to validate
 * @returns True if valid
 */
export function isValidZambianAmount(amount: number): boolean {
  return amount >= 0 && amount <= Number.MAX_SAFE_INTEGER
}

/**
 * Round to nearest ngwee (2 decimal places)
 * @param amount - Amount to round
 * @returns Rounded amount
 */
export function roundToNgwee(amount: number): number {
  return Math.round(amount * 100) / 100
}
