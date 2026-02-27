import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendWhatsAppOTP, generateOTP, normalizePhone } from '@/lib/whatsapp-otp'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
  try {
    const { phone, mode } = await request.json()

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    const normalized = normalizePhone(phone)
    if (!/^\+\d{9,15}$/.test(normalized)) {
      return NextResponse.json({ error: `Invalid phone number. Please use format: 0971234567 or +260971234567` }, { status: 400 })
    }

    // Rate limit: 3 OTP requests per 5 minutes per phone
    const rl = checkRateLimit(`otp:${normalized}`, 3, 300_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many OTP requests. Please wait before trying again.' },
        { status: 429 }
      )
    }

    const otp = generateOTP()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    const hashedOtp = await bcrypt.hash(otp, 10)

    if (mode === 'signup') {
      // For signup: check if phone already exists
      const existing = await prisma.user.findUnique({ where: { phone: normalized } })
      if (existing) {
        return NextResponse.json({ error: 'An account with this phone number already exists' }, { status: 400 })
      }
      // Store OTP temporarily — will be verified during actual signup
      // We store in a temp record or use a cache. For simplicity, we'll verify during signup call.
    } else {
      // For signin: check if phone exists
      const user = await prisma.user.findUnique({ where: { phone: normalized } })
      if (!user) {
        return NextResponse.json({ error: 'No account found with this phone number' }, { status: 404 })
      }
      // Store OTP on the user record
      await prisma.user.update({
        where: { phone: normalized },
        data: { phoneOtp: hashedOtp, phoneOtpExpiry: otpExpiry },
      })
    }

    // For signup, store OTP in a global temp store keyed by phone
    if (mode === 'signup') {
      // Use a lightweight approach: store as a "pending" user update or in-memory
      // We'll create a temp user record approach — store OTP on phone lookup
      // Better: just store in the request and verify on signup
      // For now, store in a global map (works for single-instance deployments)
      otpStore.set(normalized, { otp: hashedOtp, expiry: otpExpiry })
    }

    // Send OTP via WhatsApp
    const sent = await sendWhatsAppOTP(normalized, otp)
    if (!sent) {
      return NextResponse.json({ error: 'Failed to send OTP. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'OTP sent to your WhatsApp' })
  } catch (error) {
    console.error('[send-otp] Error:', error)
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}

// In-memory OTP store for signup flow (phone → hashed OTP + expiry)
// In production, use Redis or a DB table
const otpStore = new Map<string, { otp: string; expiry: Date }>()
export { otpStore }
