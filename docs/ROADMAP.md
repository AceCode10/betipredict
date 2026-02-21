# BetiPredict — Gap Analysis & Implementation Roadmap

> Generated: 2026-02-21 | Updated: 2026-02-21 | Status: Living Document

---

## 1. Current State Assessment

### What Works
| Feature | Status | Notes |
|---------|--------|-------|
| User auth (signup/signin/JWT) | ✅ Working | Credentials provider, bcrypt, email verification |
| Market creation (manual + scheduled games) | ✅ Working | Admin + user creation, football-data.org sync |
| CPMM trading engine (buy/sell) | ✅ Working | Binary markets, constant product AMM |
| CPMM pool state persistence | ✅ Working | `poolYesShares`, `poolNoShares`, `poolK` persisted per trade |
| Live match cards (Polymarket-style) | ✅ Working | Scores, crests, bet buttons, live indicator |
| Market detail overlay + trading panel | ✅ Working | Buy/Sell toggle, outcome selector, chart, tabs |
| Activity tab in market detail | ✅ Working | Real per-market activity feed via `/api/markets/activity` |
| Price chart (historical) | ✅ Working | Per-market price history |
| Mobile money deposits (Airtel + MTN) | ✅ Working | Collection API, callback, polling |
| Mobile money withdrawals (Airtel + MTN) | ✅ Working | Disbursement API, refund on failure |
| Fee system (trade/withdraw/resolution/creation) | ✅ Working | Platform revenue ledger |
| Market resolution + 24h dispute window | ✅ Working | Atomic finalization, payout processing |
| Admin panel (basic) | ✅ Working | Stats, disputes, user management |
| Real-time SSE market stream | ✅ Working | Live price updates, trade notifications |
| Market chat/comments | ✅ Working | Per-market discussion |
| Top Holders + Positions tabs | ✅ Working | API endpoints + UI tabs |
| BetSlip removal | ✅ Working | Legacy BetSlip removed; trading happens in market-detail panel |
| 404/500 app error pages | ✅ Working | Custom `not-found.tsx` and `error.tsx` |
| Rate limiting (in-memory) | ✅ Working | Per-user, per-endpoint |
| Audit logging | ✅ Working | Login, trades, resolution, admin actions |
| Idempotency (deposit/withdraw) | ✅ Working | Prevents duplicate financial operations |
| Dark/light theme | ✅ Working | System-wide theme context |

### What's Missing or Incomplete

#### P0 — Critical for Launch
1. **No automated tests** — Zero unit/integration/e2e tests for any financial pathway
2. **No email notifications for trades/deposits/withdrawals** — Users only see in-app notifications
3. **No KYC/identity verification** — Required for financial services in Zambia
4. **No terms of service / privacy policy pages** — Legal requirement
5. **No transaction history export** — Users can't download their records
6. **No mobile-responsive testing** — UI may break on small screens

#### P1 — Important for User Experience
9. **No user profile page** — Can't change username, avatar, bio
10. **No portfolio dashboard** — No aggregate view of all positions, PnL, trade history
11. **No market search** — Search bar exists but may not filter effectively
12. **No market categories beyond sports** — Limited to football leagues
13. **No order book / limit orders** — Only market orders implemented
14. **No price alerts / watchlist** — Users can't track markets they're interested in
15. **No leaderboard** — No competitive element for top traders
16. **No referral system** — No viral growth mechanism

#### P2 — Important for Scale & Operations
19. **In-memory rate limiting** — Won't work across multiple server instances (needs Redis)
20. **No Redis/external cache** — Session, rate limits, idempotency all in-memory
21. **No database connection pooling config** — Prisma defaults may not handle load
22. **No monitoring/alerting** — No health checks, error tracking (Sentry), uptime monitoring
23. **No CI/CD pipeline** — No automated build/test/deploy
24. **No database backups strategy** — No documented backup/restore procedure
25. **No load testing** — Unknown capacity limits
26. **Cron jobs rely on external trigger** — No built-in scheduler

#### P3 — Nice to Have
27. **No social login** (Google, Apple) — Only email/password
28. **No PWA support** — Not installable on mobile
29. **No push notifications** — Only in-app notifications
30. **No multi-language support** — English only
31. **No dark mode toggle in header** — Theme exists but toggle may be hidden
32. **No market resolution oracle integration** — Auto-resolve uses random outcome as fallback

---

## 2. Security Issues Found & Fixed

### Fixed in This Session
| Issue | Severity | Fix |
|-------|----------|-----|
| Signup gives K1000 free balance (multi-account exploit) | 🔴 Critical | Changed to K0 |
| No login brute force protection | 🔴 Critical | Added 5-attempt lockout + rate limit |
| CPMM sell exploit (infinite proceeds) | 🔴 Critical | Added 95% pool clamp |
| Double-sell race condition | 🔴 Critical | Position check moved inside transaction |
| Withdrawal double-refund risk | 🟡 High | settledAt set on immediate refund |
| Trade volume tracking incorrect | 🟡 High | Now tracks gross amount |
| Error messages leak internals | 🟡 High | Safe message whitelist on resolve endpoint |
| Losing positions show 0 PnL | 🟢 Medium | Now shows negative cost basis |

### Remaining Security Concerns
| Issue | Severity | Recommendation |
|-------|----------|----------------|
| No CSRF tokens on POST endpoints | 🟡 High | Add SameSite cookie + origin check |
| NextAuth secret not explicitly configured | 🟡 High | Set NEXTAUTH_SECRET in env |
| Webhook signature bypass when secret missing | 🟡 High | Reject callbacks if secret not configured |
| No input sanitization on market chat | 🟡 High | Sanitize HTML/XSS in chat messages |
| Admin email list in env (no DB RBAC) | 🟢 Medium | Move to DB-based role system |
| No 2FA option | 🟢 Medium | Add TOTP-based 2FA |
| No session invalidation on password change | 🟢 Medium | Revoke all sessions on password reset |

---

## 3. Money Transaction Audit Summary

### Flow: Deposit
```
User → POST /api/deposit → MobilePayment(PENDING) → Provider API → 
  Callback/Poll → settleDepositCompleted → User.balance += amount
```
**Status**: ✅ Sound. Atomic settlement claim prevents double-credit.

### Flow: Buy Trade
```
User → POST /api/trade (BUY) → 
  Fee = 2% of gross → Net goes to CPMM → Shares calculated →
  Transaction: User.balance -= gross, Position += shares, Market prices updated
```
**Issues Fixed**: Volume now tracks gross. Balance re-checked inside transaction.

### Flow: Sell Trade
```
User → POST /api/trade (SELL) → 
  CPMM calculates proceeds → Fee = 2% of proceeds →
  Transaction: User.balance += net, Position -= shares, Market prices updated
```
**Issues Fixed**: Position re-checked inside transaction (prevents double-sell race). Pool sell clamped to 95%.

### Flow: Withdrawal
```
User → POST /api/withdraw →
  Fee = 1.5% (min K5) → User.balance -= gross → Provider disbursement →
  Success: MobilePayment(COMPLETED) | Failure: Refund balance + reverse fee
```
**Issues Fixed**: settledAt set on immediate refund to prevent double-refund from callback.

### Flow: Market Resolution
```
Admin/Cron → resolveMarket → status=RESOLVED, 24h dispute window →
  finalizeMarket → Winning positions: payout (1% fee) → Losing: close with -PnL
```
**Issues Fixed**: Losing positions now get negative realizedPnl.

### Remaining Financial Concerns
1. **No minimum balance enforcement** — User balance can theoretically go to exactly 0 but floating point could make it slightly negative.
2. **No daily/weekly withdrawal limits** — A compromised account could drain all funds instantly.
3. **No transaction reversal mechanism** — If a trade is disputed, there's no way to reverse it.

---

## 4. Implementation Priority List

### Phase 1: Launch Readiness (1-2 weeks)
| # | Task | Priority | Effort |
|---|------|----------|--------|
| 1 | Add automated tests for trade/deposit/withdraw/resolution | 🔴 P0 | 8h |
| 2 | Add Terms of Service + Privacy Policy pages | 🔴 P0 | 2h |
| 3 | Mobile responsive audit + fixes | 🔴 P0 | 4h |
| 4 | Add NEXTAUTH_SECRET validation on startup | 🔴 P0 | 0.5h |
| 5 | Add CSRF origin checks on state-changing API routes | 🔴 P0 | 2h |
| 6 | Enforce webhook secret presence + fail-closed verification | 🔴 P0 | 2h |
| 7 | Implement chat/message sanitization to prevent stored XSS | 🔴 P0 | 2h |

### Phase 2: User Experience (2-3 weeks)
| # | Task | Priority | Effort |
|---|------|----------|--------|
| 8 | Portfolio dashboard (positions, PnL, trade history) | 🟡 P1 | 6h |
| 9 | User profile page (edit username, avatar) | 🟡 P1 | 4h |
| 10 | Email notifications (trade confirmations, deposits, payouts) | 🟡 P1 | 4h |
| 11 | Transaction history export (CSV) | 🟡 P1 | 2h |
| 12 | Leaderboard (top traders by PnL) | 🟡 P1 | 3h |
| 13 | Market search improvements | 🟡 P1 | 2h |
| 14 | Price alerts / watchlist | 🟡 P1 | 4h |

### Phase 3: Scale & Operations (3-4 weeks)
| # | Task | Priority | Effort |
|---|------|----------|--------|
| 15 | Redis for rate limiting + sessions + idempotency | 🟠 P2 | 6h |
| 16 | Error tracking (Sentry integration) | 🟠 P2 | 2h |
| 17 | Health check endpoint + uptime monitoring | 🟠 P2 | 2h |
| 18 | CI/CD pipeline (GitHub Actions) | 🟠 P2 | 4h |
| 19 | Database backup strategy | 🟠 P2 | 2h |
| 20 | Load testing + capacity planning | 🟠 P2 | 4h |
| 21 | KYC integration (for regulatory compliance) | 🟠 P2 | 8h |
| 22 | Daily/weekly withdrawal limits | 🟠 P2 | 2h |

### Phase 4: Growth Features (4+ weeks)
| # | Task | Priority | Effort |
|---|------|----------|--------|
| 23 | Social login (Google, Apple) | 🔵 P3 | 4h |
| 24 | PWA support (installable app) | 🔵 P3 | 3h |
| 25 | Push notifications | 🔵 P3 | 4h |
| 26 | Referral system | 🔵 P3 | 6h |
| 27 | Multi-language support | 🔵 P3 | 8h |
| 28 | Limit orders + order book | 🔵 P3 | 12h |
| 29 | Non-sports market categories | 🔵 P3 | 4h |
| 30 | Oracle integration for auto-resolution | 🔵 P3 | 8h |

---

## 5. Architecture Notes

### Current Stack
- **Frontend**: Next.js 16 + React + Tailwind CSS + Lucide icons
- **Backend**: Next.js API routes + Prisma ORM
- **Database**: PostgreSQL (via Prisma)
- **Auth**: NextAuth.js (credentials provider)
- **Payments**: Airtel Money + MTN MoMo (Zambia)
- **Real-time**: Server-Sent Events (SSE)
- **Trading**: Custom CPMM (Constant Product Market Maker)

### Key Design Decisions
- Binary markets only (YES/NO outcomes mapped to Home/Away for football)
- DRAW is mapped to YES outcome (home team or draw wins)
- 2% trading fee on all trades, 1.5% withdrawal fee, 1% resolution fee
- 24-hour dispute window before payouts
- Atomic settlement claims prevent double-processing
- In-memory rate limiting (needs Redis for multi-instance)
