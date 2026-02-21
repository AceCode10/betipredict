/**
 * MTN Mobile Money API Integration for Zambia
 * 
 * Handles:
 * - OAuth2 authentication (bearer token)
 * - Collection (deposit): request-to-pay from user's MoMo wallet
 * - Disbursement (withdrawal): transfer to user's MoMo wallet
 * - Transaction status enquiry
 * 
 * API Docs: https://momodeveloper.mtn.com/
 * 
 * Environment:
 *   Sandbox:    https://sandbox.momodeveloper.mtn.com
 *   Production: https://proxy.momoapi.mtn.com
 */

// ─── Configuration ───────────────────────────────────────────

const MTN_CONFIG = {
  get BASE_URL() {
    return process.env.MTN_MOMO_ENV === 'production'
      ? 'https://proxy.momoapi.mtn.com'
      : 'https://sandbox.momodeveloper.mtn.com'
  },
  get COLLECTION_SUBSCRIPTION_KEY() {
    return process.env.MTN_MOMO_COLLECTION_KEY || ''
  },
  get DISBURSEMENT_SUBSCRIPTION_KEY() {
    return process.env.MTN_MOMO_DISBURSEMENT_KEY || ''
  },
  get COLLECTION_API_USER() {
    return process.env.MTN_MOMO_COLLECTION_USER || ''
  },
  get COLLECTION_API_KEY() {
    return process.env.MTN_MOMO_COLLECTION_API_KEY || ''
  },
  get DISBURSEMENT_API_USER() {
    return process.env.MTN_MOMO_DISBURSEMENT_USER || ''
  },
  get DISBURSEMENT_API_KEY() {
    return process.env.MTN_MOMO_DISBURSEMENT_API_KEY || ''
  },
  CURRENCY: 'ZMW',
  get TARGET_ENVIRONMENT() {
    return process.env.MTN_MOMO_ENV === 'production' ? 'mtnzambia' : 'sandbox'
  },
  get CALLBACK_URL() {
    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    return `${base}/api/payments/callback`
  },
}

// ─── Types ───────────────────────────────────────────────────

export type MtnPaymentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface MtnCollectionRequest {
  phoneNumber: string
  amount: number
  reference: string
  payerMessage?: string
  payeeNote?: string
}

export interface MtnDisbursementRequest {
  phoneNumber: string
  amount: number
  reference: string
  payerMessage?: string
  payeeNote?: string
}

// ─── Custom Error Class ──────────────────────────────────────

export class MtnMoneyError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'MtnMoneyError'
    this.code = code
  }
}

// ─── Phone Number Helpers ────────────────────────────────────

/**
 * Normalize Zambian phone number for MTN.
 * MTN Zambia prefixes: 096X, 076X
 * Returns MSISDN format: 260XXXXXXXXX
 */
export function normalizeMtnZambianPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '')

  // Remove country code if present
  if (digits.startsWith('260') && digits.length >= 12) {
    digits = digits.slice(3)
  }

  // Remove leading zero
  if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.slice(1)
  }

  // Validate: 9 digits starting with 7 or 9 (MTN Zambia uses 96, 76)
  if (!/^[79]\d{8}$/.test(digits)) {
    throw new MtnMoneyError(
      'Invalid Zambian phone number. Must be an MTN Zambia number (e.g., 096XXXXXXX).',
      'INVALID_PHONE'
    )
  }

  return `260${digits}`
}

/**
 * Validate that the phone number belongs to MTN Zambia.
 * MTN Zambia prefixes: 096X, 076X
 */
export function isMtnZambiaNumber(phone: string): boolean {
  try {
    const normalized = normalizeMtnZambianPhone(phone)
    const subscriber = normalized.slice(3) // Remove 260
    return subscriber.startsWith('96') || subscriber.startsWith('76')
  } catch {
    return false
  }
}

// ─── Configuration Check ─────────────────────────────────────

export function isMtnMoneyConfigured(): boolean {
  return !!(
    MTN_CONFIG.COLLECTION_SUBSCRIPTION_KEY &&
    MTN_CONFIG.COLLECTION_API_USER &&
    MTN_CONFIG.COLLECTION_API_KEY
  )
}

// ─── Token Management ────────────────────────────────────────

let collectionToken: { token: string; expiresAt: number } | null = null
let disbursementToken: { token: string; expiresAt: number } | null = null

async function getToken(type: 'collection' | 'disbursement'): Promise<string> {
  const cached = type === 'collection' ? collectionToken : disbursementToken

  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token
  }

  const apiUser = type === 'collection' ? MTN_CONFIG.COLLECTION_API_USER : MTN_CONFIG.DISBURSEMENT_API_USER
  const apiKey = type === 'collection' ? MTN_CONFIG.COLLECTION_API_KEY : MTN_CONFIG.DISBURSEMENT_API_KEY
  const subscriptionKey = type === 'collection' ? MTN_CONFIG.COLLECTION_SUBSCRIPTION_KEY : MTN_CONFIG.DISBURSEMENT_SUBSCRIPTION_KEY

  if (!apiUser || !apiKey) {
    throw new MtnMoneyError(
      `MTN MoMo ${type} credentials not configured.`,
      'CONFIG_ERROR'
    )
  }

  const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString('base64')

  const response = await fetch(
    `${MTN_CONFIG.BASE_URL}/${type}/token/`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
    }
  )

  if (!response.ok) {
    const text = await response.text()
    console.error(`[MTN] ${type} auth failed:`, response.status, text)
    throw new MtnMoneyError(`Failed to authenticate with MTN MoMo (${type})`, 'AUTH_ERROR')
  }

  const data = await response.json()

  const tokenData = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  }

  if (type === 'collection') {
    collectionToken = tokenData
  } else {
    disbursementToken = tokenData
  }

  return tokenData.token
}

// ─── Collection (Deposit) ────────────────────────────────────

/**
 * Initiate a request-to-pay (user → platform).
 * Sends a payment prompt to the user's MTN MoMo wallet.
 */
export async function initiateCollection(
  request: MtnCollectionRequest
): Promise<{ referenceId: string }> {
  const token = await getToken('collection')
  const msisdn = normalizeMtnZambianPhone(request.phoneNumber)
  const referenceId = request.reference

  const payload = {
    amount: String(Math.round(request.amount)),
    currency: MTN_CONFIG.CURRENCY,
    externalId: request.reference,
    payer: {
      partyIdType: 'MSISDN',
      partyId: msisdn,
    },
    payerMessage: request.payerMessage || 'BetiPredict Deposit',
    payeeNote: request.payeeNote || `Deposit ref: ${request.reference}`,
  }

  console.log(`[MTN] Initiating collection: K${request.amount} from ${msisdn}, ref: ${referenceId}`)

  const response = await fetch(
    `${MTN_CONFIG.BASE_URL}/collection/v1_0/requesttopay`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': MTN_CONFIG.TARGET_ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': MTN_CONFIG.COLLECTION_SUBSCRIPTION_KEY,
        'X-Callback-Url': MTN_CONFIG.CALLBACK_URL,
      },
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    console.error('[MTN] Collection failed:', response.status, text)
    throw new MtnMoneyError(
      'Failed to initiate MTN MoMo payment. Please try again.',
      'COLLECTION_FAILED'
    )
  }

  console.log(`[MTN] Collection initiated successfully: ${referenceId}`)
  return { referenceId }
}

// ─── Disbursement (Withdrawal) ───────────────────────────────

/**
 * Initiate a transfer (platform → user).
 * Sends money directly to the user's MTN MoMo wallet.
 */
export async function initiateDisbursement(
  request: MtnDisbursementRequest
): Promise<{ referenceId: string }> {
  const token = await getToken('disbursement')
  const msisdn = normalizeMtnZambianPhone(request.phoneNumber)
  const referenceId = request.reference

  const payload = {
    amount: String(Math.round(request.amount)),
    currency: MTN_CONFIG.CURRENCY,
    externalId: request.reference,
    payee: {
      partyIdType: 'MSISDN',
      partyId: msisdn,
    },
    payerMessage: request.payerMessage || 'BetiPredict Withdrawal',
    payeeNote: request.payeeNote || `Withdrawal ref: ${request.reference}`,
  }

  console.log(`[MTN] Initiating disbursement: K${request.amount} to ${msisdn}, ref: ${referenceId}`)

  const response = await fetch(
    `${MTN_CONFIG.BASE_URL}/disbursement/v1_0/transfer`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': MTN_CONFIG.TARGET_ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': MTN_CONFIG.DISBURSEMENT_SUBSCRIPTION_KEY,
        'X-Callback-Url': MTN_CONFIG.CALLBACK_URL,
      },
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    console.error('[MTN] Disbursement failed:', response.status, text)
    throw new MtnMoneyError(
      'Failed to initiate MTN MoMo withdrawal. Please try again.',
      'DISBURSEMENT_FAILED'
    )
  }

  console.log(`[MTN] Disbursement initiated successfully: ${referenceId}`)
  return { referenceId }
}

// ─── Transaction Status Enquiry ──────────────────────────────

/**
 * Check the status of a collection (request-to-pay) transaction.
 */
export async function checkCollectionStatus(referenceId: string): Promise<{
  status: string
  financialTransactionId?: string
  reason?: { code: string; message: string }
}> {
  const token = await getToken('collection')

  const response = await fetch(
    `${MTN_CONFIG.BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Target-Environment': MTN_CONFIG.TARGET_ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': MTN_CONFIG.COLLECTION_SUBSCRIPTION_KEY,
      },
    }
  )

  if (!response.ok) {
    throw new MtnMoneyError('Failed to check MTN payment status', 'STATUS_CHECK_FAILED')
  }

  return response.json()
}

/**
 * Check the status of a disbursement (transfer) transaction.
 */
export async function checkDisbursementStatus(referenceId: string): Promise<{
  status: string
  financialTransactionId?: string
  reason?: { code: string; message: string }
}> {
  const token = await getToken('disbursement')

  const response = await fetch(
    `${MTN_CONFIG.BASE_URL}/disbursement/v1_0/transfer/${referenceId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Target-Environment': MTN_CONFIG.TARGET_ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': MTN_CONFIG.DISBURSEMENT_SUBSCRIPTION_KEY,
      },
    }
  )

  if (!response.ok) {
    throw new MtnMoneyError('Failed to check MTN disbursement status', 'STATUS_CHECK_FAILED')
  }

  return response.json()
}

/**
 * Map MTN MoMo status to our internal status.
 * SUCCESSFUL = completed
 * FAILED = failed
 * PENDING = still processing
 */
export function mapMtnStatus(mtnStatus: string): MtnPaymentStatus {
  switch (mtnStatus?.toUpperCase()) {
    case 'SUCCESSFUL': return 'COMPLETED'
    case 'FAILED': return 'FAILED'
    case 'REJECTED': return 'FAILED'
    case 'TIMEOUT': return 'FAILED'
    case 'PENDING': return 'PROCESSING'
    default: return 'PENDING'
  }
}

// ─── Utility ─────────────────────────────────────────────────

/**
 * Generate a unique transaction reference for MTN.
 * Format: BP-{type}-{uuid}
 */
export function generateMtnTransactionRef(type: 'DEP' | 'WDR'): string {
  const crypto = require('crypto')
  return crypto.randomUUID()
}
