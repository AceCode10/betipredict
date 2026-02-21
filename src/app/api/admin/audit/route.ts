import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin()
    if (!session) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const category = request.nextUrl.searchParams.get('category') || undefined
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 200)

    const logs = await prisma.auditLog.findMany({
      where: category ? { category } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ logs })
  } catch (error) {
    console.error('[Admin Audit] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }
}
