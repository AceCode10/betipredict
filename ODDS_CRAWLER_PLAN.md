# Automated Odds Crawler — Initial Market Pricing

## Objective

Automate the process of setting initial prices for football markets by crawling real-time odds from professional bookmakers. When a market is synced (via cron or manual sync), the system automatically fetches bookmaker odds for that match and pre-fills Home/Draw/Away prices. The Market Maker then reviews and either approves directly or adjusts before approving.

## How It Works

### Current Flow (Manual)
```
Cron syncs match → Market created as PENDING_APPROVAL (33%/33%/33%) → Market Maker manually sets prices → Approve
```

### New Flow (Automated)
```
Cron syncs match → Fetch odds from The Odds API → Convert to implied probabilities → 
Market created as PENDING_APPROVAL with real odds → Market Maker reviews → One-click approve OR adjust
```

## Data Source: The Odds API

### Why The Odds API
- **Free tier**: 500 requests/month (enough for ~15 syncs/day across all leagues)
- **Coverage**: All major European leagues (EPL, La Liga, Bundesliga, Serie A, Ligue 1, Champions League)
- **Data**: Real-time odds from 40+ bookmakers in decimal format
- **Market**: `h2h` (head-to-head / 1X2) — exactly what we need for TRI_OUTCOME
- **Reliability**: Well-maintained, versioned API (v4), used by thousands of apps
- **No scraping needed**: Clean REST API, no browser automation required

### Pricing
| Plan | Requests/Month | Cost |
|------|---------------|------|
| Free | 500 | $0 |
| Starter | 2,500 | ~$20/month |
| Standard | 10,000 | ~$50/month |

**Recommendation**: Start with **Free tier** (500/month). Each sync of one league costs 1 request. With 6 leagues syncing twice daily = 12 requests/day = ~360/month — fits within free tier.

### API Endpoints

**Get Sports List** (free, no quota cost):
```
GET https://api.the-odds-api.com/v4/sports?apiKey=YOUR_KEY
```

**Get Odds for a Sport** (1 credit per region per market):
```
GET https://api.the-odds-api.com/v4/sports/{sport_key}/odds?apiKey=YOUR_KEY&regions=uk&markets=h2h&oddsFormat=decimal
```

### Sport Keys for Our Leagues
| BetiPredict League | The Odds API Sport Key |
|-------------------|----------------------|
| Premier League (PL) | `soccer_epl` |
| La Liga (PD) | `soccer_spain_la_liga` |
| Bundesliga (BL1) | `soccer_germany_bundesliga` |
| Serie A (SA) | `soccer_italy_serie_a` |
| Ligue 1 (FL1) | `soccer_france_ligue_one` |
| Champions League (CL) | `soccer_uefa_champs_league` |

### Sample Response
```json
{
  "id": "abc123",
  "sport_key": "soccer_epl",
  "commence_time": "2025-03-01T15:00:00Z",
  "home_team": "Arsenal",
  "away_team": "Manchester City",
  "bookmakers": [
    {
      "key": "bet365",
      "title": "Bet365",
      "markets": [
        {
          "key": "h2h",
          "outcomes": [
            { "name": "Arsenal", "price": 2.50 },
            { "name": "Manchester City", "price": 2.90 },
            { "name": "Draw", "price": 3.40 }
          ]
        }
      ]
    },
    {
      "key": "williamhill",
      "title": "William Hill",
      "markets": [...]
    }
  ]
}
```

---

## Implementation Plan

### Step 1: Create Odds API Library

Create `src/lib/odds-api.ts`:

```typescript
/**
 * The Odds API Integration
 * Fetches real-time bookmaker odds for football matches.
 * Used to auto-populate initial market prices.
 * 
 * API Docs: https://the-odds-api.com/liveapi/guides/v4/
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || ''
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

// Map our league codes to The Odds API sport keys
const LEAGUE_TO_SPORT_KEY: Record<string, string> = {
  'PL': 'soccer_epl',
  'PD': 'soccer_spain_la_liga',
  'BL1': 'soccer_germany_bundesliga',
  'SA': 'soccer_italy_serie_a',
  'FL1': 'soccer_france_ligue_one',
  'CL': 'soccer_uefa_champs_league',
}

export function isOddsApiConfigured(): boolean {
  return !!ODDS_API_KEY
}

export interface MatchOdds {
  eventId: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
  homePrice: number   // Implied probability (0-1)
  drawPrice: number   // Implied probability (0-1)
  awayPrice: number   // Implied probability (0-1)
  homeDecimal: number // Raw decimal odds
  drawDecimal: number
  awayDecimal: number
  bookmakerCount: number
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Convert decimal odds to implied probability.
 * Decimal 2.50 → 1/2.50 = 0.40 (40%)
 */
function decimalToImplied(decimal: number): number {
  if (decimal <= 1) return 1
  return 1 / decimal
}

/**
 * Normalize probabilities so they sum to exactly 1.0.
 * Raw implied probabilities from bookmakers include the overround (margin).
 * Example: Home 40% + Draw 30% + Away 35% = 105% → normalize to 100%
 */
function normalizeProbabilities(home: number, draw: number, away: number): {
  home: number; draw: number; away: number
} {
  const total = home + draw + away
  if (total === 0) return { home: 0.33, draw: 0.33, away: 0.34 }
  return {
    home: Math.round((home / total) * 100) / 100,
    draw: Math.round((draw / total) * 100) / 100,
    away: Math.round((away / total) * 100) / 100,
  }
}

/**
 * Fetch odds for all upcoming matches in a given league.
 * Returns normalized implied probabilities averaged across multiple bookmakers.
 */
export async function fetchOddsForLeague(leagueCode: string): Promise<MatchOdds[]> {
  const sportKey = LEAGUE_TO_SPORT_KEY[leagueCode]
  if (!sportKey) {
    console.warn(`[OddsAPI] No sport key mapping for league: ${leagueCode}`)
    return []
  }

  if (!ODDS_API_KEY) {
    console.warn('[OddsAPI] API key not configured')
    return []
  }

  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&oddsFormat=decimal`

  try {
    const response = await fetch(url)
    
    if (!response.ok) {
      const text = await response.text()
      console.error(`[OddsAPI] Failed to fetch odds for ${leagueCode}:`, response.status, text)
      return []
    }

    // Log remaining quota
    const remaining = response.headers.get('x-requests-remaining')
    const used = response.headers.get('x-requests-used')
    console.log(`[OddsAPI] Quota: ${used} used, ${remaining} remaining`)

    const events = await response.json()
    const results: MatchOdds[] = []

    for (const event of events) {
      if (!event.bookmakers || event.bookmakers.length === 0) continue

      // Average odds across all bookmakers for robustness
      let totalHome = 0, totalDraw = 0, totalAway = 0
      let count = 0

      for (const bookmaker of event.bookmakers) {
        const h2hMarket = bookmaker.markets?.find((m: any) => m.key === 'h2h')
        if (!h2hMarket?.outcomes) continue

        const homeOutcome = h2hMarket.outcomes.find((o: any) => o.name === event.home_team)
        const awayOutcome = h2hMarket.outcomes.find((o: any) => o.name === event.away_team)
        const drawOutcome = h2hMarket.outcomes.find((o: any) => o.name === 'Draw')

        if (homeOutcome && awayOutcome && drawOutcome) {
          totalHome += homeOutcome.price
          totalDraw += drawOutcome.price
          totalAway += awayOutcome.price
          count++
        }
      }

      if (count === 0) continue

      const avgHomeDecimal = totalHome / count
      const avgDrawDecimal = totalDraw / count
      const avgAwayDecimal = totalAway / count

      // Convert to implied probabilities and normalize
      const rawHome = decimalToImplied(avgHomeDecimal)
      const rawDraw = decimalToImplied(avgDrawDecimal)
      const rawAway = decimalToImplied(avgAwayDecimal)
      const normalized = normalizeProbabilities(rawHome, rawDraw, rawAway)

      results.push({
        eventId: event.id,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        commenceTime: event.commence_time,
        homePrice: normalized.home,
        drawPrice: normalized.draw,
        awayPrice: normalized.away,
        homeDecimal: Math.round(avgHomeDecimal * 100) / 100,
        drawDecimal: Math.round(avgDrawDecimal * 100) / 100,
        awayDecimal: Math.round(avgAwayDecimal * 100) / 100,
        bookmakerCount: count,
        confidence: count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low',
      })
    }

    console.log(`[OddsAPI] Fetched odds for ${results.length} matches in ${leagueCode}`)
    return results
  } catch (error) {
    console.error(`[OddsAPI] Error fetching odds for ${leagueCode}:`, error)
    return []
  }
}

/**
 * Find the best matching odds for a specific match.
 * Uses fuzzy team name matching to handle differences between
 * football-data.org names and bookmaker names.
 */
export function findMatchOdds(
  odds: MatchOdds[],
  homeTeam: string,
  awayTeam: string,
  matchDate?: Date
): MatchOdds | null {
  const normalize = (s: string) => s.toLowerCase()
    .replace(/fc|afc|sc|cf|ssc/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  const homeNorm = normalize(homeTeam)
  const awayNorm = normalize(awayTeam)

  // Try exact match first
  let match = odds.find(o =>
    normalize(o.homeTeam) === homeNorm && normalize(o.awayTeam) === awayNorm
  )

  // Try partial match (one team name contains the other)
  if (!match) {
    match = odds.find(o =>
      (normalize(o.homeTeam).includes(homeNorm) || homeNorm.includes(normalize(o.homeTeam))) &&
      (normalize(o.awayTeam).includes(awayNorm) || awayNorm.includes(normalize(o.awayTeam)))
    )
  }

  // Try date-based match if multiple candidates
  if (!match && matchDate) {
    const dateStr = matchDate.toISOString().slice(0, 10)
    match = odds.find(o => {
      const oddsDate = o.commenceTime.slice(0, 10)
      return oddsDate === dateStr && (
        normalize(o.homeTeam).includes(homeNorm.split(' ')[0]) ||
        homeNorm.includes(normalize(o.homeTeam).split(' ')[0])
      )
    })
  }

  return match || null
}
```

### Step 2: Integrate Into Sync-Games Cron

Modify `src/app/api/cron/sync-games/route.ts` to fetch odds:

```typescript
// Add at the top:
import { fetchOddsForLeague, findMatchOdds, isOddsApiConfigured } from '@/lib/odds-api'

// Inside the sync loop, before creating markets:
let leagueOdds: MatchOdds[] = []
if (isOddsApiConfigured()) {
  // Fetch odds once per league (1 API credit per league)
  leagueOdds = await fetchOddsForLeague(league)
}

// When creating each market, look up the odds:
const matchOdds = findMatchOdds(leagueOdds, homeShort, awayShort, matchDate)

const initialHome = matchOdds?.homePrice ?? 0.33
const initialDraw = matchOdds?.drawPrice ?? 0.33
const initialAway = matchOdds?.awayPrice ?? 0.34

const newMarket = await tx.market.create({
  data: {
    title,
    category: 'Football',
    // ... other fields ...
    yesPrice: initialHome,     // Home win probability
    noPrice: initialAway,      // Away win probability
    drawPrice: initialDraw,    // Draw probability
    // Store odds metadata for Market Maker reference
    metadata: JSON.stringify({
      oddsSource: matchOdds ? 'the-odds-api' : 'default',
      bookmakerCount: matchOdds?.bookmakerCount || 0,
      confidence: matchOdds?.confidence || 'none',
      decimalOdds: matchOdds ? {
        home: matchOdds.homeDecimal,
        draw: matchOdds.drawDecimal,
        away: matchOdds.awayDecimal,
      } : null,
      fetchedAt: new Date().toISOString(),
    }),
  }
})
```

### Step 3: Update Market Maker UI to Show Odds Source

In the Pending Markets tab, show the Market Maker where the prices came from:

```tsx
// In market-maker/page.tsx, inside the pending market card:
{market.metadata && (() => {
  try {
    const meta = JSON.parse(market.metadata)
    if (meta.oddsSource === 'the-odds-api') {
      return (
        <div className="flex items-center gap-1 text-xs text-green-400 mt-1">
          <span>Odds from {meta.bookmakerCount} bookmakers</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            meta.confidence === 'high' ? 'bg-green-500/20 text-green-400' :
            meta.confidence === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {meta.confidence}
          </span>
          {meta.decimalOdds && (
            <span className="text-gray-500 ml-1">
              ({meta.decimalOdds.home} / {meta.decimalOdds.draw} / {meta.decimalOdds.away})
            </span>
          )}
        </div>
      )
    }
    return <span className="text-xs text-gray-500">Default pricing — no odds data</span>
  } catch { return null }
})()}
```

### Step 4: Add Manual Odds Refresh

Add a button in the Market Maker pending tab to manually refresh odds for a specific market:

```typescript
// New API action in market-maker route:
if (action === 'refresh-odds') {
  const { marketId } = body
  const market = await prisma.market.findUnique({ where: { id: marketId } })
  if (!market) return NextResponse.json({ error: 'Market not found' }, { status: 404 })

  const leagueCode = detectLeagueCode(market.league || market.subcategory || '')
  if (!leagueCode) return NextResponse.json({ error: 'Cannot determine league' }, { status: 400 })

  const odds = await fetchOddsForLeague(leagueCode)
  const matchOdds = findMatchOdds(odds, market.homeTeam || '', market.awayTeam || '')

  if (!matchOdds) {
    return NextResponse.json({ error: 'No odds found for this match', odds: null })
  }

  // Update market with fresh odds
  await prisma.market.update({
    where: { id: marketId },
    data: {
      yesPrice: matchOdds.homePrice,
      drawPrice: matchOdds.drawPrice,
      noPrice: matchOdds.awayPrice,
    }
  })

  return NextResponse.json({
    message: 'Odds refreshed',
    odds: matchOdds,
    prices: {
      home: Math.round(matchOdds.homePrice * 100),
      draw: Math.round(matchOdds.drawPrice * 100),
      away: Math.round(matchOdds.awayPrice * 100),
    }
  })
}
```

### Step 5: Environment Setup

Add to `.env.local`:
```env
# The Odds API — Free tier: 500 requests/month
# Sign up at: https://the-odds-api.com/
ODDS_API_KEY=your_api_key_here
```

---

## Team Name Matching Strategy

The biggest challenge is matching team names between football-data.org (our match source) and The Odds API (our odds source). They often differ:

| football-data.org | The Odds API |
|-------------------|-------------|
| Arsenal FC | Arsenal |
| Manchester City FC | Manchester City |
| FC Barcelona | Barcelona |
| Borussia Dortmund | Dortmund |
| Paris Saint-Germain | Paris Saint Germain |

The `findMatchOdds` function handles this with:
1. **Strip common suffixes**: FC, AFC, SC, CF, SSC
2. **Normalize whitespace**: collapse multiple spaces
3. **Partial matching**: "Arsenal" matches "Arsenal FC"
4. **Date fallback**: If team name matching is ambiguous, use match date to disambiguate

For rare edge cases, we could add a manual mapping table:
```typescript
const TEAM_NAME_MAP: Record<string, string> = {
  'Wolverhampton Wanderers': 'Wolves',
  'Brighton & Hove Albion': 'Brighton',
  'Nottingham Forest': "Nott'm Forest",
  // Add as discovered
}
```

---

## Quota Management

### Free Tier Budget (500/month)
- 6 leagues × 2 syncs/day × 30 days = 360 requests/month
- Leaves 140 for manual refreshes (~4-5/day)

### Optimization Strategies
1. **Cache odds locally**: Store fetched odds in memory/DB with 15-min TTL
2. **Batch by league**: One API call returns ALL matches for a league (not per-match)
3. **Skip off-season leagues**: Don't fetch odds for leagues not currently playing
4. **Fallback gracefully**: If quota exhausted, fall back to 33/33/34 defaults

---

## Market Maker Workflow After Integration

### Before (Current)
1. See 20 pending markets all at 33/33/33
2. Manually research each match
3. Type in prices for each one
4. Click approve for each one

### After (With Odds Crawler)
1. See 20 pending markets with pre-filled bookmaker odds
2. Quick scan: green "high confidence" badges on most
3. One-click approve for matches with high-confidence odds
4. Adjust 2-3 matches where you disagree with bookmaker consensus
5. **Time savings**: ~80% reduction in manual pricing work**

---

## Risk Considerations

| Risk | Mitigation |
|------|-----------|
| Odds API downtime | Graceful fallback to 33/33/34 defaults |
| Wrong team matching | Confidence indicator shows when match is uncertain |
| Stale odds (fetched hours before match) | Manual refresh button; auto-refresh on approve |
| API quota exceeded | Track remaining quota; alert admin when low |
| Bookmaker odds are manipulated | Average across 5+ bookmakers reduces manipulation risk |

---

## Files to Create/Modify

### New Files
1. `src/lib/odds-api.ts` — Odds API client library with team matching

### Modified Files
1. `src/app/api/cron/sync-games/route.ts` — Fetch odds during sync
2. `src/app/api/market-maker/route.ts` — Add `refresh-odds` action
3. `src/app/market-maker/page.tsx` — Show odds source/confidence badges, refresh button
4. `.env.local` — Add `ODDS_API_KEY`

---

## Implementation Timeline

| Day | Task |
|-----|------|
| 1 | Sign up for The Odds API, get free key, test endpoints |
| 2 | Create `src/lib/odds-api.ts` with fetch + team matching |
| 3 | Integrate into cron sync-games route |
| 4 | Update Market Maker UI: odds badges, one-click approve |
| 5 | Add manual refresh-odds action, test end-to-end |
| **Total** | **~5 days** |
