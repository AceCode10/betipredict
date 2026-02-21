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

#### P0 — Critical for Production
1. **No automated test suite** — No unit/integration/e2e coverage for trading, payments, and finalization paths
2. **No KYC/identity verification** — Required for regulated financial operations
3. **Notification delivery provider not wired** — Email templates exist, but production SMTP/provider integration still needs setup
4. **No formal UAT checklist execution evidence** — Responsive improvements were implemented, but full cross-device QA signoff is still manual

#### P1 — Product/UX Gaps
1. **No true 3-way market settlement for draw outcomes** — UI shows DRAW for match-winner cards, but settlement model remains binary YES/NO
2. **No limit orders/order book** — Market orders only
3. **No referral/growth loop** — No referral rewards or invite program

#### P2 — Scale & Operations
1. **In-memory rate limit/idempotency state** — Not safe across multi-instance/serverless scale without Redis
2. **No Sentry (or equivalent) error tracking** — Limited production observability
3. **No CI/CD quality gates** — Build/test/deploy checks not enforced in PR pipeline
4. **No documented backup/restore runbook** — Database recovery process should be formalized
5. **No load/performance benchmark** — Throughput limits unknown under peak concurrency

#### P3 — Nice to Have
1. **No social login** (Google/Apple)
2. **No PWA installability**
3. **No push notifications**
4. **No multi-language support**
5. **No oracle backstop for edge-case auto-resolution failures**

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
| Role model is env-driven admin emails (no DB RBAC) | 🟡 High | Move to DB-backed roles/permissions with auditability |
| In-memory rate limit/idempotency can be bypassed at scale | 🟡 High | Move state to Redis with distributed locks |
| No MFA for admin/high-risk actions | 🟢 Medium | Add TOTP or WebAuthn for admin accounts |
| No session invalidation on password change | 🟢 Medium | Revoke active sessions/tokens on reset/change |

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
1. **No automated regression tests for settlement invariants** — payout/refund correctness depends on manual checks.
2. **Binary market model with DRAW displayed in UI** — product semantics should be made explicit to users, or move to true 3-outcome market model.
3. **No emergency ledger reconciliation dashboard** — finance/admin runbook tooling should be expanded.

---

## 4. Implementation Priority List

### Phase 1: Production Hardening (1-2 weeks)
| # | Task | Priority | Effort |
|---|------|----------|--------|
| 1 | Add automated tests for trade/deposit/withdraw/finalization flows | 🔴 P0 | 10h |
| 2 | Integrate production email provider (SMTP/Resend/Postmark) | 🔴 P0 | 3h |
| 3 | Execute full UAT checklist (desktop + iOS + Android) and log evidence | � P0 | 4h |
| 4 | Clarify DRAW semantics in UI copy (or disable DRAW button for binary markets) | � P0 | 2h |

### Phase 2: Platform Reliability (2-3 weeks)
| # | Task | Priority | Effort |
|---|------|----------|--------|
| 5 | Redis for rate limiting/idempotency/distributed locks | 🟠 P2 | 6h |
| 6 | Sentry integration + alert routing | 🟠 P2 | 2h |
| 7 | CI pipeline: lint, build, migration checks | 🟠 P2 | 4h |
| 8 | Backup/restore runbook + disaster recovery drill | 🟠 P2 | 3h |
| 9 | Load test (k6/Artillery) with defined SLO thresholds | 🟠 P2 | 4h |

### Phase 3: Compliance & Growth (3-6 weeks)
| # | Task | Priority | Effort |
|---|------|----------|--------|
| 10 | KYC integration (provider + verification workflow) | � P2 | 8h |
| 11 | DB-backed RBAC for admin operations | � P1 | 5h |
| 12 | Limit orders + order book | 🔵 P3 | 12h |
| 13 | Referral system | 🔵 P3 | 6h |
| 14 | Push notifications + PWA | 🔵 P3 | 7h |

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
