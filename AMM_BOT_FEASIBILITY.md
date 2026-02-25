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
