import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const start = Date.now()
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {}

  // Database check
  try {
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart }
  } catch (error: any) {
    checks.database = { status: 'error', error: error.message?.slice(0, 100) }
  }

  // Environment check
  checks.environment = {
    status: process.env.NEXTAUTH_SECRET ? 'ok' : 'warning',
    ...(process.env.NEXTAUTH_SECRET ? {} : { error: 'NEXTAUTH_SECRET not set' }),
  }

  const allOk = Object.values(checks).every(c => c.status === 'ok')

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
      checks,
    },
    { status: allOk ? 200 : 503 }
  )
}
