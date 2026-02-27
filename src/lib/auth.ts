import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { generateToken, sendVerificationEmail } from "@/lib/email"
import { writeAuditLog } from "@/lib/audit"
import { checkRateLimit } from "@/lib/rate-limit"
import { normalizePhone, verifyOTP } from "@/lib/whatsapp-otp"

// Track failed login attempts per identifier for account lockout
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

function isPhone(value: string): boolean {
  const cleaned = value.replace(/[\s\-()]/g, '')
  return /^(\+?\d{9,15}|0\d{9,12})$/.test(cleaned)
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email or Phone", type: "text" },
        password: { label: "Password", type: "password" },
        mode: { label: "Mode", type: "text" },
        phone: { label: "Phone", type: "text" },
        otp: { label: "OTP", type: "text" },
        fullName: { label: "Full Name", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.password) return null

        const password = credentials.password
        const mode = credentials.mode || 'signin'
        const rawPhone = credentials.phone?.trim()
        const rawEmail = credentials.email?.trim().toLowerCase()
        const otp = credentials.otp?.trim()
        const rawFullName = credentials.fullName?.trim()

        // Determine if this is phone-based or email-based auth
        const usePhone = !!rawPhone && isPhone(rawPhone)
        const identifier = usePhone ? normalizePhone(rawPhone!) : rawEmail || ''

        if (!identifier) {
          throw new Error('Phone number or email is required')
        }

        // Password validation
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters')
        }

        // Rate limit
        const rl = checkRateLimit(`auth:${identifier}`, 10, 60_000)
        if (!rl.allowed) {
          throw new Error('Too many attempts. Please wait before trying again.')
        }

        // Account lockout check
        const failed = failedAttempts.get(identifier)
        if (failed && failed.count >= MAX_FAILED_ATTEMPTS) {
          const elapsed = Date.now() - failed.lastAttempt
          if (elapsed < LOCKOUT_DURATION_MS) {
            const minutesLeft = Math.ceil((LOCKOUT_DURATION_MS - elapsed) / 60000)
            throw new Error(`Account temporarily locked. Try again in ${minutesLeft} minute(s).`)
          }
          failedAttempts.delete(identifier)
        }

        if (mode === 'signup') {
          // ── SIGN UP ──
          if (usePhone) {
            // Phone-based signup: require OTP verification via Twilio Verify
            if (!otp) throw new Error('OTP verification code is required')

            const otpValid = await verifyOTP(identifier, otp)
            if (!otpValid) throw new Error('Invalid or expired OTP code. Please request a new one.')

            // Check if phone already registered
            const existing = await prisma.user.findUnique({ where: { phone: identifier } })
            if (existing) throw new Error('An account with this phone number already exists')

            const hashedPassword = await bcrypt.hash(password, 12)
            const phoneDigits = identifier.replace(/\D/g, '').slice(-6)
            const user = await prisma.user.create({
              data: {
                email: rawEmail || `${phoneDigits}_${Date.now().toString(36)}@phone.betipredict.com`,
                phone: identifier,
                password: hashedPassword,
                username: 'user_' + Date.now().toString(36),
                fullName: rawFullName || rawEmail?.split('@')[0] || `User ${phoneDigits}`,
                balance: 0,
                isVerified: true,
                isPhoneVerified: true,
              }
            })

            writeAuditLog({ action: 'USER_SIGNUP', category: 'USER', details: { phone: identifier, userId: user.id }, actorId: user.id })

            return { id: user.id, email: user.email, name: user.fullName, username: user.username }
          } else {
            // Email-based signup (legacy flow)
            if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
              throw new Error('Invalid email format')
            }
            const existing = await prisma.user.findUnique({ where: { email: rawEmail } })
            if (existing) throw new Error('An account with this email already exists')

            const hashedPassword = await bcrypt.hash(password, 12)
            const verificationToken = generateToken()
            const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

            const user = await prisma.user.create({
              data: {
                email: rawEmail,
                password: hashedPassword,
                username: rawEmail.split('@')[0] + '_' + Date.now().toString(36),
                fullName: rawEmail.split('@')[0],
                balance: 0,
                isVerified: false,
                verificationToken,
                verificationTokenExpiry,
              }
            })

            sendVerificationEmail(rawEmail, verificationToken).catch(err =>
              console.error('[Auth] Failed to send verification email:', err)
            )

            writeAuditLog({ action: 'USER_SIGNUP', category: 'USER', details: { email: rawEmail, userId: user.id }, actorId: user.id })

            return { id: user.id, email: user.email, name: user.fullName, username: user.username }
          }
        } else {
          // ── SIGN IN ──
          let user
          if (usePhone) {
            user = await prisma.user.findUnique({ where: { phone: identifier } })
            if (!user) throw new Error('No account found with this phone number')
          } else {
            if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
              throw new Error('Invalid email format')
            }
            user = await prisma.user.findUnique({ where: { email: rawEmail } })
            if (!user) throw new Error('No account found with this email')
          }

          if (!user.password) throw new Error('Please reset your password')

          const isPasswordValid = await bcrypt.compare(password, user.password)
          if (!isPasswordValid) {
            const current = failedAttempts.get(identifier) || { count: 0, lastAttempt: 0 }
            failedAttempts.set(identifier, { count: current.count + 1, lastAttempt: Date.now() })
            const remaining = MAX_FAILED_ATTEMPTS - current.count - 1
            if (remaining <= 0) {
              throw new Error('Account temporarily locked due to too many failed attempts. Try again in 15 minutes.')
            }
            throw new Error('Incorrect password')
          }

          failedAttempts.delete(identifier)

          writeAuditLog({ action: 'USER_LOGIN', category: 'USER', details: { identifier, userId: user.id }, actorId: user.id })

          return { id: user.id, email: user.email, name: user.fullName, username: user.username }
        }
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.username = user.username
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.username = token.username as string
      }
      return session
    }
  },
  pages: {
    signIn: "/auth/signin",
  }
}
