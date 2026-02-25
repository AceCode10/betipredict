/**
 * Lenco by Broadpay — Payment Integration Library
 * 
 * Handles:
 * - Mobile money collections (deposits) via popup widget
 * - Payment verification
 * - Webhook signature verification
 * - Status mapping
 * 
 * Lenco supports: MTN Mobile Money, Airtel Money, Zamkwacha, Visa/Mastercard
 * Fee structure (customer-borne): Local Card 3.5%, International Card 3.8%, Mobile Money 1%
 */

import crypto from 'crypto'

// ─── Configuration ───────────────────────────────────────────

function getLencoConfig() {
  const isSandbox = process.env.NEXT_PUBLIC_LENCO_ENVIRONMENT === 'sandbox'
  return {
    SECRET_KEY: process.env.LENCO_SECRET_KEY || '',
    PUBLIC_KEY: process.env.NEXT_PUBLIC_LENCO_PUBLIC_KEY || '',
    BASE_URL: isSandbox
      ? 'https://sandbox.lenco.co/access/v2'
      : 'https://api.lenco.co/access/v2',
    WIDGET_URL: isSandbox
      ? 'https://pay.sandbox.lenco.co/js/v1/inline.js'
      : 'https://pay.lenco.co/js/v1/inline.js',
    CURRENCY: 'ZMW',
    IS_SANDBOX: isSandbox,
  }
}

export class LencoError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'LencoError'
  }
}

export function isLencoConfigured(): boolean {
  const config = getLencoConfig()
  return !!config.SECRET_KEY && !!config.PUBLIC_KEY
}

export function getLencoPublicKey(): string {
  return getLencoConfig().PUBLIC_KEY
}

export function getLencoWidgetUrl(): string {
  return getLencoConfig().WIDGET_URL
}

export function isLencoSandbox(): boolean {
  return getLencoConfig().IS_SANDBOX
}

// ─── API Helpers ─────────────────────────────────────────────

async function lencoRequest(endpoint: string, method: string, body?: any) {
  const config = getLencoConfig()
  const url = `${config.BASE_URL}${endpoint}`
  
  console.log(`[Lenco] ${method} ${url}`)
  
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.SECRET_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const data = await response.json().catch(() => ({}))
  
  if (!response.ok || data.status === false) {
    console.error(`[Lenco] API error:`, response.status, JSON.stringify(data))
    throw new LencoError(
      data.message || `Lenco API request failed (${response.status})`,
      data.errorCode || 'API_ERROR'
    )
  }
  
  return data
}

// ─── Payment Verification ────────────────────────────────────

export interface LencoVerifyResponse {
  status: boolean
  message: string
  data: {
    id: string
    initiatedAt: string
    completedAt: string | null
    amount: string
    fee: string
    bearer: 'merchant' | 'customer'
    currency: string
    reference: string
    lencoReference: string
    type: 'mobile-money' | 'card'
    status: 'pending' | 'successful' | 'failed' | 'pay-offline' | 'otp-required'
    source: string
    reasonForFailure: string | null
    settlementStatus: 'pending' | 'settled' | null
    settlement: {
      id: string
      amountSettled: string
      currency: string
      status: string
      type: string
    } | null
    mobileMoneyDetails: {
      country: string
      phone: string
      operator: string
      accountName: string | null
      operatorTransactionId: string | null
    } | null
    cardDetails: {
      last4: string
      expMonth: string
      expYear: string
      type: string
      bank: string
    } | null
  }
}

/**
 * Verify a payment by its reference.
 * Use after popup widget onSuccess callback or to poll mobile money status.
 */
export async function verifyPayment(reference: string): Promise<LencoVerifyResponse> {
  return await lencoRequest(`/collections/status/${reference}`, 'GET')
}

// ─── Webhook Signature Verification ──────────────────────────

/**
 * Verify Lenco webhook signature.
 * 
 * Lenco sends X-Lenco-Signature header which is HMAC SHA512 of the payload
 * signed with a webhook_hash_key (SHA256 hash of your secret key).
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const config = getLencoConfig()
  
  if (!config.SECRET_KEY) {
    console.error('[Lenco Webhook] SECRET_KEY not configured')
    return false
  }

  if (!signatureHeader) {
    console.error('[Lenco Webhook] Missing X-Lenco-Signature header')
    return false
  }

  const webhookHashKey = crypto
    .createHash('sha256')
    .update(config.SECRET_KEY)
    .digest('hex')

  const expectedSignature = crypto
    .createHmac('sha512', webhookHashKey)
    .update(rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(signatureHeader, 'hex')
    )
  } catch {
    return false
  }
}

// ─── Status Mapping ──────────────────────────────────────────

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export function mapLencoStatus(lencoStatus: string): PaymentStatus {
  switch (lencoStatus) {
    case 'successful': return 'COMPLETED'
    case 'failed': return 'FAILED'
    case 'pending': return 'PENDING'
    case 'pay-offline': return 'PROCESSING'
    case 'otp-required': return 'PROCESSING'
    default: return 'PENDING'
  }
}

// ─── Disbursements (Withdrawals) ─────────────────────────────

export interface LencoDisbursementParams {
  phoneNumber: string     // Full international format e.g. +260971234567
  amount: number          // Amount in ZMW (net after fees)
  reference: string       // Our unique reference
  narration?: string      // Description shown to recipient
}

/**
 * Initiate a mobile money disbursement (payout) via Lenco.
 * Lenco auto-detects the operator (MTN/Airtel) from the phone number.
 */
export async function initiateDisbursement(params: LencoDisbursementParams): Promise<any> {
  // Normalize phone to international format
  let phone = params.phoneNumber.replace(/\s+/g, '')
  if (phone.startsWith('0')) phone = '+260' + phone.slice(1)
  if (!phone.startsWith('+')) phone = '+' + phone

  const payload = {
    amount: Math.round(params.amount),
    currency: 'ZMW',
    type: 'mobile-money',
    recipient: {
      phone,
      country: 'ZM',
    },
    clientReference: params.reference,
    narration: params.narration || `BetiPredict withdrawal ${params.reference}`,
  }

  return await lencoRequest('/transactions/initiate', 'POST', payload)
}

// ─── Reference Generator ─────────────────────────────────────

export function generateLencoRef(type: 'DEP' | 'WDR'): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `BP-${type}-${timestamp}-${random}`
}
