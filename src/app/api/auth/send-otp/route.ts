import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendOTP, normalizePhone } from '@/lib/whatsapp-otp'

export async function POST(request: NextRequest) {
  try {
    const { phone, mode } = await request.json()

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    const normalized = normalizePhone(phone)
    if (!/^\+\d{9,15}$/.test(normalized)) {
      return NextResponse.json({ error: 'Invalid phone number. Please use format: 0971234567 or +260971234567' }, { status: 400 })
    }

    // Rate limit: 3 OTP requests per 5 minutes per phone
    const rl = checkRateLimit(`otp:${normalized}`, 3, 300_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many OTP requests. Please wait before trying again.' },
        { status: 429 }
      )
    }

    if (mode === 'signup') {
      // For signup: check if phone already exists
      const existing = await prisma.user.findUnique({ where: { phone: normalized } })
      if (existing) {
        return NextResponse.json({ error: 'An account with this phone number already exists' }, { status: 400 })
      }
    } else {
      // For signin: check if phone exists
      const user = await prisma.user.findUnique({ where: { phone: normalized } })
      if (!user) {
        return NextResponse.json({ error: 'No account found with this phone number' }, { status: 404 })
      }
    }

    // Send OTP via Twilio Verify — Twilio handles code generation, delivery, and expiry
    const sent = await sendOTP(normalized)
    if (!sent) {
      return NextResponse.json({ error: 'Failed to send OTP. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'OTP sent via SMS' })
  } catch (error) {
    console.error('[send-otp] Error:', error)
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}
