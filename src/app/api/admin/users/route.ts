import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin()
    if (!session) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const search = request.nextUrl.searchParams.get('search') || ''
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 100)

    const users = await prisma.user.findMany({
      where: search ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { fullName: { contains: search, mode: 'insensitive' } },
        ]
      } : undefined,
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        balance: true,
        isVerified: true,
        createdAt: true,
        _count: {
          select: {
            orders: true,
            positions: true,
            transactions: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('[Admin Users] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
