/**
 * Email Utility
 * 
 * Handles email verification tokens and password reset tokens.
 * Uses console logging as a stand-in for actual email sending.
 * Replace with a real email provider (e.g., Resend, SendGrid, AWS SES) for production.
 */

import crypto from 'crypto'

const APP_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000'

/**
 * Generate a secure random token (URL-safe base64).
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Generate a 6-digit OTP code.
 */
export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString()
}

/**
 * Send a verification email to the user.
 * In production, replace this with an actual email service.
 */
export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${token}`

  // TODO: Replace with real email provider
  console.log(`[Email] Verification email for ${email}:`)
  console.log(`[Email] Verify URL: ${verifyUrl}`)

  // Example integration with a real provider:
  // await resend.emails.send({
  //   from: 'BetiPredict <noreply@betipredict.com>',
  //   to: email,
  //   subject: 'Verify your BetiPredict account',
  //   html: `<p>Click <a href="${verifyUrl}">here</a> to verify your email.</p>`,
  // })
}

/**
 * Send a password reset email to the user.
 * In production, replace this with an actual email service.
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/auth/reset-password?token=${token}`

  // TODO: Replace with real email provider
  console.log(`[Email] Password reset email for ${email}:`)
  console.log(`[Email] Reset URL: ${resetUrl}`)
}
