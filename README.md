# BetiPredict - African Prediction Market Platform

BetiPredict is a Polymarket-style prediction market platform for the African market, with initial focus on Zambia. Users trade on sports outcomes using a Central Limit Order Book (CLOB) for real-time price discovery.

## Features

### Core Platform
- **CLOB Trading Engine**: Central Limit Order Book with price-time priority matching, limit and market orders
- **Tri-Outcome Markets**: HOME / DRAW / AWAY for football matches (plus legacy binary YES/NO)
- **Auto Market Creation**: Cron job syncs upcoming matches from football-data.org (PL, La Liga, Bundesliga, Serie A, Ligue 1, Champions League)
- **Real-time SSE**: Live price updates, trade toasts, and order book streaming
- **Polymarket-style UI**: Market cards, trading panel overlay, multi-line price charts with team name labels
- **Mobile Money**: Airtel Money and MTN MoMo integration (Zambia)
- **Test Mode**: Instant deposits/withdrawals with prop money (`NEXT_PUBLIC_TEST_MODE=true`)

### Technical Stack
- **Frontend**: Next.js 14 + React + TypeScript + TailwindCSS
- **Backend**: Next.js API routes + Prisma ORM
- **Database**: PostgreSQL (Supabase)
- **Auth**: NextAuth.js with email/password
- **Payments**: Airtel Money / MTN MoMo APIs
- **Sports Data**: football-data.org v4 API

## Currency Display

All prices are displayed in **Zambian Kwacha (K)** and **ngwee (n)**:
- Share prices: `40n`, `28n` (1n = K0.01)
- Balances and amounts: `K100.00`, `K5,000`
- Shares trade between 1n and 99n (K0.01 - K0.99)
- Winning shares pay K1.00 at resolution

## CLOB Pricing

Markets use a Central Limit Order Book for organic price discovery:
- **No automated market maker**: Prices are set by real orders from traders
- **Initial indicative prices**: New markets start with a home-advantage model (Home ~40%, Draw ~28%, Away ~32%) as starting points
- **Price updates**: Each filled trade updates the displayed price
- **Order book**: Bids and asks visible in trading panel
- Limit orders rest on the book until matched or cancelled
- Market orders sweep the book immediately

## Installation

### Prerequisites
- Node.js 18+
- PostgreSQL (or Supabase account)

### Setup
```bash
git clone <repository-url>
cd betipredict
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### Environment Variables (`.env.local`)
```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret"
FOOTBALL_DATA_API_KEY="your-api-key"
CRON_SECRET="your-cron-secret"
NEXT_PUBLIC_TEST_MODE="true"
```

### Key Environment Variables
| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase pooled connection string |
| `DIRECT_URL` | Supabase direct connection string |
| `FOOTBALL_DATA_API_KEY` | football-data.org API key (free tier) |
| `CRON_SECRET` | Secret for cron job authentication |
| `NEXT_PUBLIC_TEST_MODE` | `true` to enable instant deposits/withdrawals |
| `AIRTEL_API_*` | Airtel Money API credentials |

## Project Structure

```
src/
  app/
    page.tsx              # Main homepage with market cards + trading overlay
    api/
      trade/route.ts      # CLOB + legacy CPMM trade execution
      orderbook/route.ts  # Order book state per market/outcome
      orders/cancel/      # Cancel resting CLOB orders
      cron/sync-games/    # Auto-sync matches from football-data.org
      deposit/            # Mobile money deposits
      withdraw/           # Mobile money withdrawals
      markets/[id]/history/ # Price history for charts
  components/
    PriceChart.tsx        # Multi-line chart with Polymarket-style labels
    LiveMatchBanner.tsx   # Live match cards with real-time scores
    Header.tsx            # App header with search and navigation
    DepositModal.tsx      # Deposit via mobile money or test mode
    WithdrawModal.tsx     # Withdraw via mobile money or test mode
  lib/
    clob.ts              # OrderBook engine (bid/ask matching, serialize/deserialize)
    sports-api.ts        # football-data.org API client
    market-resolution.ts # Market resolution + CLOB order refunds
  utils/
    currency.ts          # formatZambianCurrency, formatPriceAsNgwee
prisma/
  schema.prisma          # Database schema (User, Market, Order, Position, etc.)
```

## Deployment

### Production (Vercel)
1. Push to GitHub
2. Connect to Vercel
3. Set environment variables in Vercel dashboard
4. Set `NEXT_PUBLIC_TEST_MODE=false` for real money mode
5. Configure cron job (e.g., cron-job.org) to call `/api/cron/sync-games` hourly

### Cron Job Setup
```
URL: https://betipredict.com/api/cron/sync-games
Method: GET
Header: Authorization: Bearer <CRON_SECRET>
Schedule: Every hour
```

## License

MIT License - see LICENSE file for details.

## Disclaimer

BetiPredict is a prediction market platform. Users must be of legal betting age in their jurisdiction. Please trade responsibly.

---

**BetiPredict** - The Future of African Sports Prediction 🇿🇲
