/**
 * Airtel Money API Integration for Zambia
 * 
 * Handles:
 * - OAuth2 authentication (bearer token)
 * - Collection (deposit): push USSD prompt to user's phone
 * - Disbursement (withdrawal): send money to user's Airtel Money wallet
 * - Transaction status enquiry
 * 
 * API Docs: https://developers.airtel.africa/
 * 
 * Environment:
 *   Staging:    https://openapiuat.airtel.africa
 *   Production: https://openapi.airtel.africa
 */

// ─── Configuration ───────────────────────────────────────────

const AIRTEL_CONFIG = {
  get BASE_URL() {
    return process.env.AIRTEL_MONEY_ENV === 'production'
      ? 'https://openapi.airtel.africa'
      : 'https://openapiuat.airtel.africa'
  },
  get CLIENT_ID() {
    return process.env.AIRTEL_MONEY_CLIENT_ID || ''
  },
  get CLIENT_SECRET() {
    return process.env.AIRTEL_MONEY_CLIENT_SECRET || ''
  },
  // Zambia country code
  COUNTRY: 'ZM',
  CURRENCY: 'ZMW',
  // Airtel Money PIN for disbursements (encrypted, stored in env)
  get DISBURSEMENT_PIN() {
    return process.env.AIRTEL_MONEY_PIN || ''
  },
  // Callback URL for payment notifications
  get CALLBACK_URL() {
    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    return `${base}/api/payments/callback`
  },
}

// ─── Types ───────────────────────────────────────────────────

export interface AirtelAuthResponse {
  access_token: string
  expires_in: number
  token_type: string
}

export interface AirtelCollectionRequest {
  phoneNumber: string // Subscriber MSISDN (e.g., "0971234567")
  amount: number
  reference: string // Unique transaction reference
}

export interface AirtelDisbursementRequest {
  phoneNumber: string
  amount: number
  reference: string
}

export interface AirtelTransactionResponse {
  status: {
    code: string
    message: string
    result_code: string
    response_code: string
    success: boolean
  }
  data: {
    transaction: {
      id: string
      status: string
      airtel_money_id?: string
      message?: string
    }
  }
}

export interface AirtelStatusResponse {
  status: {
    code: string
    message: string
    result_code: string
    response_code: string
    success: boolean
  }
  data: {
    transaction: {
      airtel_money_id: string
      id: string
      status: 'TS' | 'TF' | 'TA' | 'TIP' // Success, Failed, Ambiguous, In Progress
      message: string
    }
  }
}

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

// ─── Token Management ────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null

/**
 * Get a valid OAuth2 bearer token, refreshing if expired.
 */
async function getAuthToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token
  }

  if (!AIRTEL_CONFIG.CLIENT_ID || !AIRTEL_CONFIG.CLIENT_SECRET) {
    throw new AirtelMoneyError(
      'Airtel Money credentials not configured. Set AIRTEL_MONEY_CLIENT_ID and AIRTEL_MONEY_CLIENT_SECRET.',
      'CONFIG_ERROR'
    )
  }

  const response = await fetch(`${AIRTEL_CONFIG.BASE_URL}/auth/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
    },
    body: JSON.stringify({
      client_id: AIRTEL_CONFIG.CLIENT_ID,
      client_secret: AIRTEL_CONFIG.CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('Airtel auth failed:', response.status, text)
    throw new AirtelMoneyError('Failed to authenticate with Airtel Money', 'AUTH_ERROR')
  }

  const data: AirtelAuthResponse = await response.json()

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  }

  return cachedToken.token
}

// ─── Custom Error Class ──────────────────────────────────────

export class AirtelMoneyError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'AirtelMoneyError'
    this.code = code
  }
}

// ─── Phone Number Helpers ────────────────────────────────────

/**
 * Normalize Zambian phone number to MSISDN format (without country code prefix).
 * Accepts: 0971234567, +260971234567, 260971234567, 971234567
 * Returns: 971234567 (9 digits, no leading zero or country code)
 */
export function normalizeZambianPhone(phone: string): string {
  // Strip all non-digit characters
  let digits = phone.replace(/\D/g, '')

  // Remove Zambian country code if present
  if (digits.startsWith('260') && digits.length >= 12) {
    digits = digits.slice(3)
  }

  // Remove leading zero
  if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.slice(1)
  }

  // Validate: should be 9 digits starting with 7 or 9 (Airtel Zambia)
  if (!/^[79]\d{8}$/.test(digits)) {
    throw new AirtelMoneyError(
      'Invalid Zambian phone number. Must be an Airtel Zambia number (e.g., 097XXXXXXX).',
      'INVALID_PHONE'
    )
  }

  return digits
}

/**
 * Validate that the phone number belongs to Airtel Zambia.
 * Airtel Zambia prefixes: 097X, 077X
 */
export function isAirtelZambiaNumber(phone: string): boolean {
  try {
    const normalized = normalizeZambianPhone(phone)
    // Airtel Zambia: starts with 97 or 77
    return normalized.startsWith('97') || normalized.startsWith('77')
  } catch {
    return false
  }
}

// ─── Collection (Deposit) ────────────────────────────────────

/**
 * Initiate a collection payment (user → platform).
 * Sends a USSD push to the user's phone to authorize payment.
 * 
 * @returns Transaction reference and Airtel transaction ID
 */
export async function initiateCollection(
  request: AirtelCollectionRequest
): Promise<AirtelTransactionResponse> {
  const token = await getAuthToken()
  const msisdn = normalizeZambianPhone(request.phoneNumber)

  const payload = {
    reference: request.reference,
    subscriber: {
      country: AIRTEL_CONFIG.COUNTRY,
      currency: AIRTEL_CONFIG.CURRENCY,
      msisdn: msisdn,
    },
    transaction: {
      amount: request.amount,
      country: AIRTEL_CONFIG.COUNTRY,
      currency: AIRTEL_CONFIG.CURRENCY,
      id: request.reference,
    },
  }

  console.log(`[Airtel] Initiating collection: K${request.amount} from ${msisdn}, ref: ${request.reference}`)

  const response = await fetch(
    `${AIRTEL_CONFIG.BASE_URL}/merchant/v1/payments/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'X-Country': AIRTEL_CONFIG.COUNTRY,
        'X-Currency': AIRTEL_CONFIG.CURRENCY,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  )

  const data = await response.json()

  if (!response.ok || !data.status?.success) {
    console.error('[Airtel] Collection failed:', JSON.stringify(data))
    throw new AirtelMoneyError(
      data.status?.message || 'Collection payment failed',
      data.status?.response_code || 'COLLECTION_FAILED'
    )
  }

  console.log(`[Airtel] Collection initiated successfully: ${data.data?.transaction?.id}`)
  return data
}

// ─── Disbursement (Withdrawal) ───────────────────────────────

/**
 * Initiate a disbursement payment (platform → user).
 * Sends money directly to the user's Airtel Money wallet.
 */
export async function initiateDisbursement(
  request: AirtelDisbursementRequest
): Promise<AirtelTransactionResponse> {
  const token = await getAuthToken()
  const msisdn = normalizeZambianPhone(request.phoneNumber)

  const payload = {
    payee: {
      msisdn: msisdn,
      name: 'BetiPredict User',
    },
    reference: request.reference,
    pin: AIRTEL_CONFIG.DISBURSEMENT_PIN,
    transaction: {
      amount: request.amount,
      id: request.reference,
    },
  }

  console.log(`[Airtel] Initiating disbursement: K${request.amount} to ${msisdn}, ref: ${request.reference}`)

  const response = await fetch(
    `${AIRTEL_CONFIG.BASE_URL}/standard/v1/disbursements/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'X-Country': AIRTEL_CONFIG.COUNTRY,
        'X-Currency': AIRTEL_CONFIG.CURRENCY,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  )

  const data = await response.json()

  if (!response.ok || !data.status?.success) {
    console.error('[Airtel] Disbursement failed:', JSON.stringify(data))
    throw new AirtelMoneyError(
      data.status?.message || 'Disbursement payment failed',
      data.status?.response_code || 'DISBURSEMENT_FAILED'
    )
  }

  console.log(`[Airtel] Disbursement initiated successfully: ${data.data?.transaction?.id}`)
  return data
}

// ─── Transaction Status Enquiry ──────────────────────────────

/**
 * Check the status of a collection transaction.
 */
export async function checkCollectionStatus(transactionId: string): Promise<AirtelStatusResponse> {
  const token = await getAuthToken()

  const response = await fetch(
    `${AIRTEL_CONFIG.BASE_URL}/standard/v1/payments/${transactionId}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Country': AIRTEL_CONFIG.COUNTRY,
        'X-Currency': AIRTEL_CONFIG.CURRENCY,
        'Authorization': `Bearer ${token}`,
      },
    }
  )

  const data = await response.json()
  return data
}

/**
 * Check the status of a disbursement transaction.
 */
export async function checkDisbursementStatus(transactionId: string): Promise<AirtelStatusResponse> {
  const token = await getAuthToken()

  const response = await fetch(
    `${AIRTEL_CONFIG.BASE_URL}/standard/v1/disbursements/${transactionId}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Country': AIRTEL_CONFIG.COUNTRY,
        'X-Currency': AIRTEL_CONFIG.CURRENCY,
        'Authorization': `Bearer ${token}`,
      },
    }
  )

  const data = await response.json()
  return data
}

/**
 * Map Airtel transaction status codes to our internal status.
 * TS = Transaction Success
 * TF = Transaction Failed
 * TA = Transaction Ambiguous (retry or check later)
 * TIP = Transaction In Progress
 */
export function mapAirtelStatus(airtelStatus: string): PaymentStatus {
  switch (airtelStatus) {
    case 'TS': return 'COMPLETED'
    case 'TF': return 'FAILED'
    case 'TA': return 'PROCESSING'
    case 'TIP': return 'PROCESSING'
    default: return 'PENDING'
  }
}

// ─── Webhook Signature Verification ─────────────────────────

const WEBHOOK_SECRET = process.env.AIRTEL_MONEY_WEBHOOK_SECRET || ''

/**
 * Verify the HMAC-SHA256 signature of an Airtel Money webhook callback.
 * Compares the signature header against a computed hash of the raw body.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param rawBody - The raw request body as a string
 * @param signatureHeader - The signature from the request header (X-Signature or Authorization)
 * @returns true if signature is valid or verification is disabled (no secret configured)
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  // If no webhook secret is configured, skip verification (dev mode)
  if (!WEBHOOK_SECRET) {
    console.warn('[Airtel Webhook] No AIRTEL_MONEY_WEBHOOK_SECRET configured — skipping signature verification')
    return true
  }

  if (!signatureHeader) {
    console.error('[Airtel Webhook] Missing signature header')
    return false
  }

  try {
    const crypto = require('crypto')
    const expectedSignature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody, 'utf8')
      .digest('hex')

    // Support both raw hex and "sha256=hex" formats
    const receivedSig = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader

    // Timing-safe comparison
    const expected = Buffer.from(expectedSignature, 'hex')
    const received = Buffer.from(receivedSig, 'hex')

    if (expected.length !== received.length) {
      return false
    }

    return crypto.timingSafeEqual(expected, received)
  } catch (error) {
    console.error('[Airtel Webhook] Signature verification error:', error)
    return false
  }
}

// ─── Utility ─────────────────────────────────────────────────

/**
 * Generate a unique transaction reference.
 * Format: BP-{type}-{timestamp}-{random}
 */
export function generateTransactionRef(type: 'DEP' | 'WDR'): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `BP-${type}-${timestamp}-${random}`
}

/**
 * Check if Airtel Money is configured (credentials present).
 */
export function isAirtelMoneyConfigured(): boolean {
  return !!(AIRTEL_CONFIG.CLIENT_ID && AIRTEL_CONFIG.CLIENT_SECRET)
}
