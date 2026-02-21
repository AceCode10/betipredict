import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatar: true,
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
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Error fetching profile:', error)
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const updates: Record<string, string> = {}

    // Validate and sanitize username
    if (typeof body.username === 'string') {
      const username = body.username.trim().toLowerCase()
      if (username.length < 3 || username.length > 30) {
        return NextResponse.json({ error: 'Username must be 3-30 characters' }, { status: 400 })
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        return NextResponse.json({ error: 'Username can only contain letters, numbers, and underscores' }, { status: 400 })
      }
      // Check uniqueness
      const existing = await prisma.user.findUnique({ where: { username } })
      if (existing && existing.id !== session.user.id) {
        return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
      }
      updates.username = username
    }

    // Validate fullName
    if (typeof body.fullName === 'string') {
      const fullName = body.fullName.trim()
      if (fullName.length < 1 || fullName.length > 100) {
        return NextResponse.json({ error: 'Name must be 1-100 characters' }, { status: 400 })
      }
      updates.fullName = fullName
    }

    // Validate avatar URL
    if (typeof body.avatar === 'string') {
      const avatar = body.avatar.trim()
      if (avatar && avatar.length > 500) {
        return NextResponse.json({ error: 'Avatar URL too long' }, { status: 400 })
      }
      updates.avatar = avatar
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: updates,
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatar: true,
      }
    })

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
