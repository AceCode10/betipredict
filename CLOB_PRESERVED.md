# CLOB (Central Limit Order Book) — Preserved for Future Re-enablement

This document maps all CLOB-related code that has been preserved in the codebase.
When BetiPredict gains sufficient traffic to justify CLOB-based price discovery,
use this guide to re-enable the order book system.

## Current State (Phase 1 — CPMM Default)

All new markets are created with `pricingEngine: 'CPMM'`. The CLOB code is **fully intact**
and functional — it is simply not invoked for new markets. The dual routing in the trade
handler (`handleCLOBTrade` vs `handleCPMMTrade`) remains operational.

---

## CLOB Code Locations

### 1. Order Book Engine
- **File:** `src/lib/clob.ts`
- **Contents:** `OrderBook` class with bid/ask matching, price-time priority, order placement,
  cancellation, serialization/deserialization, snapshots.
- **Status:** Fully preserved, no changes made.

### 2. Trade Route — CLOB Handler
- **File:** `src/app/api/trade/route.ts`
- **Function:** `handleCLOBTrade()` (lines ~199–577)
- **Contents:** Full CLOB trade execution — balance checks, order construction, matching via
  `book.placeOrder()`, fill processing, resting order management, seller credits, book
  serialization, price derivation.
- **Status:** Fully preserved. The routing logic at line ~179 checks `market.pricingEngine`:
  ```typescript
  const useCLOB = (market as any).pricingEngine === 'CLOB'
  if (useCLOB) {
    return handleCLOBTrade(...)
  } else {
    return handleCPMMTrade(...)
  }
  ```
  To re-enable: set `pricingEngine: 'CLOB'` on target markets.

### 3. Order Book API Endpoint
- **File:** `src/app/api/orderbook/route.ts`
- **Contents:** GET endpoint returning order book snapshots per market/outcome.
  Already handles the CPMM case gracefully (returns AMM prices instead of book data).
- **Status:** Fully preserved, no changes made.

### 4. Order Cancellation Endpoint
- **File:** `src/app/api/orders/cancel/route.ts`
- **Contents:** Cancel resting CLOB orders with balance/position refund.
- **Status:** Fully preserved, no changes made.

### 5. Market Resolution — CLOB Order Refunds
- **File:** `src/lib/market-resolution.ts`
- **Function:** `MarketResolver.resolveMarket()`
- **Contents:** On market resolution, refunds reserved funds for all resting CLOB orders
  (BUY orders get Kwacha back, SELL orders get shares back).
- **Status:** Fully preserved, no changes made.

### 6. Database Schema — CLOB Fields
- **File:** `prisma/schema.prisma`
- **Fields on `Market` model:**
  - `pricingEngine` — Now defaults to `"CPMM"` (was `"CLOB"`)
  - `bookYes` — Serialized OrderBook JSON for YES/HOME outcome
  - `bookNo` — Serialized OrderBook JSON for NO/AWAY outcome
  - `bookDraw` — Serialized OrderBook JSON for DRAW outcome (tri only)
- **Status:** All fields preserved. Schema change was only the default value.

### 7. Frontend CLOB UI Elements (Hidden, Not Deleted)
- **File:** `src/app/page.tsx`
- **State variables preserved:** `orderType`, `limitPrice`, `orderBookData`
- **What was changed:**
  - Default `orderType` changed from `'LIMIT'` to `'MARKET'`
  - Limit/Market toggle buttons removed from trading panel UI
  - Limit price input removed from trading panel UI
  - Trade body now hardcodes `type: 'MARKET'`
  - Button label changed from "Buy/Sell (Limit/Market)" to "Place Bet / Sell Shares"
- **To re-enable:** Restore the Limit/Market toggle, limit price input, and
  `orderType`/`limitPrice` in the trade body construction.

---

## Re-enablement Checklist (Phase 3 Transition)

1. **Schema:** Change `pricingEngine` default back to `"CLOB"` in `prisma/schema.prisma`
2. **Market creation routes:** Switch `getCPMMBinaryInit()`/`getCPMMTriInit()` calls back to
   `pricingEngine: 'CLOB', liquidity: 0` in all creation routes
3. **Frontend:** Restore Limit/Market toggle, limit price input, and CLOB-aware trade body
4. **Existing CPMM markets:** Can remain as-is — the dual routing in `trade/route.ts` will
   continue to handle them via `handleCPMMTrade`
5. **Testing:** Verify order book snapshots, limit order placement, resting orders, fills,
   cancellations, and market resolution refunds

---

## Files Modified in Phase 1 (CPMM Switch)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Default `pricingEngine` → `"CPMM"` |
| `src/lib/fees.ts` | Added CPMM pool config, init helpers, max bet cap |
| `src/app/api/trade/route.ts` | Added max bet cap to `handleCPMMTrade`, imported `getCPMMMaxBet` |
| `src/app/api/markets/route.ts` | `pricingEngine:'CLOB'` → `...getCPMMBinaryInit(0.5)` |
| `src/app/api/market-groups/route.ts` | Same as above |
| `src/app/api/suggestions/route.ts` | Same as above |
| `src/app/api/market-maker/route.ts` | Switched to `getCPMMTriInit`/`getCPMMBinaryInit` |
| `src/app/api/matches/live/route.ts` | `pricingEngine:'CLOB'` → `...getCPMMTriInit()` |
| `src/app/api/cron/sync-games/route.ts` | Same as above |
| `src/app/api/admin/sync-games/route.ts` | Same as above |
| `src/app/api/admin/pool-size/route.ts` | **NEW** — Admin endpoint for pool size adjustment |
| `src/app/page.tsx` | Removed CLOB UI (Limit/Market toggle, limit price input) |
