import { NextRequest, NextResponse } from 'next/server'

// Simple in-memory rate limiter for Edge Runtime
// Uses a Map with IP -> { count, resetTime } entries
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

// Clean up stale entries every 60 seconds
const CLEANUP_INTERVAL = 60_000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, value] of rateLimitMap) {
    if (now > value.resetTime) rateLimitMap.delete(key)
  }
}

function rateLimit(ip: string, maxRequests: number, windowMs: number): boolean {
  cleanup()
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs })
    return true
  }

  if (entry.count >= maxRequests) return false

  entry.count++
  return true
}

// Rate limit configs per route pattern
const RATE_LIMITS: { pattern: RegExp; max: number; windowMs: number }[] = [
  // Auth routes: 10 requests per minute (prevent brute force)
  { pattern: /^\/api\/auth/, max: 10, windowMs: 60_000 },
  // Trade route: 20 requests per minute
  { pattern: /^\/api\/trade/, max: 20, windowMs: 60_000 },
  // Deposit/Withdraw: 10 requests per minute
  { pattern: /^\/api\/(deposit|withdraw)/, max: 10, windowMs: 60_000 },
  // Market creation: 5 requests per minute
  { pattern: /^\/api\/markets$/, max: 5, windowMs: 60_000 },
  // General API: 60 requests per minute
  { pattern: /^\/api\//, max: 60, windowMs: 60_000 },
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only rate-limit API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Skip rate limiting for GET requests on markets (public browsing)
  if (request.method === 'GET' && pathname === '/api/markets') {
    return NextResponse.next()
  }

  // Skip rate limiting for Airtel Money callback (external webhook)
  if (pathname === '/api/payments/callback') {
    return NextResponse.next()
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'

  // Find matching rate limit config
  for (const config of RATE_LIMITS) {
    if (config.pattern.test(pathname)) {
      const key = `${ip}:${config.pattern.source}`
      if (!rateLimit(key, config.max, config.windowMs)) {
        return NextResponse.json(
          { error: 'Too many requests. Please try again shortly.' },
          { status: 429 }
        )
      }
      break
    }
  }

  // Add security headers
  const response = NextResponse.next()
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return response
}

export const config = {
  matcher: ['/api/:path*'],
}
