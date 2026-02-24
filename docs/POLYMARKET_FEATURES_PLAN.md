# Polymarket Feature Gap Analysis & Implementation Plan

## How Polymarket Works (Research Summary)

### Pricing Model
- **Polymarket uses a CLOB (Central Limit Order Book)**, not an AMM/CPMM.
- Prices are NOT set by Polymarket — they emerge from supply and demand.
- Every share is priced between $0.00 and $1.00 (price = implied probability).
- The displayed price is the **midpoint** of the bid-ask spread.
- When a new market launches, there is **no initial price**. The first price emerges when a buy-Yes limit order and a buy-No limit order sum to $1.00 and get matched.

### BetiPredict's Approach (CPMM)
- BetiPredict uses a **Constant Product Market Maker (CPMM)**: `yesShares * noShares = k`.
- All markets start at 50/50 and prices move as users trade.
- This is a **valid and widely-used approach** (Augur v2, Manifold Markets, etc.).
- CPMM is simpler and provides guaranteed liquidity — users can always trade.
- The 50/50 starting price is correct for CPMM — it means "no information yet."
- Prices move away from 50/50 as soon as the first trade happens.

### Market Makers & Incentives
- On Polymarket, professional market makers place limit orders on both sides.
- They earn from the bid-ask spread and from the **Maker Rebates Program** (25% of taker fees redistributed daily).
- Taker fees are 0-1.56% depending on price (highest at 50%, lowest near extremes).
- BetiPredict's CPMM acts as an **automated market maker** — no human market makers needed. The platform itself provides liquidity via the constant-product formula.

### Draw Handling
- Polymarket creates **3 separate binary markets** per match: TeamA-wins, Draw, TeamB-wins.
- Each is an independent Yes/No market with its own price and order book.
- "Arsenal Yes 19%" means "19% chance Arsenal wins the UCL."
- All options are independent — their probabilities don't need to sum to 100%.

### Multi-Outcome Markets (e.g., "UEFA Champions League Winner")
- Each candidate (Arsenal, Bayern, etc.) is its own binary market.
- Grouped under one "event" in the UI.
- Each shows a percentage + Yes/No buttons.
- Buying "Arsenal Yes" at $0.19 pays $1.00 if Arsenal wins.

---

## Feature Gap: What BetiPredict Is Missing

### Phase 1 — Critical Fixes (Current Sprint)
These are bugs and UX issues that must be fixed now:

| # | Issue | Status |
|---|-------|--------|
| 1 | DRAW matches never resolve (winner='DRAW' not handled) | **Fix now** |
| 2 | SCHEDULED→FINISHED games missed by resolution cron | **Fix now** |
| 3 | Team buttons use green/red (looks like positive/negative) | **Fix now** |
| 4 | DRAW button is non-functional (opens YES market) | **Fix now** |
| 5 | Some market cards not clickable/tradable | **Fix now** |
| 6 | K1,000 signup message still shown (balance is actually 0) | **Fix now** |

### Phase 2 — Short-Term Improvements (1-2 weeks)
Features that improve the product significantly without major architecture changes:

| # | Feature | Description | Effort |
|---|---------|-------------|--------|
| 1 | **Prop Money Test Mode** | Admin toggle for test/real money mode. In test mode, deposits are simulated (instant K balance credit). Real payment infrastructure stays intact. | Medium |
| 2 | **Odds-Based Initial Pricing** | Use betting odds from football-data.org API to set initial CPMM prices instead of 50/50. E.g., if odds favor home team 60%, seed pool at 0.60/0.40. | Low |
| 3 | **Better Price Display** | Show prices in cents (like Polymarket's "Yes 13¢") alongside percentages. | Low |
| 4 | **Market Detail Improvements** | Show resolution rules, dispute window countdown, current proposed outcome. | Medium |
| 5 | **User Dispute UI** | Allow users to submit disputes from the market detail page during the 2h window. | Medium |

### Phase 3 — Medium-Term Features (1-2 months)
Features that require more significant work:

| # | Feature | Description | Effort |
|---|---------|-------------|--------|
| 1 | **Multi-Outcome Markets** | Create 3 separate binary markets per match (Home/Draw/Away). Group under one event in UI. Each has independent Yes/No CPMM pool. | High |
| 2 | **Limit Orders** | Allow users to place orders at a specific price (not just market orders). Orders sit in a book until matched. | High |
| 3 | **Order Book Display** | Show bid/ask depth for each market. | Medium |
| 4 | **Sell Shares Anytime** | Users can sell positions before market resolves (partially implemented). | Medium |
| 5 | **Portfolio P&L Tracking** | Real-time unrealized P&L, entry price tracking, position history. | Medium |

### Phase 4 — Long-Term / Nice-to-Have
Features for scale and competitive parity with Polymarket:

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Maker Rebates Program** | Pay liquidity providers from taker fees. |
| 2 | **Custom Market Creation** | Let users create non-sports markets (politics, entertainment, crypto). |
| 3 | **Event Grouping** | Group related markets (e.g., "Premier League Winner" with 20 team options). |
| 4 | **Advanced Charts** | Candlestick/depth charts, historical price data. |
| 5 | **API for Bots/MM** | Public API for automated trading and market making. |
| 6 | **Holding Rewards** | Polymarket pays 4% APY on position value. Consider implementing. |
| 7 | **On-Chain Settlement** | Move to blockchain-based settlement for transparency. |

---

## Architecture Decision: CPMM vs CLOB

**Recommendation: Stay with CPMM for now.**

| Factor | CPMM (Current) | CLOB (Polymarket) |
|--------|----------------|-------------------|
| Liquidity | Always available (AMM provides) | Depends on market makers |
| Complexity | Simple, well-understood | Complex matching engine needed |
| Initial price | Can be seeded from odds | No price until first orders match |
| Draw handling | Need separate markets | Natural with separate markets |
| Scalability | Good for current scale | Better for high volume |
| User experience | Simpler (just buy/sell) | More complex (limit orders, spreads) |

CPMM is the right choice for BetiPredict's current scale. The key improvement is to **seed initial prices from betting odds** instead of 50/50, and to **create separate markets for each match outcome** (Home/Draw/Away) in Phase 3.

---

## DRAW Resolution Strategy

**Current problem**: Markets are binary (YES/NO = Home/Away). Draws are not handled.

**Immediate fix**: When a match ends in a DRAW, VOID the market and refund all traders.

**Future fix (Phase 3)**: Create 3 separate binary markets per match:
- "Will [HomeTeam] win?" → YES/NO CPMM pool
- "Will it be a Draw?" → YES/NO CPMM pool  
- "Will [AwayTeam] win?" → YES/NO CPMM pool

Only one resolves YES, the other two resolve NO. All payouts are clean.

---

*Last updated: February 2026*
