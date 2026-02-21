import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { generateToken, sendVerificationEmail } from "@/lib/email"
import { writeAuditLog } from "@/lib/audit"
import { checkRateLimit } from "@/lib/rate-limit"

// Track failed login attempts per email for account lockout
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mode: { label: "Mode", type: "text" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = credentials.email.trim().toLowerCase()
        const password = credentials.password
        const mode = credentials.mode || 'signin'

        // Email validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error('Invalid email format')
        }

        // Password validation
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters')
        }

        // Rate limit: 10 auth attempts per minute per email
        const rl = checkRateLimit(`auth:${email}`, 10, 60_000)
        if (!rl.allowed) {
          throw new Error('Too many attempts. Please wait before trying again.')
        }

        // Account lockout check
        const failed = failedAttempts.get(email)
        if (failed && failed.count >= MAX_FAILED_ATTEMPTS) {
          const elapsed = Date.now() - failed.lastAttempt
          if (elapsed < LOCKOUT_DURATION_MS) {
            const minutesLeft = Math.ceil((LOCKOUT_DURATION_MS - elapsed) / 60000)
            throw new Error(`Account temporarily locked. Try again in ${minutesLeft} minute(s).`)
          }
          failedAttempts.delete(email) // Lockout expired
        }

        let user = await prisma.user.findUnique({
          where: { email }
        })

        if (mode === 'signup') {
          // Sign Up: create new account
          if (user) {
            throw new Error('An account with this email already exists')
          }

          const hashedPassword = await bcrypt.hash(password, 12)
          const verificationToken = generateToken()
          const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

          user = await prisma.user.create({
            data: {
              email,
              password: hashedPassword,
              username: email.split('@')[0] + '_' + Date.now().toString(36),
              fullName: email.split('@')[0],
              balance: 0, // No free signup bonus — users must deposit real money
              isVerified: false,
              verificationToken,
              verificationTokenExpiry,
            }
          })

          // Send verification email (fire-and-forget)
          sendVerificationEmail(email, verificationToken).catch(err =>
            console.error('[Auth] Failed to send verification email:', err)
          )

          writeAuditLog({
            action: 'USER_SIGNUP',
            category: 'USER',
            details: { email, userId: user.id },
            actorId: user.id,
          })
        } else {
          // Sign In: verify existing account
          if (!user) {
            throw new Error('No account found with this email')
          }

          if (!user.password) {
            throw new Error('Please reset your password')
          }

          const isPasswordValid = await bcrypt.compare(password, user.password)
          if (!isPasswordValid) {
            // Track failed attempt
            const current = failedAttempts.get(email) || { count: 0, lastAttempt: 0 }
            failedAttempts.set(email, { count: current.count + 1, lastAttempt: Date.now() })
            const remaining = MAX_FAILED_ATTEMPTS - current.count - 1
            if (remaining <= 0) {
              throw new Error('Account temporarily locked due to too many failed attempts. Try again in 15 minutes.')
            }
            throw new Error('Incorrect password')
          }

          // Clear failed attempts on successful login
          failedAttempts.delete(email)

          writeAuditLog({
            action: 'USER_LOGIN',
            category: 'USER',
            details: { email, userId: user.id },
            actorId: user.id,
          })
        }

        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          username: user.username,
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
