# CLOB & Calculations Audit Checklist

## 1. CLOB Engine (`src/lib/clob.ts`)
- [x] **Price range validation**: LIMIT orders validated 0.01–0.99 (line 93)
- [x] **Price rounding**: Rounded to nearest ngwee before matching (line 97)
- [x] **BUY matching**: Sweeps asks lowest-first, fills at maker price (line 103-133)
- [x] **SELL matching**: Sweeps bids highest-first, fills at maker price (line 134-163)
- [x] **Price-time priority**: Bids sorted DESC price/ASC time, Asks sorted ASC price/ASC time
- [x] **Fill accounting**: totalCost = sum(fill.price * fill.size), avgPrice = totalCost/totalFilled (line 181-182)
- [x] **Resting orders**: Only LIMIT unfilled portions rest on book (line 172)
- [x] **Epsilon tolerance**: 0.0001 threshold for "fully filled" check (line 128, 157)
- [x] **Serialize/Deserialize**: Correctly saves bids, asks, lastTradePrice (lines 291-308)
- [x] **Cancel**: Properly removes from both bids and asks arrays (lines 190-202)
- [x] **Snapshot aggregation**: Groups by price level correctly (lines 208-220)
- [x] **MidPrice fallback**: bid+ask/2 → single side → lastTradePrice (lines 245-252)

## 2. Trade API — CLOB Path (`src/app/api/trade/route.ts`)
- [x] **Outcome validation**: TRI_OUTCOME requires HOME/DRAW/AWAY, BINARY requires YES/NO (lines 169-174)
- [x] **BUY balance check**: Reserves maxCost * (1 + 2% fee) upfront (line 233)
- [x] **BUY LIMIT**: amount = shares, maxCost = shares * limitPrice (lines 223-225)
- [x] **BUY MARKET**: amount = Kwacha to spend, estimates shares from bestAsk (lines 262-275)
- [x] **SELL share check**: Pre-checks position.size >= shares (lines 243-251)
- [x] **Fee on BUY**: calculateTradeFee(grossSpend) where grossSpend = filledCost + restingCost (lines 330-334)
- [x] **Fee on SELL**: calculateTradeFee(grossProceeds) (line 437)
- [x] **Buyer position update**: Weighted average price calculation correct (line 381)
- [x] **Seller fill credits**: Net of fee credited to maker (lines 396-401)
- [x] **Resting SELL locks shares**: Deducts from position (lines 493-503)
- [x] **Book persistence**: All outcome books serialized after trade (line 544)
- [x] **Price derivation**: Uses lastTradePrice ?? midPrice for each outcome (lines 51-82)
- [x] **Volume increment**: Only increments by actual cost, not estimated (line 546)
- [x] **Market BUY overspend** — Low risk: balance pre-checked with full amount + fee buffer. Estimation may undershoot but never overshoot the reserved amount.
- [x] **FIXED: SELL fill double-debit** — Removed balance decrement for BUY makers in SELL fills. Their balance was already reserved at order placement.

## 3. Trade API — CPMM Path (Legacy)
- [x] **BUY fee**: Fee deducted from amount, net goes to pool (line 598-599)
- [x] **SELL fee**: Fee deducted from gross proceeds (line 774)
- [x] **Pool state**: Correctly reads/initializes pool from DB fields (lines 611-616, 621-626)
- [x] **Price clamping**: All prices clamped to 0.01–0.99 (lines 691-693, 700-701)
- [x] **TRI pool fields**: homeShares/drawShares/awayShares/k correctly mapped

## 4. Order Cancel (`src/app/api/orders/cancel/route.ts`)
- [x] **Auth check**: Verifies order.userId === session.user.id (line 34)
- [x] **Status check**: Only OPEN or PARTIALLY_FILLED cancellable (line 38)
- [x] **BUY refund**: remaining * price * 1.02 (matches the 2% fee reservation) (line 87-88)
- [x] **SELL refund**: Returns shares to position (lines 109-121)
- [x] **Book removal**: Finds by userId + price + side matching (lines 66-74)
- [x] **Book persistence**: Updated book saved to DB (lines 139-142)
- [x] **FIXED**: Now uses imported FEES.TRADE_FEE_RATE instead of hardcoded 0.02

## 5. Market Resolution (`src/lib/market-resolution.ts`)
- [x] **Resolve phase**: Sets RESOLVED status, cancels open orders, opens dispute window (lines 33-48)
- [x] **BUY order refund**: remaining * price * 1.02 (matches cancel logic) (line 55)
- [x] **SELL order refund**: Returns shares to position (lines 73-88)
- [x] **Finalization lock**: Atomic updateMany with WHERE status=RESOLVED (lines 132-140)
- [x] **Winning payout**: size * 1.0 = gross, minus 1% resolution fee (lines 183-184)
- [x] **Losing positions**: Closed with realizedPnl = -costBasis (lines 221-230)
- [x] **Void market**: Refunds cost basis (size * averagePrice) to all (lines 323-327)
- [x] **Auto-resolve**: Correctly maps HOME_TEAM/AWAY_TEAM/DRAW to outcomes (lines 418-432)
- [x] **Lock rollback**: FINALIZING → RESOLVED on crash (lines 243-246)
- [x] **FIXED**: Now uses imported FEES.TRADE_FEE_RATE instead of hardcoded 1.02

## 6. Fee System (`src/lib/fees.ts`)
- [x] **Trade fee**: 2% rate, roundToNgwee applied
- [x] **Withdrawal fee**: 1.5% rate, min K5
- [x] **Resolution fee**: 1% rate
- [x] **Rounding**: All fees rounded to nearest ngwee (2 decimal places)

## 7. Currency Display (`src/utils/currency.ts`)
- [x] **formatZambianCurrency**: K prefix for amounts >= 1, ngwee for < 1
- [x] **formatPriceAsNgwee**: Correctly rounds price * 100 to integer ngwee
- [x] **roundToNgwee**: Math.round(amount * 100) / 100

## 8. Price Display Consistency (Frontend)
- [x] **Main page**: yesPrice=Home, noPrice=Away, drawPrice=Draw (line 349-352 in page.tsx)
- [x] **SSE updates**: Now includes drawPrice in stream and onPriceUpdate handler
- [x] **Market cards**: Displays prices as Math.round(price * 100) + "%" 
- [x] **Trade panel**: Uses formatPriceAsNgwee for button labels

## 9. Market Status Flow
- [x] **Sync creates**: PENDING_APPROVAL (cron, admin, market-maker sync, live matches)
- [x] **MM approves**: PENDING_APPROVAL → ACTIVE (with custom prices)
- [x] **Main feed**: Only shows ACTIVE markets
- [x] **SSE stream**: Only streams ACTIVE markets
- [x] **Trading**: Only ACTIVE markets tradeable
- [x] **Resolution**: ACTIVE → RESOLVED → FINALIZING → FINALIZED

## BUGS FOUND — ALL FIXED ✅
1. ~~Cancel route hardcoded fee~~ → Now uses `FEES.TRADE_FEE_RATE`
2. ~~Resolution refund hardcoded fee~~ → Now uses `FEES.TRADE_FEE_RATE`
3. ~~CLOB SELL fills double-debit buyer~~ → Removed balance debit for resting BUY makers (already reserved at placement)
