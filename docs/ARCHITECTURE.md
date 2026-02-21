# BetiPredict — Architecture Documentation

## Overview

BetiPredict is a sports prediction market platform built with **Next.js 16**, **Prisma ORM**, **PostgreSQL**, and **Tailwind CSS**. It uses a **Constant Product Market Maker (CPMM)** trading engine inspired by Polymarket.

Users deposit via **Airtel Money** or **MTN MoMo** (Zambian mobile money), trade on sports match outcomes, and withdraw winnings.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS |
| Backend | Next.js API Routes (serverless) |
| Database | PostgreSQL via Prisma ORM v5 |
| Auth | NextAuth.js (credentials provider, JWT sessions) |
| Payments | Airtel Money Zambia, MTN MoMo Zambia |
| Sports Data | football-data.org API (live scores, fixtures) |
| Deployment | Vercel |

---

## Directory Structure

```
betipredict/
├── prisma/
│   └── schema.prisma          # Database schema (all models)
├── src/
│   ├── app/                   # Next.js App Router pages & API routes
│   │   ├── page.tsx           # Main homepage (markets grid, live banner, trading overlay)
│   │   ├── account/           # Portfolio dashboard
│   │   ├── admin/             # Admin panel (market mgmt, disputes, users, wallet)
│   │   ├── auth/              # Sign in, verify, forgot/reset password
│   │   ├── leaderboard/       # Trader leaderboard
│   │   ├── terms/             # Terms of Service
│   │   ├── privacy/           # Privacy Policy
│   │   └── api/               # All API endpoints (see below)
│   ├── components/            # Reusable React components
│   │   ├── Header.tsx         # App header (search, nav, notifications, deposit)
│   │   ├── LiveMatchBanner.tsx# Live match cards with real-time scores
│   │   ├── PriceChart.tsx     # SVG price history chart
│   │   ├── MarketChat.tsx     # Market comments/chat
│   │   ├── DepositModal.tsx   # Mobile money deposit flow
│   │   ├── WithdrawModal.tsx  # Mobile money withdrawal flow
│   │   ├── CreateMarketModal.tsx # Custom market creation
│   │   └── ...
│   ├── lib/                   # Server-side libraries
│   │   ├── cpmm.ts           # CPMM trading engine (initializePool, calculateShares, etc.)
│   │   ├── fees.ts           # Fee configuration (trade 2%, withdrawal 1.5%, etc.)
│   │   ├── auth.ts           # NextAuth configuration
│   │   ├── prisma.ts         # Prisma client singleton
│   │   ├── airtel-money.ts   # Airtel Money API integration
│   │   ├── mtn-money.ts      # MTN MoMo API integration
│   │   ├── payment-settlement.ts # Atomic payment settlement (deposit/withdrawal)
│   │   ├── email.ts          # Email notification stubs
│   │   ├── rate-limit.ts     # In-memory rate limiter
│   │   ├── idempotency.ts    # Idempotency key management
│   │   ├── sports-api.ts     # football-data.org client
│   │   └── env-check.ts      # Runtime environment variable validation
│   ├── contexts/              # React contexts (ThemeContext)
│   ├── utils/                 # Shared utilities (currency formatting)
│   └── types/                 # TypeScript type definitions
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md        # This file
│   ├── ROADMAP.md             # Feature roadmap & gap analysis
│   ├── DEPLOYMENT.md          # Deployment guide
│   └── MOBILE_MONEY_SETUP.md  # Payment provider setup guide
└── .env                       # Environment variables (not committed)
```

---

## API Routes

### Public
| Route | Method | Description |
|-------|--------|-------------|
| `/api/markets` | GET | List markets (with live status enrichment) |
| `/api/markets/[id]` | GET | Single market details |
| `/api/markets/[id]/history` | GET | Price history for charts |
| `/api/markets/activity` | GET | Recent trading activity |
| `/api/markets/stream` | GET | SSE stream for real-time price updates |
| `/api/matches/live` | GET | Live match data + auto-creates markets |
| `/api/health` | GET | Health check (DB + environment) |
| `/api/leaderboard` | GET | Top traders by PnL |

### Authenticated
| Route | Method | Description |
|-------|--------|-------------|
| `/api/trade` | POST | Execute BUY/SELL trade |
| `/api/deposit` | POST | Initiate mobile money deposit |
| `/api/withdraw` | POST | Initiate withdrawal |
| `/api/markets` | POST | Create custom market (K50 fee) |
| `/api/user/balance` | GET | Current user balance |
| `/api/user/positions` | GET | User's open positions |
| `/api/user/transactions` | GET | Transaction history |
| `/api/user/profile` | GET/PUT | Profile management |
| `/api/user/export` | GET | CSV export of transactions |
| `/api/user/watchlist` | GET/POST | Toggle market watchlist |
| `/api/notifications` | GET/PUT | Notifications (fetch, mark read) |
| `/api/suggestions` | POST | Suggest new market |

### Admin (requires admin email)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/admin/stats` | GET | Platform statistics |
| `/api/admin/users` | GET | User management |
| `/api/admin/disputes` | GET/PUT | Market dispute management |
| `/api/admin/wallet` | GET | Platform revenue ledger |
| `/api/admin/audit` | GET | Audit log |
| `/api/admin/sync-games` | POST | Trigger game sync |

### Cron (requires CRON_SECRET)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/cron/sync-games` | GET | Auto-sync upcoming matches → create markets |
| `/api/cron/resolve` | GET | Auto-resolve finished matches |
| `/api/cron/reconcile` | GET | Reconcile pending payments |

### Webhooks
| Route | Method | Description |
|-------|--------|-------------|
| `/api/payments/callback` | POST | Airtel/MTN webhook for payment status |
| `/api/payments/status` | GET | Poll payment status |

---

## Trading Engine (CPMM)

The platform uses a **Constant Product Market Maker** where:
- `yesShares × noShares = k` (constant)
- `Price(YES) = noShares / (yesShares + noShares)`
- `Price(NO) = yesShares / (yesShares + noShares)`

Pool state (`poolYesShares`, `poolNoShares`, `poolK`) is persisted on every trade.

**Liquidity** = `poolYesShares + poolNoShares` (derived from pool state, not manually tracked).

**Volume** = cumulative sum of all trade amounts (incremented on each BUY/SELL).

---

## Fee Structure

| Fee | Rate | Description |
|-----|------|-------------|
| Trade fee | 2% | Deducted from every BUY/SELL amount |
| Withdrawal fee | 1.5% (min K5) | Deducted from withdrawal |
| Market creation | K50 flat | Custom market creation |
| Resolution fee | 1% | From winning payouts (configured, not yet applied) |
| Deposit fee | 0% | No fee on deposits |

---

## Security

- **NEXTAUTH_SECRET** validated at startup
- **CSRF origin checks** on all state-changing API routes (POST/PUT/DELETE/PATCH)
- **Webhook signature verification** (fail-closed — no secret = reject)
- **XSS sanitization** on chat messages
- **Rate limiting** on all API routes (in-memory, per-IP/user)
- **Account lockout** after 5 failed login attempts (15-minute cooldown)
- **Idempotency keys** on deposit/withdrawal (user+route scoped)
- **Daily withdrawal limit** of K500,000
- **Minimum balance enforcement** with epsilon check

---

## Data Flow: Live Match → Tradable Market

1. `football-data.org` API returns live matches
2. `/api/matches/live` checks for linked `ScheduledGame` records
3. If no market exists for a live match → **auto-creates** one with CPMM pool
4. `LiveMatchBanner` renders cards with scores, odds, bet buttons
5. Markets shown in live banner are **excluded** from the main grid (no duplicates)
6. Clicking a bet button opens the trading overlay with the market pre-selected
