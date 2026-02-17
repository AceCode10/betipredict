import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        let user = await prisma.user.findUnique({
          where: {
            email: credentials.email
          }
        })

        // Create user if doesn't exist (for demo purposes)
        if (!user) {
          user = await prisma.user.create({
            data: {
              email: credentials.email,
              username: credentials.email.split('@')[0],
              fullName: "Demo User",
              balance: 1000,
              isVerified: true,
            }
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
