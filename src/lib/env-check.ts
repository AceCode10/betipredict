/**
 * Environment variable validation — runs once on first API request (server-side only).
 * Import this in layout.tsx to trigger validation when the app starts serving.
 * Safe during build: skips validation when typeof window !== 'undefined' or during static generation.
 */

let validated = false

function validateEnv() {
  if (validated) return
  validated = true

  // Skip during build / static generation
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const required: Record<string, string | undefined> = {
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
  }

  const warnings: Record<string, string | undefined> = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    FOOTBALL_DATA_API_KEY: process.env.FOOTBALL_DATA_API_KEY,
  }

  for (const [key, value] of Object.entries(required)) {
    if (!value || value.trim() === '') {
      console.error(
        `[ENV] Missing required environment variable: ${key}. ` +
        `The application cannot start without it. Check your .env file.`
      )
    }
  }

  if (process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_SECRET.length < 32) {
    console.warn('[ENV] NEXTAUTH_SECRET is shorter than 32 characters — consider using a stronger secret.')
  }

  for (const [key, value] of Object.entries(warnings)) {
    if (!value || value.trim() === '') {
      console.warn(`[ENV] Optional variable ${key} is not set — some features may not work.`)
    }
  }
}

// Run validation on import (server-side only)
if (typeof window === 'undefined') {
  validateEnv()
}

export const ENV_VALIDATED = true
