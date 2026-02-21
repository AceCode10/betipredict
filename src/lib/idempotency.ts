/**
 * Idempotency Key Manager
 * 
 * Prevents duplicate payment processing by tracking request idempotency keys.
 * Uses in-memory store for development; replace with Redis for production.
 * 
 * Usage:
 *   Client sends header: X-Idempotency-Key: <unique-uuid>
 *   Server checks if key was already processed and returns cached response.
 */

interface IdempotencyEntry {
  status: 'processing' | 'completed'
  response?: { status: number; body: any }
  createdAt: number
}

// In-memory store (replace with Redis in production)
const idempotencyStore = new Map<string, IdempotencyEntry>()

// TTL: 24 hours
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

// Cleanup interval: every 10 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, entry] of idempotencyStore) {
    if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key)
    }
  }
}

/**
 * Check if an idempotency key has already been used.
 * Returns the cached response if the key was already processed,
 * or null if this is a new request.
 */
export function checkIdempotencyKey(key: string): { status: number; body: any } | 'processing' | null {
  cleanup()
  const entry = idempotencyStore.get(key)
  if (!entry) return null
  if (entry.status === 'processing') return 'processing'
  return entry.response || null
}

/**
 * Mark an idempotency key as being processed (lock).
 */
export function lockIdempotencyKey(key: string): boolean {
  cleanup()
  if (idempotencyStore.has(key)) return false
  idempotencyStore.set(key, { status: 'processing', createdAt: Date.now() })
  return true
}

/**
 * Complete an idempotency key with the response to cache.
 */
export function completeIdempotencyKey(key: string, status: number, body: any): void {
  idempotencyStore.set(key, {
    status: 'completed',
    response: { status, body },
    createdAt: Date.now(),
  })
}

/**
 * Release an idempotency key (e.g., on error, allow retry).
 */
export function releaseIdempotencyKey(key: string): void {
  idempotencyStore.delete(key)
}

/**
 * Extract idempotency key from request headers.
 * Returns null if no key is provided.
 */
export function getIdempotencyKeyFromRequest(headers: Headers): string | null {
  return headers.get('x-idempotency-key') || headers.get('idempotency-key') || null
}
