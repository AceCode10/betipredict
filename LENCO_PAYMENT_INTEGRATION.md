# Lenco by Broadpay — Payment Integration Guide for BetiPredict

## Overview

Lenco by Broadpay is a Zambian business banking and payment gateway that supports:
- **MTN Mobile Money Zambia**
- **Airtel Money Zambia**
- **Zamkwacha**
- **Visa & Mastercard** card payments

This replaces the need for separate Airtel Money and MTN MoMo API integrations with a **single unified gateway** that handles all payment methods through one API.

## Why Lenco Instead of Direct Airtel/MTN Integration

| Factor | Direct Airtel + MTN | Lenco by Broadpay |
|--------|-------------------|-------------------|
| Integration effort | 2 separate APIs, different auth flows, different callback formats | 1 unified API |
| Card payments | Not supported | Built-in Visa/Mastercard |
| KYC/Compliance | You handle everything | Lenco handles merchant KYC |
| Settlement | Separate for each provider | Unified settlement to your Lenco account |
| Sandbox testing | Complex setup per provider | Single sandbox environment |
| Maintenance | 2 API versions to track | 1 API to maintain |

## Prerequisites

1. **Lenco Business Account**: Sign up at https://lenco.co/zm
2. **Business verification**: Complete KYC (business registration, director ID, etc.)
3. **API Keys**: Generated from the LencoPay/Collections section in the Lenco dashboard
   - **Public Key**: Used client-side in the payment widget
   - **Secret Key**: Used server-side for verification and API calls
4. **Webhook URL**: Your publicly accessible endpoint for payment notifications

To get API keys: Log in → LencoPay/Collections → Generate API Keys.
For support: [email protected] or [email protected]

---

## Architecture: How It Fits Into BetiPredict

### Current Architecture (Airtel + MTN direct)
```
User → DepositModal → /api/deposit → airtel-money.ts OR mtn-money.ts → Provider API
                                          ↓
                              /api/payments/callback ← Provider webhook
                              /api/payments/status  ← Frontend polling
                                          ↓
                              payment-settlement.ts → Credit balance
```

### New Architecture (Lenco unified)
```
User → DepositModal → TWO OPTIONS:

  OPTION A: Popup Widget (Card + Mobile Money)
  ─────────────────────────────────────────────
  User → LencoPay.getPaid() popup → Lenco handles UI → onSuccess callback
       → /api/payments/lenco/verify → Verify with Lenco API → Credit balance
       ← /api/webhooks/lenco ← Lenco webhook (authoritative)

  OPTION B: Server-Side API (Mobile Money only)
  ──────────────────────────────────────────────
  User → /api/deposit → lenco.ts → POST /collections/mobile-money → User approves on phone
       → /api/payments/status → GET /collections/status/:ref → Poll until complete
       ← /api/webhooks/lenco ← Lenco webhook (authoritative)

  WITHDRAWALS (Disbursements):
  ────────────────────────────
  User → /api/withdraw → lenco.ts → Lenco transfer/disbursement API → Sent to user's wallet
       ← /api/webhooks/lenco ← Lenco webhook confirms delivery
```

**Recommendation**: Use **Option A (Popup Widget)** for deposits — it handles all UI, payment method selection, OTP flows, and card 3D Secure automatically. Use **Option B** only if you need a fully custom UI.

---

## Step-by-Step Integration Plan

### Phase 1: Environment Setup

#### Step 1.1: Add Environment Variables
```env
# .env.local
LENCO_PUBLIC_KEY=pk_live_xxxxxxxxxxxx     # From Lenco dashboard
LENCO_SECRET_KEY=sk_live_xxxxxxxxxxxx     # From Lenco dashboard — NEVER expose client-side
LENCO_WEBHOOK_URL=https://yourdomain.com/api/webhooks/lenco
LENCO_ENVIRONMENT=live                     # 'sandbox' for testing

# Sandbox keys (for development)
LENCO_SANDBOX_PUBLIC_KEY=pk_test_xxxxxxxxxxxx
LENCO_SANDBOX_SECRET_KEY=sk_test_xxxxxxxxxxxx
```

#### Step 1.2: Add Public Key to Next.js Config
```env
# Only the public key is exposed to the client
NEXT_PUBLIC_LENCO_PUBLIC_KEY=pk_live_xxxxxxxxxxxx
NEXT_PUBLIC_LENCO_ENVIRONMENT=live
```

---

### Phase 2: Create Lenco Payment Library

#### Step 2.1: Create `src/lib/lenco.ts`

```typescript
/**
 * Lenco by Broadpay — Payment Integration Library
 * 
 * Handles:
 * - Mobile money collections (deposits)
 * - Payment verification
 * - Webhook signature verification
 * - Future: Disbursements (withdrawals)
 * 
 * API Docs: https://lenco-api.readme.io/v2.0/reference/accept-payments
 */

import crypto from 'crypto'

// ─── Configuration ───────────────────────────────────────────

const LENCO_CONFIG = {
  SECRET_KEY: process.env.LENCO_SECRET_KEY || '',
  PUBLIC_KEY: process.env.NEXT_PUBLIC_LENCO_PUBLIC_KEY || '',
  BASE_URL: process.env.LENCO_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox.lenco.co/access/v2'
    : 'https://api.lenco.co/access/v2',
  CURRENCY: 'ZMW',
}

export class LencoError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'LencoError'
  }
}

export function isLencoConfigured(): boolean {
  return !!LENCO_CONFIG.SECRET_KEY && !!LENCO_CONFIG.PUBLIC_KEY
}

// ─── API Helpers ─────────────────────────────────────────────

async function lencoRequest(endpoint: string, method: string, body?: any) {
  const url = `${LENCO_CONFIG.BASE_URL}${endpoint}`
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LENCO_CONFIG.SECRET_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const data = await response.json()
  if (!response.ok || data.status === false) {
    throw new LencoError(
      data.message || 'Lenco API request failed',
      data.errorCode || 'API_ERROR'
    )
  }
  return data
}

// ─── Collections (Deposits) ──────────────────────────────────

export interface LencoCollectionRequest {
  amount: number
  phoneNumber: string
  reference: string
  operator?: 'mtn' | 'airtel' | 'zamtel'
}

export interface LencoCollectionResponse {
  status: boolean
  message: string
  data: {
    id: string
    initiatedAt: string
    amount: string
    fee: string | null
    bearer: 'merchant' | 'customer'
    currency: string
    reference: string
    lencoReference: string
    type: 'mobile-money'
    status: 'pending' | 'successful' | 'failed' | 'pay-offline' | 'otp-required'
    mobileMoneyDetails: {
      country: string
      phone: string
      operator: string
      accountName: string | null
    } | null
  }
}

/**
 * Initiate a mobile money collection (deposit).
 * Customer receives a prompt on their phone to authorize payment.
 * Status will be 'pay-offline' — customer must approve on their phone.
 */
export async function initiateCollection(
  request: LencoCollectionRequest
): Promise<LencoCollectionResponse> {
  const data = await lencoRequest('/collections/mobile-money', 'POST', {
    amount: request.amount,
    currency: LENCO_CONFIG.CURRENCY,
    phone: request.phoneNumber,
    reference: request.reference,
  })

  console.log(`[Lenco] Collection initiated: K${request.amount} from ${request.phoneNumber}, ref: ${request.reference}`)
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
    status: 'pending' | 'successful' | 'failed' | 'pay-offline'
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
 * Use this after the popup widget onSuccess callback or to poll mobile money status.
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
  if (!LENCO_CONFIG.SECRET_KEY) {
    console.error('[Lenco Webhook] SECRET_KEY not configured')
    return false
  }

  if (!signatureHeader) {
    console.error('[Lenco Webhook] Missing X-Lenco-Signature header')
    return false
  }

  const webhookHashKey = crypto
    .createHash('sha256')
    .update(LENCO_CONFIG.SECRET_KEY)
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

// ─── Reference Generator ─────────────────────────────────────

export function generateLencoRef(type: 'DEP' | 'WDR'): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `BP-${type}-${timestamp}-${random}`
}
```

---

### Phase 3: Deposit Flow — Popup Widget (Recommended)

#### Step 3.1: Create Payment Initialization API

Create `src/app/api/payments/lenco/initialize/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FEES } from '@/lib/fees'
import { generateLencoRef, isLencoConfigured } from '@/lib/lenco'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isLencoConfigured()) {
    return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 })
  }

  const { amount } = await request.json()
  if (!amount || amount < FEES.DEPOSIT_MIN_AMOUNT || amount > FEES.DEPOSIT_MAX_AMOUNT) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  const reference = generateLencoRef('DEP')

  // Pre-create a pending payment record
  const payment = await prisma.mobilePayment.create({
    data: {
      type: 'DEPOSIT',
      amount,
      feeAmount: 0,
      netAmount: amount,
      phoneNumber: 'via-widget', // Will be populated by webhook
      provider: 'LENCO',
      externalRef: reference,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min for card payments
      userId: session.user.id,
    }
  })

  // Return the reference + public key for the frontend widget
  return NextResponse.json({
    reference,
    paymentId: payment.id,
    publicKey: process.env.NEXT_PUBLIC_LENCO_PUBLIC_KEY,
    amount,
    currency: 'ZMW',
    email: session.user.email,
  })
}
```

#### Step 3.2: Create Payment Verification API

Create `src/app/api/payments/lenco/verify/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyPayment, mapLencoStatus } from '@/lib/lenco'
import { settleDepositCompleted, settleDepositFailed } from '@/lib/payment-settlement'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const reference = request.nextUrl.searchParams.get('reference')
  if (!reference) {
    return NextResponse.json({ error: 'Reference required' }, { status: 400 })
  }

  // Find the payment
  const payment = await prisma.mobilePayment.findFirst({
    where: { externalRef: reference, userId: session.user.id }
  })
  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
  }

  // Verify with Lenco API
  const lencoData = await verifyPayment(reference)
  const newStatus = mapLencoStatus(lencoData.data.status)

  // Update payment record
  await prisma.mobilePayment.update({
    where: { id: payment.id },
    data: {
      status: newStatus,
      statusMessage: lencoData.data.reasonForFailure || lencoData.message,
      completedAt: newStatus === 'COMPLETED' ? new Date() : null,
      phoneNumber: lencoData.data.mobileMoneyDetails?.phone || 
                   lencoData.data.cardDetails ? `card-${lencoData.data.cardDetails.last4}` : 
                   payment.phoneNumber,
    }
  })

  // Settle if completed (settlement module handles idempotency)
  if (newStatus === 'COMPLETED') {
    await settleDepositCompleted(payment.id)
  } else if (newStatus === 'FAILED') {
    await settleDepositFailed(payment.id, lencoData.data.reasonForFailure || undefined)
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { balance: true }
  })

  return NextResponse.json({
    status: newStatus,
    amount: payment.amount,
    newBalance: user?.balance || 0,
    paymentType: lencoData.data.type,
    message: newStatus === 'COMPLETED' 
      ? `K${payment.amount.toFixed(2)} deposited successfully`
      : lencoData.data.reasonForFailure || 'Payment processing...',
  })
}
```

#### Step 3.3: Create Lenco Webhook Handler

Create `src/app/api/webhooks/lenco/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature, mapLencoStatus } from '@/lib/lenco'
import {
  settleDepositCompleted,
  settleDepositFailed,
  settleWithdrawalCompleted,
  settleWithdrawalFailed,
} from '@/lib/payment-settlement'

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-lenco-signature')

    // Verify webhook authenticity
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[Lenco Webhook] Invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(rawBody)
    console.log('[Lenco Webhook] Event:', event.event, JSON.stringify(event.data?.reference || event.data?.id))

    // Handle collection events
    if (event.event === 'collection.successful') {
      const reference = event.data?.reference
      if (!reference) return NextResponse.json({ status: 'ok' })

      const payment = await prisma.mobilePayment.findFirst({
        where: { externalRef: reference, settledAt: null }
      })
      if (!payment) return NextResponse.json({ status: 'ok' })

      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          callbackReceived: true,
          callbackData: rawBody,
          phoneNumber: event.data?.mobileMoneyDetails?.phone || payment.phoneNumber,
        }
      })

      if (payment.type === 'DEPOSIT') {
        await settleDepositCompleted(payment.id)
      }
    }

    // Handle transaction events (for disbursements/withdrawals)
    if (event.event === 'transaction.successful' && event.data?.type === 'debit') {
      const clientRef = event.data?.clientReference
      if (!clientRef) return NextResponse.json({ status: 'ok' })

      const payment = await prisma.mobilePayment.findFirst({
        where: { externalRef: clientRef, settledAt: null }
      })
      if (!payment) return NextResponse.json({ status: 'ok' })

      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          callbackReceived: true,
          callbackData: rawBody,
        }
      })

      if (payment.type === 'WITHDRAWAL') {
        await settleWithdrawalCompleted(payment.id)
      }
    }

    if (event.event === 'transaction.failed' && event.data?.type === 'debit') {
      const clientRef = event.data?.clientReference
      if (!clientRef) return NextResponse.json({ status: 'ok' })

      const payment = await prisma.mobilePayment.findFirst({
        where: { externalRef: clientRef, settledAt: null }
      })
      if (!payment) return NextResponse.json({ status: 'ok' })

      await prisma.mobilePayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          callbackReceived: true,
          callbackData: rawBody,
          statusMessage: event.data?.reasonForFailure || 'Transaction failed',
        }
      })

      if (payment.type === 'WITHDRAWAL') {
        await settleWithdrawalFailed(payment.id, event.data?.reasonForFailure)
      }
    }

    // Always respond 200 to acknowledge receipt
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[Lenco Webhook] Error:', error)
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }
}
```

#### Step 3.4: Update DepositModal Frontend

The key change is adding the Lenco popup widget. Add the script in your layout or dynamically:

```typescript
// In DepositModal.tsx — new Lenco deposit flow

const handleLencoDeposit = async () => {
  setIsProcessing(true)
  try {
    // Step 1: Initialize payment on server
    const res = await fetch('/api/payments/lenco/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: depositAmount }),
    })
    const { reference, publicKey, email } = await res.json()
    if (!res.ok) throw new Error('Failed to initialize payment')

    // Step 2: Open Lenco popup widget
    // @ts-ignore — LencoPay is loaded from external script
    LencoPay.getPaid({
      key: publicKey,
      reference: reference,
      email: email,
      amount: depositAmount,
      currency: 'ZMW',
      channels: ['card', 'mobile-money'], // Both card and mobile money
      customer: {
        firstName: session?.user?.name?.split(' ')[0] || '',
        lastName: session?.user?.name?.split(' ').slice(1).join(' ') || '',
      },
      onSuccess: async (response: any) => {
        // Step 3: Verify payment on server
        const verifyRes = await fetch(
          `/api/payments/lenco/verify?reference=${response.reference}`
        )
        const data = await verifyRes.json()
        if (data.status === 'COMPLETED') {
          setStep('success')
          setSuccess(`K${depositAmount.toFixed(2)} deposited successfully!`)
          await onDeposit(depositAmount, '')
        }
      },
      onClose: () => {
        setIsProcessing(false)
      },
      onConfirmationPending: () => {
        setStep('processing')
        setStatusMessage('Payment is being confirmed...')
        // Start polling
        pollLencoStatus(reference)
      },
    })
  } catch (err: any) {
    setError(err.message)
  } finally {
    setIsProcessing(false)
  }
}
```

Add the Lenco script to your `src/app/layout.tsx`:
```html
<Script
  src={process.env.NEXT_PUBLIC_LENCO_ENVIRONMENT === 'sandbox'
    ? 'https://pay.sandbox.lenco.co/js/v1/inline.js'
    : 'https://pay.lenco.co/js/v1/inline.js'}
  strategy="lazyOnload"
/>
```

---

### Phase 4: Withdrawal Flow (Disbursements)

Lenco's disbursement works through their banking/transfer API. You transfer from your Lenco account to the user's mobile money wallet.

**Note**: Lenco's disbursement API uses their banking transfer endpoints. Contact [email protected] to confirm the exact disbursement endpoints available for your Zambian account, as the v2 API docs primarily cover Nigerian transfers. The webhook events (`transaction.successful`, `transaction.failed`) will still apply.

For withdrawals, your existing architecture remains largely the same — just swap the provider:

```typescript
// In the withdraw route, add a 'lenco' method case:
if (method === 'lenco' || method === 'mobile_money') {
  // Use Lenco's transfer/disbursement API
  const result = await lencoRequest('/transfers', 'POST', {
    amount: fee.netAmount,
    currency: 'ZMW',
    recipient: {
      phone: phoneNumber,
      type: 'mobile-money',
    },
    reference: externalRef,
    narration: `BetiPredict Withdrawal ${externalRef}`,
  })
  // Track disbursementId for webhook settlement
}
```

---

### Phase 5: Card Payments

Card payments are **automatically handled** by the Lenco popup widget when you include `'card'` in the `channels` array. No additional backend work needed — the widget handles:
- Card number entry
- 3D Secure authentication
- OTP verification
- Error handling

The same verification endpoint (`/api/payments/lenco/verify`) works for both card and mobile money payments. The webhook will fire `collection.successful` with `type: "card"` and include `cardDetails` instead of `mobileMoneyDetails`.

---

## Migration Plan: From Direct Airtel/MTN to Lenco

### Phase 1 (Week 1): Setup & Testing
1. Sign up for Lenco by Broadpay business account
2. Complete KYC verification
3. Generate sandbox API keys
4. Create `src/lib/lenco.ts` library
5. Create webhook endpoint and test with sandbox
6. Test popup widget with sandbox test accounts

### Phase 2 (Week 2): Deposit Integration
1. Create `/api/payments/lenco/initialize` and `/api/payments/lenco/verify`
2. Update `DepositModal.tsx` to use Lenco popup widget
3. Keep existing Airtel/MTN as fallback during transition
4. Test deposits end-to-end with sandbox

### Phase 3 (Week 3): Withdrawal Integration
1. Confirm Lenco disbursement API availability for Zambia
2. Create Lenco withdrawal flow in `/api/withdraw`
3. Test withdrawals end-to-end
4. Update `WithdrawModal.tsx` provider options

### Phase 4 (Week 4): Go Live
1. Switch to live API keys
2. Set webhook URL to production endpoint
3. Monitor first 10 transactions closely
4. Remove old Airtel/MTN direct integration code (or keep as fallback)

---

## Lenco API Quick Reference

| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| **Accept Payment (Widget)** | Client-side JS | `LencoPay.getPaid({...})` | Public Key |
| **Mobile Money Collection** | POST | `/v2/collections/mobile-money` | Bearer Secret Key |
| **Verify Payment** | GET | `/v2/collections/status/:reference` | Bearer Secret Key |
| **Transfer (Disbursement)** | POST | `/v1/transfers` | Bearer Secret Key |
| **Get Transactions** | GET | `/v1/transactions` | Bearer Secret Key |

### Base URLs
- **Production**: `https://api.lenco.co/access`
- **Sandbox**: `https://sandbox.lenco.co/access`
- **Widget (Production)**: `https://pay.lenco.co/js/v1/inline.js`
- **Widget (Sandbox)**: `https://pay.sandbox.lenco.co/js/v1/inline.js`

### Webhook Events to Handle
| Event | When |
|-------|------|
| `collection.successful` | Mobile money or card payment completed |
| `transaction.successful` | Outgoing transfer (withdrawal) completed |
| `transaction.failed` | Outgoing transfer (withdrawal) failed |
| `account.balance-updated` | Your Lenco balance changed |

### Test Accounts (Sandbox)
See: https://lenco-api.readme.io/v2.0/reference/test-cards-and-accounts

### Fees
- **Mobile Money**: ~K0.25 per transaction (bearer: merchant or customer, configurable)
- **Card Payments**: ~2.5-3% of transaction value
- **Settlement**: Instant to your Lenco account

---

## Security Checklist

- [ ] Secret Key stored ONLY in `.env.local`, never in client-side code
- [ ] Webhook signature verification using HMAC SHA512 with SHA256-hashed secret
- [ ] All API calls from server-side only (Next.js API routes)
- [ ] Payment references generated server-side (not from client)
- [ ] Double-settlement prevention via `settledAt` atomic claims (existing pattern)
- [ ] Idempotency keys on deposit/withdrawal routes (existing pattern)
- [ ] Rate limiting on payment endpoints (existing pattern)

---

## Files to Create/Modify

### New Files
1. `src/lib/lenco.ts` — Lenco API library
2. `src/app/api/payments/lenco/initialize/route.ts` — Payment initialization
3. `src/app/api/payments/lenco/verify/route.ts` — Payment verification
4. `src/app/api/webhooks/lenco/route.ts` — Webhook handler

### Modified Files
1. `src/components/DepositModal.tsx` — Add Lenco popup widget option
2. `src/components/WithdrawModal.tsx` — Add Lenco as provider option
3. `src/app/layout.tsx` — Add Lenco widget script tag
4. `.env.local` — Add Lenco API keys
5. `src/app/api/deposit/route.ts` — Add `lenco` method case (if using server-side API)
6. `src/app/api/withdraw/route.ts` — Add Lenco disbursement case
