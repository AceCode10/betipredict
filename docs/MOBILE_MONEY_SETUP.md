# Mobile Money Integration Guide — Airtel Money & MTN MoMo (Zambia)

This guide walks you through fully configuring both Airtel Money and MTN Mobile Money for BetiPredict's deposit and withdrawal system.

---

## Part 1: Airtel Money Zambia

### Step 1 — Create a Developer Account

1. Go to **https://developers.airtel.africa/signup**
2. Fill in your business details:
   - Company name (must match your registered business)
   - Email address (use a business email)
   - Phone number
3. Verify your email and complete the registration.

### Step 2 — Register an Application

1. Log in to the Airtel Africa Developer Portal.
2. Navigate to **My Apps → Create New App**.
3. Fill in:
   - **App Name**: `BetiPredict`
   - **Description**: `Sports prediction market platform`
   - **Products**: Select both:
     - ✅ **Collection** (for receiving deposits from users)
     - ✅ **Disbursement** (for sending withdrawals to users)
   - **Country**: `Zambia`
   - **Currency**: `ZMW`
4. Submit the application. You'll receive:
   - `Client ID`
   - `Client Secret`

### Step 3 — Server IP & Callback URL

#### Server IP Configuration
When creating your Airtel app, you'll be asked for a **Server IP**:

- **Development**: Use ngrok to expose localhost:
  ```bash
  npx ngrok http 3000
  ```
  Use the IP that resolves from your ngrok URL

- **Production**: 
  - **Vercel/Serverless**: No static IP → Contact Airtel support with your domain
  - **AWS EC2**: Use your EC2 public IP
  - **DigitalOcean**: Use your Droplet public IP
  - **Other hosts**: Ask your provider for the server IP

#### Callback URL
1. In your app settings on the Airtel portal, set the **Callback URL** to:
   ```
   https://yourdomain.com/api/payments/callback
   ```
   For staging/testing, you can use an ngrok URL:
   ```
   https://your-ngrok-id.ngrok.io/api/payments/callback
   ```

### Step 4 — Get Your Disbursement PIN

1. Contact Airtel Africa developer support or your account manager.
2. Request the **encrypted disbursement PIN** for your merchant account.
3. This PIN is required for sending money (withdrawals) to users.

### Step 5 — Set Environment Variables

Add these to your `.env` or `.env.local`:

```env
AIRTEL_MONEY_CLIENT_ID=your_client_id_from_step_2
AIRTEL_MONEY_CLIENT_SECRET=your_client_secret_from_step_2
AIRTEL_MONEY_PIN=your_encrypted_disbursement_pin
AIRTEL_MONEY_WEBHOOK_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
AIRTEL_MONEY_ENV=staging
```

### Step 6 — Test in Staging

1. Keep `AIRTEL_MONEY_ENV=staging` — this uses `https://openapiuat.airtel.africa`.
2. Use Airtel test phone numbers provided in the developer portal.
3. Test a deposit (collection) and withdrawal (disbursement).
4. Verify callbacks are received at your `/api/payments/callback` endpoint.

### Step 7 — Go Live

1. Submit your app for **production approval** on the Airtel developer portal.
2. Airtel will review your integration (may take 3–10 business days).
3. Once approved, change your env:
   ```env
   AIRTEL_MONEY_ENV=production
   ```
4. Update your callback URL to your production domain.

### Airtel API Flow Summary

```
Deposit:
  1. User enters phone + amount → POST /api/deposit
  2. Server calls Airtel Collection API → USSD prompt sent to user's phone
  3. User enters PIN on phone → Airtel processes payment
  4. Airtel sends callback to /api/payments/callback → balance credited

Withdrawal:
  1. User enters phone + amount → POST /api/withdraw
  2. Server calls Airtel Disbursement API → money sent to user's wallet
  3. Airtel sends callback → withdrawal marked complete
```

---

## Part 2: MTN Mobile Money (MoMo) Zambia

### Step 1 — Create a Developer Account

1. Go to **https://developers.mtn.com/getting-started**.
2. Create/sign in to your MTN developer account.
3. Confirm your profile and country access for MoMo products.

> Note: The docs UX is on `developers.mtn.com`, while API traffic for sandbox/production remains on MTN MoMo API hosts (`sandbox.momodeveloper.mtn.com` and `proxy.momoapi.mtn.com`).

### Step 2 — Subscribe to API Products

1. In **My Apps**, create/select your app.
2. Add/subscribe to these API products:
   - ✅ **Collection** — for receiving payments (deposits)
   - ✅ **Disbursement** — for sending payments (withdrawals)
3. Save each product's **Primary Key** (Subscription Key):
   - Collection key -> `MTN_MOMO_COLLECTION_KEY`
   - Disbursement key -> `MTN_MOMO_DISBURSEMENT_KEY`

### Step 3 — Create API Users (Sandbox)

For each product (Collection and Disbursement), create an API user and then generate an API key.

`providerCallbackHost` must be host-only (no scheme/path), e.g. `www.betipredict.com`.

#### 3a. Create Collection API User

```bash
# Generate a UUID for the API user
COLLECTION_USER_ID=$(uuidgen)
echo "Collection User ID: $COLLECTION_USER_ID"

# Create the API user
curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser" \
  -H "Content-Type: application/json" \
  -H "X-Reference-Id: $COLLECTION_USER_ID" \
  -H "Ocp-Apim-Subscription-Key: YOUR_COLLECTION_PRIMARY_KEY" \
  -d '{"providerCallbackHost": "www.betipredict.com"}'

# Generate the API key
curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/$COLLECTION_USER_ID/apikey" \
  -H "Ocp-Apim-Subscription-Key: YOUR_COLLECTION_PRIMARY_KEY"
```

PowerShell (Windows):
```powershell
$COLLECTION_USER_ID = [guid]::NewGuid().ToString()
Write-Host "Collection User ID: $COLLECTION_USER_ID"

curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser" `
  -H "Content-Type: application/json" `
  -H "X-Reference-Id: $COLLECTION_USER_ID" `
  -H "Ocp-Apim-Subscription-Key: YOUR_COLLECTION_PRIMARY_KEY" `
  -d '{"providerCallbackHost":"www.betipredict.com"}'

curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/$COLLECTION_USER_ID/apikey" `
  -H "Ocp-Apim-Subscription-Key: YOUR_COLLECTION_PRIMARY_KEY"
```

Save the response:
- `COLLECTION_USER_ID` → `MTN_MOMO_COLLECTION_USER`
- `apiKey` from response → `MTN_MOMO_COLLECTION_API_KEY`

#### 3b. Create Disbursement API User

```bash
DISBURSEMENT_USER_ID=$(uuidgen)
echo "Disbursement User ID: $DISBURSEMENT_USER_ID"

curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser" \
  -H "Content-Type: application/json" \
  -H "X-Reference-Id: $DISBURSEMENT_USER_ID" \
  -H "Ocp-Apim-Subscription-Key: YOUR_DISBURSEMENT_PRIMARY_KEY" \
  -d '{"providerCallbackHost": "www.betipredict.com"}'

curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/$DISBURSEMENT_USER_ID/apikey" \
  -H "Ocp-Apim-Subscription-Key: YOUR_DISBURSEMENT_PRIMARY_KEY"
```

PowerShell (Windows):
```powershell
$DISBURSEMENT_USER_ID = [guid]::NewGuid().ToString()
Write-Host "Disbursement User ID: $DISBURSEMENT_USER_ID"

curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser" `
  -H "Content-Type: application/json" `
  -H "X-Reference-Id: $DISBURSEMENT_USER_ID" `
  -H "Ocp-Apim-Subscription-Key: YOUR_DISBURSEMENT_PRIMARY_KEY" `
  -d '{"providerCallbackHost":"www.betipredict.com"}'

curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/$DISBURSEMENT_USER_ID/apikey" `
  -H "Ocp-Apim-Subscription-Key: YOUR_DISBURSEMENT_PRIMARY_KEY"
```

Save the response:
- `DISBURSEMENT_USER_ID` → `MTN_MOMO_DISBURSEMENT_USER`
- `apiKey` from response → `MTN_MOMO_DISBURSEMENT_API_KEY`

### Step 4 — Configure Callback URL

Set `providerCallbackHost` to your domain when creating the API user (Step 3).
The full callback URL used by BetiPredict is:
```
https://www.betipredict.com/api/payments/callback
```

This matches the app callback route in code and avoids apex->www redirect issues.

### Step 5 — Set Environment Variables

```env
NEXTAUTH_URL=https://www.betipredict.com
MTN_MOMO_COLLECTION_KEY=your_collection_subscription_key
MTN_MOMO_DISBURSEMENT_KEY=your_disbursement_subscription_key
MTN_MOMO_COLLECTION_USER=your_collection_api_user_uuid
MTN_MOMO_COLLECTION_API_KEY=your_collection_api_key
MTN_MOMO_DISBURSEMENT_USER=your_disbursement_api_user_uuid
MTN_MOMO_DISBURSEMENT_API_KEY=your_disbursement_api_key
MTN_MOMO_WEBHOOK_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
MTN_MOMO_ENV=sandbox
```

`MTN_MOMO_ENV` mapping in BetiPredict:
- `sandbox` -> `X-Target-Environment: sandbox`
- `production` -> `X-Target-Environment: mtnzambia`

### Step 6 — Test in Sandbox

1. Keep `MTN_MOMO_ENV=sandbox` — this uses `https://sandbox.momodeveloper.mtn.com`.
2. MTN sandbox provides test MSISDNs. Common test numbers:
   - `46733123450` — will succeed
   - `46733123451` — will fail (insufficient funds)
   - `46733123452` — will be pending indefinitely
3. Test deposits and withdrawals through the BetiPredict UI.
4. Check the Admin Dashboard → Payments tab to monitor payment statuses.

### Step 7 — Go Live (Production)

1. **Apply for production access** through the MTN MoMo Developer Portal.
2. You'll need to provide:
   - Business registration documents
   - KYC documentation
   - Technical integration documentation
   - Callback URL (production domain)
3. MTN will review and provision production credentials.
4. Once approved:
   - You'll receive new production Subscription Keys
   - Create new API Users against the production endpoint (`https://proxy.momoapi.mtn.com`)
   - Update all env variables with production values
   - Set `MTN_MOMO_ENV=production`
5. Re-test collection + disbursement end-to-end before enabling real users.

### MTN API Flow Summary

```
Deposit (Collection - Request to Pay):
  1. User enters phone + amount → POST /api/deposit
  2. Server calls MTN Collection API (requesttopay) → prompt sent to user
  3. User approves on their phone
  4. Server polls GET /collection/v1_0/requesttopay/{referenceId}
  5. Status = SUCCESSFUL → balance credited

Withdrawal (Disbursement - Transfer):
  1. User enters phone + amount → POST /api/withdraw
  2. Server calls MTN Disbursement API (transfer) → money sent
  3. Server polls GET /disbursement/v1_0/transfer/{referenceId}
  4. Status = SUCCESSFUL → withdrawal marked complete
```

---

## Part 3: Production Checklist

Before going live with either provider:

- [ ] **Business registration** — You need a registered Zambian business entity
- [ ] **KYC/AML compliance** — Both providers require Know Your Customer documentation
- [ ] **SSL certificate** — Your production domain must use HTTPS
- [ ] **Callback URL** — Must be publicly accessible (not localhost)
- [ ] **Webhook signature verification** — Both providers' callbacks are verified in `/api/payments/callback`
- [ ] **Idempotency** — The `settledAt` guard in `payment-settlement.ts` prevents double-settlement
- [ ] **Error handling** — Failed deposits show user-friendly messages; failed withdrawals auto-refund
- [ ] **Reconciliation** — The cron job at `/api/cron/reconcile` polls stuck payments every 5 minutes
- [ ] **Rate limiting** — Deposit/withdraw endpoints are rate-limited per user
- [ ] **Admin monitoring** — Use Admin Dashboard → Payments tab to monitor all transactions
- [ ] **Test thoroughly** — Run end-to-end tests in sandbox before switching to production

## Part 4: Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Payment provider not configured" | Missing env vars | Check all `AIRTEL_MONEY_*` or `MTN_MOMO_*` vars are set |
| Callback not received | Wrong callback URL | Ensure URL is publicly accessible, check ngrok for dev |
| "Invalid signature" on callback | Wrong webhook secret | Regenerate and update `*_WEBHOOK_SECRET` |
| Payment stuck in PROCESSING | User didn't confirm on phone | Cron reconciliation will expire after timeout |
| Disbursement fails | Insufficient merchant float | Top up your merchant account with the provider |
| "Token expired" errors | OAuth token cache stale | Tokens auto-refresh; check system clock sync |

## Part 5: Environment Variable Reference

| Variable | Provider | Purpose |
|----------|----------|---------|
| `AIRTEL_MONEY_CLIENT_ID` | Airtel | OAuth2 client ID |
| `AIRTEL_MONEY_CLIENT_SECRET` | Airtel | OAuth2 client secret |
| `AIRTEL_MONEY_PIN` | Airtel | Encrypted disbursement PIN |
| `AIRTEL_MONEY_WEBHOOK_SECRET` | Airtel | Callback signature verification |
| `AIRTEL_MONEY_ENV` | Airtel | `staging` or `production` |
| `MTN_MOMO_COLLECTION_KEY` | MTN | Collection subscription key |
| `MTN_MOMO_DISBURSEMENT_KEY` | MTN | Disbursement subscription key |
| `MTN_MOMO_COLLECTION_USER` | MTN | Collection API user UUID |
| `MTN_MOMO_COLLECTION_API_KEY` | MTN | Collection API key |
| `MTN_MOMO_DISBURSEMENT_USER` | MTN | Disbursement API user UUID |
| `MTN_MOMO_DISBURSEMENT_API_KEY` | MTN | Disbursement API key |
| `MTN_MOMO_WEBHOOK_SECRET` | MTN | Callback signature verification |
| `MTN_MOMO_ENV` | MTN | `sandbox` or `production` |
