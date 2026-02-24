# BetiPredict — Payment Processes & Calculations

## Table of Contents
1. [Fee Structure](#fee-structure)
2. [Deposit Flow](#deposit-flow)
3. [Withdrawal Flow](#withdrawal-flow)
4. [Trading (Buy/Sell)](#trading-buysell)
5. [CPMM Pricing Model](#cpmm-pricing-model)
6. [Market Resolution & Payouts](#market-resolution--payouts)
7. [Market Creation](#market-creation)
8. [Platform Revenue Ledger](#platform-revenue-ledger)
9. [Test Mode](#test-mode)

---

## Fee Structure

| Fee Type | Rate | Details |
|----------|------|---------|
| **Trading Fee** | 2% | Deducted from trade amount on every buy/sell |
| **Withdrawal Fee** | 1.5% (min K5) | Deducted from withdrawal amount |
| **Market Creation Fee** | K50 flat | Charged when creating custom markets (not auto-synced sports) |
| **Resolution Fee** | 1% | Deducted from winning payouts at market finalization |
| **Deposit Fee** | 0% | No fee on deposits (encourages inflow) |

All fee calculations are in `src/lib/fees.ts`. Amounts are rounded to 2 decimal places (ngwee precision).

---

## Deposit Flow

### Real Money (Airtel Money / MTN MoMo)
**File**: `src/app/api/deposit/route.ts`

1. User selects provider (Airtel Money or MTN MoMo) and enters phone + amount
2. Validation: amount must be K1–K1,000,000; valid Zambian phone number required
3. A `MobilePayment` record is created with status `PENDING`
4. Provider API is called:
   - **Airtel**: `initiateCollection()` sends USSD prompt to user's phone
   - **MTN**: `initiateCollection()` sends payment request via MoMo API
5. Payment record updated to `PROCESSING`
6. Frontend polls `/api/payments/status` every 5 seconds (max 60 attempts = 5 minutes)
7. On success callback/status check:
   - User balance incremented by deposit amount
   - Transaction record created (type: `DEPOSIT`, status: `COMPLETED`)
   - Notification sent to user
8. On failure/timeout:
   - Payment marked `FAILED`
   - No balance change
   - User notified

### Calculation
```
Deposit K100:
  Fee:     K0.00 (no deposit fee)
  Credit:  K100.00 added to balance
```

### Test Mode
When `NEXT_PUBLIC_TEST_MODE=true`:
- Phone number not required
- Balance credited instantly (no mobile money API call)
- Transaction recorded with `metadata: { testMode: true }`

---

## Withdrawal Flow

### Real Money (Airtel Money / MTN MoMo)
**File**: `src/app/api/withdraw/route.ts`

1. User selects provider, enters phone + amount
2. Validation:
   - Amount: K10–K500,000
   - Sufficient balance check (with floating-point epsilon guard)
   - Daily limit: K500,000 per 24 hours
   - Valid Zambian phone number
3. Fee calculated: `max(amount × 1.5%, K5)`
4. Balance **deducted immediately** (amount, not net) to prevent double-spend
5. `MobilePayment` record created with status `PENDING`
6. Provider disbursement API called
7. Payment updated to `PROCESSING`
8. Frontend polls status
9. On success:
   - Transaction updated to `COMPLETED`
   - Platform revenue entry created for the fee
   - User notified
10. On failure:
    - **Full amount refunded** to user balance (including fee)
    - Fee revenue entry **reversed** (negative entry)
    - User notified of refund

### Calculation
```
Withdraw K100:
  Fee:        K5.00 (max of K100 × 1.5% = K1.50 vs min K5)
  Net payout: K95.00 sent to mobile money
  Deducted:   K100.00 from balance

Withdraw K1,000:
  Fee:        K15.00 (K1,000 × 1.5%)
  Net payout: K985.00 sent to mobile money
  Deducted:   K1,000.00 from balance
```

### Test Mode
When `NEXT_PUBLIC_TEST_MODE=true`:
- Balance deducted instantly, fees still applied
- No mobile money API call
- Transaction recorded with `metadata: { testMode: true }`

---

## Trading (Buy/Sell)

**File**: `src/app/api/trade/route.ts`

### Buy Flow
1. User specifies: `marketId`, `outcome` (YES/NO), `amount` (Kwacha to spend)
2. Validation:
   - Market must be ACTIVE, resolve time not passed, linked game not finished
   - Min trade K1, max K100,000
   - User must have sufficient balance
3. Fee calculated: `amount × 2%`
4. Net amount after fee used for CPMM calculation
5. CPMM calculates shares received for net amount
6. Atomic transaction:
   - User balance decremented by gross amount
   - Position created/updated (outcome, shares, average price)
   - Market pool state updated (yesShares, noShares, prices, liquidity)
   - Order record created
   - Transaction record created
   - Platform revenue entry for trade fee

### Calculation (Buy)
```
Buy YES for K100:
  Gross:       K100.00
  Fee (2%):    K2.00
  Net to pool: K98.00
  
  If current YES price = 0.50 (50%):
    Pool: yesShares=5000, noShares=5000, k=25,000,000
    Shares received ≈ 192.2 YES shares
    New prices: YES ≈ 51.9%, NO ≈ 48.1%
    
  Avg price:   K98.00 / 192.2 = K0.5099 per share
  Max payout:  192.2 shares × K1.00 = K192.20 (if YES wins)
```

### Sell Flow
1. User specifies: `marketId`, `outcome`, `amount` (shares to sell)
2. Validation: user must hold enough shares in that outcome
3. CPMM calculates proceeds for selling shares (with 95% pool clamp to prevent exploits)
4. Fee calculated: `proceeds × 2%`
5. Atomic transaction:
   - User balance incremented by net proceeds
   - Position shares decremented (closed if 0)
   - Market pool state updated
   - Order and transaction records created
   - Platform revenue entry for trade fee

### Calculation (Sell)
```
Sell 100 YES shares (current YES price ≈ 0.60):
  Gross proceeds: ~K58.82 (from CPMM formula)
  Fee (2%):       K1.18
  Net to user:    K57.64
```

### CPMM Formula
```
Price(YES) = noShares / (yesShares + noShares)
Price(NO)  = yesShares / (yesShares + noShares)

Buy cost = shares - (oppositeShares_before - oppositeShares_after)
  where oppositeShares_after = k / (sameShares + shares_bought)

Sell proceeds = (oppositeShares_after - oppositeShares_before) - shares_sold
  where oppositeShares_after = k / (sameShares - shares_sold)
  Clamped: max shares sellable = 95% of same-side pool
```

---

## CPMM Pricing Model

**File**: `src/lib/cpmm.ts`

### How It Works
- Constant Product: `yesShares × noShares = k` (invariant)
- Initial pool: seeded at 50/50 with K10,000 liquidity for auto-synced sports markets, K1,000 for custom markets
- Prices move with each trade
- The AMM (Automated Market Maker) always provides liquidity — users can always trade

### Price Discovery
- All markets start at 50/50 — this means "no information yet"
- As users trade, prices move to reflect collective belief
- Large trades move the price more (price impact)
- The first few trades have the largest price impact

### Why 50/50 Starting Price Is Correct
Unlike Polymarket (which uses a CLOB where first traders set the price), CPMM markets **must** start with a defined price. 50/50 is the neutral prior. Some prediction markets (Manifold) do seed from external odds data — this is a future enhancement for BetiPredict.

---

## Market Resolution & Payouts

**File**: `src/lib/market-resolution.ts`

### Resolution Flow (Sports Markets)
1. **Cron job** (`/api/cron/resolve-adaptive`) checks football-data.org for finished matches
2. Match result determines outcome:
   - HOME_TEAM wins → Market resolves YES
   - AWAY_TEAM wins → Market resolves NO
   - DRAW → Market **VOIDED** (all traders refunded their cost basis)
3. Market status set to `RESOLVED`, dispute deadline set to now + 2 hours
4. All position holders notified

### Dispute Window (2 hours)
- After resolution, users can dispute the outcome
- If no disputes after 2 hours, market can be finalized
- Admin can "Early Finalize" to skip the window (if no open disputes)

### Finalization & Payouts
1. Market status set to `FINALIZING` (lock to prevent double-finalize)
2. For each position holder:
   - **Winners** (holding the winning outcome): `payout = shares × K1.00`
   - **Resolution fee** deducted: `fee = payout × 1%`
   - **Net payout** credited to balance
   - Position marked with `realizedPnl = netPayout - costBasis`
3. **Losers**: position marked closed, `realizedPnl = -costBasis`
4. Market status set to `FINALIZED`

### Payout Calculation
```
User holds 200 YES shares (avg price K0.40, cost basis K80)
Market resolves YES:
  Gross payout: 200 × K1.00 = K200.00
  Resolution fee (1%): K2.00
  Net payout: K198.00
  Realized PnL: K198.00 - K80.00 = +K118.00 (147.5% return)

User holds 100 NO shares (avg price K0.60, cost basis K60)
Market resolves YES:
  Payout: K0.00 (losing side)
  Realized PnL: -K60.00 (-100% loss)
```

### VOID Resolution (Draw)
```
User holds 150 YES shares (avg price K0.45)
Match ends in DRAW → Market VOIDED:
  Refund: 150 × K0.45 = K67.50
  All positions closed, all traders refunded their cost basis
```

---

## Market Creation

**File**: `src/app/api/markets/route.ts` (POST)

### Auto-Synced Sports Markets
- Created by cron job (`/api/cron/sync-games`)
- No creation fee (system-created)
- Initial liquidity: K10,000
- Pool seeded at 50/50

### Custom User Markets
- User pays K50 flat creation fee
- Fee deducted atomically with market creation
- Initial liquidity: K1,000 (platform-provided)
- Pool seeded at 50/50
- Revenue entry created for creation fee

---

## Platform Revenue Ledger

**Table**: `PlatformRevenue`

All fees are tracked in a dedicated ledger table:

| Fee Type | Source | Trigger |
|----------|--------|---------|
| `TRADE_FEE` | Buy/sell trades | Every trade execution |
| `WITHDRAWAL_FEE` | Withdrawals | Successful withdrawal |
| `WITHDRAWAL_FEE_REVERSAL` | Failed withdrawals | Negative entry to reverse fee |
| `MARKET_CREATION_FEE` | Custom market creation | When user creates market |
| `RESOLUTION_FEE` | Market finalization | Deducted from winning payouts |

Each entry records: amount, fee type, description, source type/ID, user ID, timestamp.

Admin dashboard shows aggregate revenue by type and totals.

---

## Test Mode

**Environment Variable**: `NEXT_PUBLIC_TEST_MODE=true`

When enabled:
- **Deposits**: Instantly credit balance (no mobile money API calls)
- **Withdrawals**: Instantly deduct balance with fees (no mobile money API calls)
- **Trading**: Works normally (CPMM, fees, positions)
- **Resolution**: Works normally (cron jobs, dispute window, payouts)
- **UI**: Yellow "Test Mode" banner shown in deposit/withdraw modals
- **Records**: All test transactions tagged with `metadata: { testMode: true }`

To switch to real money:
1. Set `NEXT_PUBLIC_TEST_MODE=false` (or remove the variable)
2. Configure Airtel Money credentials (`AIRTEL_*` env vars)
3. Configure MTN MoMo credentials (`MTN_*` env vars)
4. Redeploy

**Important**: The real payment infrastructure (Airtel Money, MTN MoMo) is fully implemented and ready. Test mode simply bypasses the API calls while keeping all business logic (fees, limits, transactions, notifications) intact.

---

*Last updated: February 2026*
