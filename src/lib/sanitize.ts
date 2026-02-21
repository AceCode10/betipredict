/**
 * Input Sanitization Utility
 * 
 * Prevents XSS, SQL injection fragments, and other malicious input.
 * Applied to all user-facing text inputs before storage.
 */

/**
 * Strip HTML tags from a string to prevent stored XSS.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '')
}

/**
 * Sanitize a general text input:
 * - Trim whitespace
 * - Strip HTML tags
 * - Collapse multiple whitespace
 * - Limit length
 */
export function sanitizeText(input: string, maxLength: number = 2000): string {
  if (typeof input !== 'string') return ''
  return stripHtml(input)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
}

/**
 * Sanitize an email address.
 */
export function sanitizeEmail(input: string): string {
  if (typeof input !== 'string') return ''
  return input.trim().toLowerCase().slice(0, 254)
}

/**
 * Sanitize a username (alphanumeric, underscores, hyphens only).
 */
export function sanitizeUsername(input: string): string {
  if (typeof input !== 'string') return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30)
}

/**
 * Sanitize a phone number (digits, +, spaces, hyphens only).
 */
export function sanitizePhone(input: string): string {
  if (typeof input !== 'string') return ''
  return input.replace(/[^\d+\s-]/g, '').trim().slice(0, 20)
}

/**
 * Validate and sanitize a numeric amount.
 * Returns NaN if invalid.
 */
export function sanitizeAmount(input: any): number {
  const num = Number(input)
  if (!Number.isFinite(num) || num < 0) return NaN
  // Round to 2 decimal places (ngwee precision)
  return Math.round(num * 100) / 100
}

/**
 * Sanitize a market question or title.
 */
export function sanitizeMarketText(input: string, maxLength: number = 500): string {
  return sanitizeText(input, maxLength)
}

/**
 * Check if a string contains potential injection patterns.
 * Returns true if suspicious content is detected.
 */
export function hasSuspiciousContent(input: string): boolean {
  if (typeof input !== 'string') return false
  const patterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // onclick=, onerror=, etc.
    /data:\s*text\/html/i,
    /eval\s*\(/i,
    /expression\s*\(/i,
    /url\s*\(/i,
    /import\s*\(/i,
  ]
  return patterns.some(p => p.test(input))
}

/**
 * Deep sanitize an object's string values (for JSON metadata).
 */
export function sanitizeObject(obj: Record<string, any>, maxDepth: number = 3): Record<string, any> {
  if (maxDepth <= 0) return {}
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeText(value, 1000)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeObject(value, maxDepth - 1)
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, 100).map(v =>
        typeof v === 'string' ? sanitizeText(v, 500) : v
      )
    }
  }
  return result
}
