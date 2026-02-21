/**
 * Idempotency Key Manager
 * 
 * Prevents duplicate payment processing by tracking request idempotency keys.
 * Uses PostgreSQL (via Prisma) for persistence — survives server restarts.
 * 
 * Keys are scoped by userId + route to prevent cross-user/cross-route collisions.
 * 
 * Usage:
 *   Client sends header: X-Idempotency-Key: <unique-uuid>
 *   Server checks if key was already processed and returns cached response.
 */

import { prisma } from './prisma'
import { NextResponse } from 'next/server'

// TTL: 24 hours
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Build a scoped idempotency key: userId:route:clientKey
 * Prevents the same client key from colliding across users or routes.
 */
export function scopeIdempotencyKey(clientKey: string, userId: string, route: string): string {
  return `${userId}:${route}:${clientKey}`
}

/**
 * Check if an idempotency key has already been used.
 * Returns the cached response if completed, 'processing' if in-flight, or null if new.
 */
export async function checkIdempotencyKey(key: string): Promise<{ status: number; body: any } | 'processing' | null> {
  const entry = await prisma.idempotencyKey.findUnique({ where: { key } })
  if (!entry) return null
  // Expired entries are treated as new
  if (entry.expiresAt < new Date()) {
    await prisma.idempotencyKey.delete({ where: { key } }).catch(() => {})
    return null
  }
  if (entry.status === 'processing') return 'processing'
  if (entry.httpStatus != null && entry.responseBody) {
    try {
      return { status: entry.httpStatus, body: JSON.parse(entry.responseBody) }
    } catch {
      return null
    }
  }
  return null
}

/**
 * Mark an idempotency key as being processed (lock).
 * Uses a unique constraint to prevent races.
 */
export async function lockIdempotencyKey(key: string): Promise<boolean> {
  try {
    await prisma.idempotencyKey.create({
      data: {
        key,
        status: 'processing',
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      }
    })
    return true
  } catch {
    // Unique constraint violation → key already exists
    return false
  }
}

/**
 * Complete an idempotency key with the response to cache.
 */
export async function completeIdempotencyKey(key: string, status: number, body: any): Promise<void> {
  await prisma.idempotencyKey.upsert({
    where: { key },
    update: {
      status: 'completed',
      httpStatus: status,
      responseBody: JSON.stringify(body),
    },
    create: {
      key,
      status: 'completed',
      httpStatus: status,
      responseBody: JSON.stringify(body),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
  })
}

/**
 * Release an idempotency key (e.g., on error, allow retry).
 */
export async function releaseIdempotencyKey(key: string): Promise<void> {
  await prisma.idempotencyKey.delete({ where: { key } }).catch(() => {})
}

/**
 * Extract idempotency key from request headers.
 * Returns null if no key is provided.
 */
export function getIdempotencyKeyFromRequest(headers: Headers): string | null {
  return headers.get('x-idempotency-key') || headers.get('idempotency-key') || null
}

/**
 * Wraps a handler with idempotency logic.
 * Guarantees release/complete on ALL exit paths (success, validation error, exception).
 * 
 * Usage:
 *   return withIdempotency(request, userId, 'withdraw', async (complete) => {
 *     // ... do work ...
 *     return complete(200, body) // caches and returns NextResponse
 *   })
 */
export async function withIdempotency(
  headers: Headers,
  userId: string,
  route: string,
  handler: (complete: (status: number, body: any) => NextResponse) => Promise<NextResponse>
): Promise<NextResponse | null> {
  const clientKey = getIdempotencyKeyFromRequest(headers)
  if (!clientKey) {
    // No idempotency key — run handler without idempotency
    const complete = (status: number, body: any) => NextResponse.json(body, { status })
    return handler(complete)
  }

  const scopedKey = scopeIdempotencyKey(clientKey, userId, route)

  // Check for existing entry
  const cached = await checkIdempotencyKey(scopedKey)
  if (cached === 'processing') {
    return NextResponse.json({ error: 'Request is already being processed' }, { status: 409 })
  }
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status })
  }

  // Lock the key
  if (!(await lockIdempotencyKey(scopedKey))) {
    return NextResponse.json({ error: 'Duplicate request' }, { status: 409 })
  }

  try {
    const complete = (status: number, body: any) => {
      // Fire-and-forget: cache the response
      completeIdempotencyKey(scopedKey, status, body).catch(() => {})
      return NextResponse.json(body, { status })
    }
    return await handler(complete)
  } catch (error) {
    // Release the key so the client can retry
    await releaseIdempotencyKey(scopedKey)
    throw error // Re-throw so the caller's catch block handles it
  }
}
