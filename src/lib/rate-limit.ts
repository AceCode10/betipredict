/**
 * In-memory sliding-window rate limiter.
 * Each key (e.g. IP or userId) gets a window of timestamps.
 * Efficient: prunes expired entries lazily.
 * 
 * For production at scale, replace with Redis-backed limiter.
 */

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Periodic cleanup to prevent memory leaks (every 5 minutes)
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
      entry.timestamps = entry.timestamps.filter(t => now - t < 300_000)
      if (entry.timestamps.length === 0) store.delete(key)
    }
  }, 300_000)
  // Unref so it doesn't keep process alive
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    (cleanupTimer as any).unref()
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetMs: number
}

/**
 * Check and consume a rate limit token.
 * @param key - Unique identifier (IP, userId, etc.)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  ensureCleanup()
  
  const now = Date.now()
  const cutoff = now - windowMs

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Prune expired timestamps
  entry.timestamps = entry.timestamps.filter(t => t > cutoff)

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0]
    return {
      allowed: false,
      remaining: 0,
      resetMs: oldestInWindow + windowMs - now,
    }
  }

  entry.timestamps.push(now)

  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: windowMs,
  }
}

/**
 * Extract client IP from Next.js request for rate limiting.
 * Respects X-Forwarded-For behind proxies (Vercel, Cloudflare).
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // Take the first IP (client IP) from the chain
    return forwarded.split(',')[0].trim()
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return '127.0.0.1'
}

/**
 * Sanitize a string input - strips HTML tags, trims, limits length.
 */
export function sanitizeString(input: string, maxLength: number = 500): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/[<>"'&]/g, '') // Remove potentially dangerous chars
    .trim()
    .slice(0, maxLength)
}

/**
 * Validate and clamp a numeric input.
 */
export function sanitizeNumber(
  input: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const num = Number(input)
  if (!Number.isFinite(num)) return fallback
  return Math.min(Math.max(num, min), max)
}
