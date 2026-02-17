import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

async function verifyToken(token: string): Promise<{ success: boolean; error?: string }> {
  const user = await prisma.user.findFirst({
    where: {
      verificationToken: token,
      verificationTokenExpiry: { gt: new Date() }
    }
  })

  if (!user) {
    return { success: false, error: 'Invalid or expired verification token' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isVerified: true,
      verificationToken: null,
      verificationTokenExpiry: null
    }
  })

  return { success: true }
}

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()
    if (!token) {
      return NextResponse.json({ error: 'Verification token required' }, { status: 400 })
    }
    const result = await verifyToken(token)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ message: 'Email verified successfully', success: true })
  } catch (error) {
    console.error('Email verification error:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/auth/verify?error=missing-token', request.url))
  }
  try {
    const result = await verifyToken(token)
    if (result.success) {
      return NextResponse.redirect(new URL('/auth/verify?success=true', request.url))
    }
    return NextResponse.redirect(new URL('/auth/verify?error=invalid-token', request.url))
  } catch {
    return NextResponse.redirect(new URL('/auth/verify?error=server-error', request.url))
  }
}
