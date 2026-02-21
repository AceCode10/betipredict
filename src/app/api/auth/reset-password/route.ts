import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateToken, sendPasswordResetEmail } from '@/lib/email'
import bcrypt from 'bcryptjs'

/**
 * POST /api/auth/reset-password
 * 
 * Two modes:
 *   1. { email } — Request a password reset link
 *   2. { token, newPassword } — Reset password with token
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Mode 1: Request reset link
    if (body.email && !body.token) {
      const email = body.email.trim().toLowerCase()

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
      }

      const user = await prisma.user.findUnique({ where: { email } })

      // Always return success to prevent email enumeration
      if (!user) {
        return NextResponse.json({
          success: true,
          message: 'If an account exists with this email, a reset link has been sent.',
        })
      }

      const token = generateToken()
      const expiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: token,
          resetPasswordExpiry: expiry,
        }
      })

      await sendPasswordResetEmail(email, token)

      return NextResponse.json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.',
      })
    }

    // Mode 2: Reset password with token
    if (body.token && body.newPassword) {
      const { token, newPassword } = body

      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return NextResponse.json(
          { error: 'Password must be at least 6 characters' },
          { status: 400 }
        )
      }

      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: token,
          resetPasswordExpiry: { gt: new Date() },
        }
      })

      if (!user) {
        return NextResponse.json(
          { error: 'Invalid or expired reset token. Please request a new one.' },
          { status: 400 }
        )
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12)

      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetPasswordToken: null,
          resetPasswordExpiry: null,
        }
      })

      return NextResponse.json({
        success: true,
        message: 'Password has been reset successfully. You can now sign in.',
      })
    }

    return NextResponse.json(
      { error: 'Provide either { email } to request reset, or { token, newPassword } to reset.' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[Reset Password] Error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
