import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateToken, sendVerificationEmail } from '@/lib/email'

/**
 * GET  /api/auth/verify-email?token=xxx - Verify email with token
 * POST /api/auth/verify-email            - Request a new verification email
 */

// Verify email with token
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Verification token is required' }, { status: 400 })
    }

    const user = await prisma.user.findFirst({
      where: {
        verificationToken: token,
        verificationTokenExpiry: { gt: new Date() },
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid or expired verification token. Please request a new one.' },
        { status: 400 }
      )
    }

    // Mark user as verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null,
      }
    })

    // Redirect to sign-in page with success message
    const redirectUrl = new URL('/auth/signin?verified=true', request.nextUrl.origin)
    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('[Verify Email] Error:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}

// Request a new verification email
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.isVerified) {
      return NextResponse.json({ message: 'Email is already verified' })
    }

    // Generate new verification token (expires in 24h)
    const token = generateToken()
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken: token,
        verificationTokenExpiry: expiry,
      }
    })

    await sendVerificationEmail(user.email, token)

    return NextResponse.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
    })
  } catch (error) {
    console.error('[Verify Email] Error:', error)
    return NextResponse.json({ error: 'Failed to send verification email' }, { status: 500 })
  }
}
