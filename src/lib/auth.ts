import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { generateToken, sendVerificationEmail } from "@/lib/email"
import { writeAuditLog } from "@/lib/audit"

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
              balance: 1000,
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
            throw new Error('Incorrect password')
          }

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
