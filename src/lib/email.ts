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

// ─── Transactional Notification Emails ──────────────────────

interface EmailPayload {
  to: string
  subject: string
  text: string
  html?: string
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  // TODO: Replace with real email provider (Resend, SendGrid, AWS SES)
  // Example with Resend:
  // const resend = new Resend(process.env.RESEND_API_KEY)
  // await resend.emails.send({ from: 'BetiPredict <noreply@betipredict.com>', ...payload })
  console.log(`[Email] To: ${payload.to} | Subject: ${payload.subject}`)
  console.log(`[Email] Body: ${payload.text}`)
}

export async function sendTradeConfirmation(
  email: string,
  details: { side: string; outcome: string; amount: number; shares: number; market: string }
): Promise<void> {
  const { side, outcome, amount, shares, market } = details
  await sendEmail({
    to: email,
    subject: `Trade Confirmed: ${side} ${outcome} on "${market}"`,
    text: `Your ${side} order has been filled.\n\nMarket: ${market}\nOutcome: ${outcome}\nAmount: K${amount.toFixed(2)}\nShares: ${shares.toFixed(2)}\n\nView your portfolio: ${APP_URL}/account`,
  })
}

export async function sendDepositConfirmation(
  email: string,
  details: { amount: number; method: string }
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Deposit Received: K${details.amount.toFixed(2)}`,
    text: `Your deposit of K${details.amount.toFixed(2)} via ${details.method} has been credited to your account.\n\nView your balance: ${APP_URL}/account`,
  })
}

export async function sendWithdrawalConfirmation(
  email: string,
  details: { amount: number; fee: number; netAmount: number; method: string }
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Withdrawal Processed: K${details.netAmount.toFixed(2)}`,
    text: `Your withdrawal has been processed.\n\nGross: K${details.amount.toFixed(2)}\nFee: K${details.fee.toFixed(2)}\nNet sent: K${details.netAmount.toFixed(2)}\nMethod: ${details.method}\n\nView your balance: ${APP_URL}/account`,
  })
}

export async function sendPayoutNotification(
  email: string,
  details: { market: string; outcome: string; payout: number }
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Payout: K${details.payout.toFixed(2)} from "${details.market}"`,
    text: `The market "${details.market}" has been resolved.\n\nWinning outcome: ${details.outcome}\nYour payout: K${details.payout.toFixed(2)}\n\nView your portfolio: ${APP_URL}/account`,
  })
}
