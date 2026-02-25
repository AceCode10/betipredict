# Automated Market Maker (AMM) Bot — Feasibility Analysis

## Objective
Evaluate implementing an automated market maker bot that provides constant liquidity, narrows bid-ask spreads, and reduces volatility on all markets after initial prices are set by the Market Maker.

## How It Would Work

### Core Concept
After a Market Maker sets initial prices (e.g., Home 40%, Draw 28%, Away 32%), the AMM bot would:
1. Place resting limit orders on both sides of each outcome's order book
2. Continuously update prices based on incoming trades (mean-reversion)
3. Maintain a configurable spread around the "fair value" price

### Order Placement Strategy
For each outcome (e.g., HOME at 0.40):
- **Bid (buy)**: Place limit buy at `fairPrice - halfSpread` (e.g., 0.38)
- **Ask (sell)**: Place limit sell at `fairPrice + halfSpread` (e.g., 0.42)
- **Depth**: Place multiple levels at decreasing sizes (e.g., 3 levels each side)
- **Refresh**: Cancel and replace orders every N seconds or after fills

### Price Update Logic
```
newFairPrice = lastTradePrice ?? (bestBid + bestAsk) / 2
adjustedPrice = alpha * newFairPrice + (1 - alpha) * previousFairPrice
```
Where `alpha` controls responsiveness (0.1 = slow, 0.5 = responsive).

## Architecture Options

### Option A: Cron-Based Bot (Recommended for MVP)
- **How**: A cron job (every 30-60s) checks all active CLOB markets
- **For each market/outcome**: Cancels stale bot orders, places new ones at updated prices
- **Pros**: Simple, uses existing API infrastructure, easy to monitor
- **Cons**: Not real-time, 30-60s latency between price updates
- **Cost**: No additional infrastructure, runs on existing server

### Option B: Background Worker Process
- **How**: Separate Node.js process with WebSocket or polling loop
- **Pros**: Sub-second response to market changes
- **Cons**: Requires separate deployment, more complex ops
- **Cost**: Additional server/container (~$5-15/month)

### Option C: Event-Driven (Post-Trade Hook)
- **How**: After each trade fills, trigger bot price update for that market
- **Pros**: Most responsive, zero latency
- **Cons**: Adds latency to trade API, complex error handling
- **Cost**: No additional infra but increases trade API complexity

## Implementation Plan (Option A — Cron MVP)

### 1. Bot Configuration (Database)
```sql
-- Per-market bot settings
ALTER TABLE "Market" ADD COLUMN "botEnabled" BOOLEAN DEFAULT false;
ALTER TABLE "Market" ADD COLUMN "botSpread" FLOAT DEFAULT 0.04;      -- 4% spread
ALTER TABLE "Market" ADD COLUMN "botDepth" FLOAT DEFAULT 100;        -- K100 per level
ALTER TABLE "Market" ADD COLUMN "botLevels" INT DEFAULT 3;           -- 3 price levels
```

### 2. Bot System User
- Create a dedicated `bot@betipredict.com` system user
- Fund with platform capital (configurable)
- Bot's balance acts as the liquidity pool

### 3. Cron Endpoint: `/api/cron/amm-bot`
```typescript
// Pseudocode
for each ACTIVE market with botEnabled=true:
  for each outcome (YES/NO or HOME/DRAW/AWAY):
    1. Get current fair price from lastTradePrice or market price
    2. Cancel all existing bot orders for this outcome
    3. Place bid orders at: fairPrice - spread, fairPrice - 2*spread, ...
    4. Place ask orders at: fairPrice + spread, fairPrice + 2*spread, ...
    5. Size: botDepth / level (decreasing: 100, 75, 50)
```

### 4. Risk Management
- **Max position limit**: Bot should not accumulate more than X shares per outcome
- **Inventory skew**: If bot holds too many shares, shift quotes to reduce position
- **Price bounds**: Never quote below 0.02 or above 0.98
- **Kill switch**: Admin can disable bot globally or per-market
- **P&L tracking**: Track bot's realized and unrealized P&L

## Capital Requirements
- **Per market**: 3 levels × 2 sides × 3 outcomes × K100 = ~K1,800 reserved
- **10 active markets**: ~K18,000 bot capital needed
- **50 active markets**: ~K90,000 bot capital needed
- Capital is recycled as orders fill and new ones are placed

## Risk Analysis

### Risks
1. **Adverse selection**: Informed traders consistently trade against the bot
2. **Capital lock-up**: Large portion of capital tied in resting orders
3. **Stale quotes**: If bot doesn't update fast enough, exploitable
4. **Resolution risk**: Bot may hold losing positions at market close

### Mitigations
1. Widen spread during high-volatility periods
2. Implement inventory-aware quoting (skew prices)
3. Use Option A initially; upgrade to Option C if needed
4. Auto-cancel bot orders 1 hour before resolveTime

## Feasibility Assessment

| Factor | Rating | Notes |
|--------|--------|-------|
| Technical complexity | **Medium** | Uses existing CLOB API, no new infrastructure |
| Capital requirement | **Medium** | K18K-90K depending on active markets |
| Risk | **Low-Medium** | Spread provides buffer; inventory management needed |
| User benefit | **High** | Eliminates empty order books, instant tradability |
| Time to implement | **3-5 days** | Cron approach with basic inventory management |

## Recommendation
**Implement Option A (Cron-Based) as MVP.**

Start with:
1. A bot system user with K50,000 initial balance
2. 4% default spread, 3 levels, K100 per level
3. 60-second refresh cycle via cron
4. Enable on all markets after Market Maker sets initial prices
5. Auto-disable 1 hour before market resolution
6. Admin toggle per-market in Market Maker dashboard

This gives immediate liquidity benefits with minimal risk and no additional infrastructure cost.

## Future Enhancements
- Event-driven updates (Option C) for sub-second response
- Machine learning for dynamic spread adjustment
- Cross-market hedging for correlated outcomes
- Public liquidity mining rewards for non-bot market makers

---

# Appendix: Comprehensive Risk Elimination Strategies

## Risk 1: Adverse Selection (Informed Traders Exploiting the Bot)

**The Problem**: Traders with superior information (e.g., they know a player is injured before the market does) consistently trade against the bot at stale prices, causing losses.

### Elimination Strategies

**A. External Odds Feed Integration (Primary Defense)**
- Integrate The Odds API or similar to pull real-time bookmaker odds every 30-60 seconds
- Automatically update the bot's "fair value" to match the consensus of professional bookmakers
- If the external odds diverge from the bot's current fair price by more than 5%, immediately widen the spread or pause quoting on that market
- This is the single most effective defense — professional bookmakers have already priced in all known information

```typescript
// Pseudocode: odds-aware fair value update
const externalOdds = await fetchOddsFromAPI(marketId)
const consensusFairPrice = averageAcrossBookmakers(externalOdds)
const currentBotPrice = bot.fairPrice[marketId]

const divergence = Math.abs(consensusFairPrice - currentBotPrice)
if (divergence > 0.05) {
  // Major divergence — informed traders may be exploiting stale quotes
  bot.pauseMarket(marketId) // Cancel all orders, re-enter at new price
  bot.fairPrice[marketId] = consensusFairPrice
} else {
  // Gradual convergence
  bot.fairPrice[marketId] = 0.7 * consensusFairPrice + 0.3 * currentBotPrice
}
```

**B. Trade-Triggered Spread Widening**
- Track the bot's fill rate per market over rolling 10-minute windows
- If one side (e.g., buy HOME) fills significantly more than the other, widen the spread
- If fill imbalance exceeds 3:1 ratio, double the spread temporarily
- This makes it expensive for informed traders to extract value

**C. Volume Anomaly Detection**
- Track per-user trade volumes against the bot
- If a single user accounts for >40% of bot fills in a market, flag and widen spread for that market
- Optional: temporarily exclude that user from bot liquidity (still allow P2P trading)

**D. Time-Decay Awareness**
- As a match approaches kickoff, information asymmetry increases (team lineups, injuries leak)
- Automatically widen spread from 4% → 8% → 12% as the market approaches resolveTime
- Auto-cancel ALL bot orders 2 hours before kickoff (not just 1 hour)

### Implementation Priority: **A → D → B → C**

---

## Risk 2: Capital Lock-Up

**The Problem**: Large amounts of capital are tied up in resting orders across many markets, reducing available liquidity and platform operational capital.

### Elimination Strategies

**A. Dynamic Capital Allocation**
- Don't allocate equal capital to all markets — allocate based on:
  - **Market popularity** (expected volume): More capital to popular markets
  - **Time to resolution**: Less capital to markets resolving soon (less upside)
  - **Current inventory**: Reduce new allocation if bot already holds large position

```typescript
function calculateMarketAllocation(market: Market, botState: BotState): number {
  const BASE = 100 // K100 base per level
  const popularityMultiplier = market.expectedVolume > 1000 ? 1.5 : 
                                market.expectedVolume > 100 ? 1.0 : 0.5
  const timeMultiplier = hoursUntilResolve(market) > 48 ? 1.0 :
                          hoursUntilResolve(market) > 12 ? 0.7 : 0.3
  const inventoryPenalty = botState.netPosition[market.id] > 500 ? 0.5 : 1.0
  
  return BASE * popularityMultiplier * timeMultiplier * inventoryPenalty
}
```

**B. Shared Capital Pool with Lazy Allocation**
- Don't pre-allocate capital to markets — use a single pool
- Only reserve capital when actually placing an order (just-in-time)
- When an order fills, the capital is immediately available for the next market
- This reduces peak capital requirement by ~60% since not all markets are active simultaneously

**C. Level Reduction for Low-Volume Markets**
- Markets with <10 trades/day: 1 level each side (not 3)
- Markets with 10-50 trades/day: 2 levels
- Markets with 50+ trades/day: 3 levels
- Review and adjust daily

**D. Capital Recycling Dashboard**
- Admin panel showing: total capital deployed, capital per market, fill rate, P&L
- Auto-reduce allocation to markets where bot is consistently losing
- Auto-increase allocation to profitable markets

### Net Effect: Reduces capital requirement from K90,000 to ~K30,000 for 50 markets

---

## Risk 3: Stale Quotes (Latency Exploitation)

**The Problem**: In the 30-60 second gap between bot refreshes (cron cycle), prices may have moved due to trades, and the bot's resting orders become exploitable.

### Elimination Strategies

**A. Post-Trade Hook (Zero Latency)**
- Add a lightweight hook at the end of the trade API: after ANY trade fills on a bot-enabled market, immediately update the bot's orders for that market
- This eliminates the cron latency entirely for active markets

```typescript
// In src/app/api/trade/route.ts, after a successful trade:
if (market.botEnabled && fills.length > 0) {
  // Fire-and-forget: update bot quotes for this market
  fetch(`${process.env.NEXTAUTH_URL}/api/cron/amm-bot?marketId=${market.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
  }).catch(() => {}) // Non-blocking
}
```

**B. Cron as Safety Net Only**
- Keep the 60-second cron as a BACKUP to catch markets where the post-trade hook missed
- The cron handles: new markets, markets with no recent trades, periodic spread recalibration
- This hybrid approach gives sub-second response for active markets + guaranteed coverage for all

**C. Price Movement Circuit Breaker**
- Track the last price at which the bot placed orders
- If a trade moves the market price by >5% in one fill, immediately cancel ALL bot orders on that market (triggered in the trade hook)
- Re-enter at new prices in the next cron cycle (30-60s cooldown)
- Prevents cascading losses from sudden price movements

**D. Asymmetric Quote Refresh**
- After a buy fills against the bot → immediately refresh the ask side (bot was selling)
- After a sell fills against the bot → immediately refresh the bid side (bot was buying)
- Only refresh the side that was just traded against (saves API calls and reduces order churn)

### Net Effect: Reduces effective latency from 60s to <1s for active markets

---

## Risk 4: Resolution Risk (Holding Losing Positions at Close)

**The Problem**: The bot may accumulate a large position in an outcome that ultimately loses, resulting in total loss of that position's value.

### Elimination Strategies

**A. Inventory-Aware Quoting (Primary Defense)**
- Track the bot's net position per outcome per market
- Skew quotes to REDUCE inventory, not grow it

```typescript
function getSkewedSpread(fairPrice: number, netPosition: number, baseSpread: number) {
  const MAX_POSITION = 1000 // Max shares before aggressive unwind
  const skew = (netPosition / MAX_POSITION) * baseSpread * 2
  
  return {
    bidPrice: fairPrice - baseSpread/2 - skew,  // Lower bid if long (discourage buying more)
    askPrice: fairPrice + baseSpread/2 - skew,   // Lower ask if long (encourage selling)
  }
}
// If bot is LONG 500 HOME shares:
//   Normal: bid 0.38, ask 0.42 (fair = 0.40, spread = 0.04)
//   Skewed: bid 0.36, ask 0.40 (shifted down to attract sellers)
```

**B. Position Limits with Hard Caps**
- Set a maximum net position per outcome: e.g., 1,000 shares
- When limit is reached, STOP quoting on the side that would increase the position
- Still quote the reducing side (if long, still offer to sell)

**C. Gradual Position Reduction Schedule**
- Starting 24 hours before resolveTime: reduce position limits by 25% every 6 hours
- 24h before: max 750 shares → 12h: max 500 → 6h: max 250 → 2h: cancel all
- This ensures the bot enters resolution with minimal exposure

**D. Hedging via Opposite Outcomes**
- In a TRI_OUTCOME market, positions in HOME/DRAW/AWAY are naturally offsetting
- If bot is long 500 HOME and short 200 DRAW, net exposure is lower
- Track NET exposure across all outcomes: if bot holds 500 HOME + 500 DRAW + 500 AWAY, effective exposure = 0 (guaranteed 500 shares win)
- The bot can intentionally take the other side to hedge

**E. Maximum Loss Budget per Market**
- Set a K-value loss budget per market (e.g., K500)
- Track unrealized P&L: if unrealized loss exceeds budget, stop quoting and unwind position
- This caps the worst-case loss per market regardless of outcome

```typescript
const unrealizedPnL = calculateUnrealizedPnL(botPositions[marketId], currentPrices)
if (unrealizedPnL < -MAX_LOSS_PER_MARKET) {
  bot.pauseMarket(marketId)
  bot.unwindPosition(marketId) // Place aggressive orders to exit
}
```

### Net Effect: Worst-case loss per market capped at configurable budget (e.g., K500)

---

## Combined Risk Profile After All Mitigations

| Risk | Before Mitigation | After Mitigation | Residual |
|------|-------------------|------------------|----------|
| Adverse selection | **High** — bot quotes at stale prices | **Very Low** — external odds feed + trade-triggered updates | Minimal: only from news < 30s old |
| Capital lock-up | **Medium** — K90K for 50 markets | **Low** — K30K with dynamic allocation | Manageable: shared pool recycles |
| Stale quotes | **Medium** — 60s latency | **Very Low** — post-trade hook, <1s active markets | Near-zero for active markets |
| Resolution risk | **Medium** — bot may hold large losing positions | **Low** — inventory limits + gradual unwind + loss budget | Capped at configurable K per market |

## Expected P&L Model

Assuming 4% average spread with the above mitigations:
- **Revenue per round-trip**: ~4% of trade value (buy at 38%, sell at 42%)
- **Average daily volume per market**: K5,000
- **Bot capture rate**: ~30% of volume (rest is P2P)
- **Daily gross revenue per market**: K5,000 × 30% × 4% = **K60/day**
- **Daily loss from adverse selection** (with mitigations): ~K10/day per market
- **Net daily profit per market**: ~**K50/day**
- **50 active markets**: ~**K2,500/day** or **~K75,000/month**

This is a rough model — actual results depend on market conditions, volume, and tuning.
