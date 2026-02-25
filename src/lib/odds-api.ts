/**
 * The Odds API Integration
 * Fetches real-time bookmaker odds for football matches.
 * Used to auto-populate initial market prices during sync.
 * 
 * API Docs: https://the-odds-api.com/liveapi/guides/v4/
 * Free tier: 500 requests/month
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY || ''
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

// Map football-data.org league codes to The Odds API sport keys
const LEAGUE_TO_SPORT_KEY: Record<string, string> = {
  'PL': 'soccer_epl',
  'PD': 'soccer_spain_la_liga',
  'BL1': 'soccer_germany_bundesliga',
  'SA': 'soccer_italy_serie_a',
  'FL1': 'soccer_france_ligue_one',
  'CL': 'soccer_uefa_champs_league',
}

// Map full competition names to sport keys (for matching by league name)
const LEAGUE_NAME_TO_SPORT_KEY: Record<string, string> = {
  'premier league': 'soccer_epl',
  'la liga': 'soccer_spain_la_liga',
  'primera division': 'soccer_spain_la_liga',
  'bundesliga': 'soccer_germany_bundesliga',
  'serie a': 'soccer_italy_serie_a',
  'ligue 1': 'soccer_france_ligue_one',
  'champions league': 'soccer_uefa_champs_league',
  'uefa champions league': 'soccer_uefa_champs_league',
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
 */
function normalizeProbabilities(home: number, draw: number, away: number): {
  home: number; draw: number; away: number
} {
  const total = home + draw + away
  if (total === 0) return { home: 0.33, draw: 0.33, away: 0.34 }
  
  const rawHome = home / total
  const rawDraw = draw / total
  const rawAway = away / total
  
  // Round to 2 decimals, ensure sum = 1.0
  const h = Math.round(rawHome * 100) / 100
  const d = Math.round(rawDraw * 100) / 100
  const a = Math.round((1 - h - d) * 100) / 100 // Remainder goes to away
  
  return { home: h, draw: d, away: a }
}

/**
 * Fetch odds for all upcoming matches in a given league.
 * Returns normalized implied probabilities averaged across multiple bookmakers.
 * 
 * Costs 1 API credit per call.
 */
export async function fetchOddsForLeague(leagueCode: string): Promise<MatchOdds[]> {
  const sportKey = LEAGUE_TO_SPORT_KEY[leagueCode]
  if (!sportKey) {
    console.warn(`[OddsAPI] No sport key mapping for league code: ${leagueCode}`)
    return []
  }

  if (!ODDS_API_KEY) {
    console.warn('[OddsAPI] API key not configured')
    return []
  }

  return fetchOddsBySportKey(sportKey)
}

/**
 * Fetch odds by league name (e.g., "Premier League", "La Liga").
 */
export async function fetchOddsByLeagueName(leagueName: string): Promise<MatchOdds[]> {
  const normalized = leagueName.toLowerCase().trim()
  const sportKey = LEAGUE_NAME_TO_SPORT_KEY[normalized]
  if (!sportKey) {
    console.warn(`[OddsAPI] No sport key for league name: ${leagueName}`)
    return []
  }
  return fetchOddsBySportKey(sportKey)
}

async function fetchOddsBySportKey(sportKey: string): Promise<MatchOdds[]> {
  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h&oddsFormat=decimal`

  try {
    const response = await fetch(url, { cache: 'no-store' })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[OddsAPI] Failed to fetch odds for ${sportKey}:`, response.status, text)
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

    console.log(`[OddsAPI] Fetched odds for ${results.length} matches (${sportKey})`)
    return results
  } catch (error) {
    console.error(`[OddsAPI] Error fetching odds for ${sportKey}:`, error)
    return []
  }
}

// ─── Team Name Matching ──────────────────────────────────────

// Common aliases between football-data.org and bookmaker names
const TEAM_NAME_ALIASES: Record<string, string[]> = {
  'wolverhampton wanderers': ['wolves', 'wolverhampton'],
  'brighton & hove albion': ['brighton', 'brighton hove'],
  'nottingham forest': ["nott'm forest", 'nottingham', 'notts forest'],
  'west ham united': ['west ham'],
  'newcastle united': ['newcastle'],
  'manchester united': ['man united', 'man utd'],
  'manchester city': ['man city'],
  'tottenham hotspur': ['tottenham', 'spurs'],
  'crystal palace': ['crystal palace'],
  'leicester city': ['leicester'],
  'aston villa': ['aston villa'],
  'sheffield united': ['sheffield utd'],
  'athletic club': ['athletic bilbao', 'ath bilbao'],
  'atletico madrid': ['atletico', 'atl madrid', 'atletico de madrid'],
  'real sociedad': ['real sociedad'],
  'real betis': ['real betis', 'betis'],
  'deportivo alaves': ['alaves'],
  'celta vigo': ['celta'],
  'rayo vallecano': ['rayo'],
  'paris saint-germain': ['paris saint germain', 'psg', 'paris sg'],
  'olympique marseille': ['marseille', 'om'],
  'olympique lyonnais': ['lyon', 'ol'],
  'as monaco': ['monaco'],
  'borussia dortmund': ['dortmund', 'bvb'],
  'bayer leverkusen': ['leverkusen', 'bayer 04'],
  'bayern munich': ['bayern', 'fc bayern', 'bayern munchen'],
  'rb leipzig': ['leipzig', 'rasenballsport leipzig'],
  'eintracht frankfurt': ['frankfurt', 'eintracht'],
  'vfb stuttgart': ['stuttgart'],
  'sc freiburg': ['freiburg'],
  'fc augsburg': ['augsburg'],
  'union berlin': ['union berlin', '1. fc union berlin'],
  'werder bremen': ['bremen', 'werder'],
  'ac milan': ['milan'],
  'inter milan': ['inter', 'internazionale'],
  'as roma': ['roma'],
  'ssc napoli': ['napoli'],
  'juventus': ['juventus', 'juve'],
  'atalanta': ['atalanta bc'],
  'sl benfica': ['benfica'],
  'fc porto': ['porto'],
  'sporting cp': ['sporting', 'sporting lisbon'],
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bfc\b|\bafc\b|\bsc\b|\bcf\b|\bssc\b|\bac\b|\bas\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find the best matching odds for a specific match.
 * Uses fuzzy team name matching to handle differences between data sources.
 */
export function findMatchOdds(
  odds: MatchOdds[],
  homeTeam: string,
  awayTeam: string,
  matchDate?: Date
): MatchOdds | null {
  const homeNorm = normalizeTeamName(homeTeam)
  const awayNorm = normalizeTeamName(awayTeam)

  // Helper: check if two team names match
  function teamsMatch(oddsName: string, dbName: string): boolean {
    const oddsNorm = normalizeTeamName(oddsName)
    const dbNorm = normalizeTeamName(dbName)
    
    // Exact match
    if (oddsNorm === dbNorm) return true
    
    // Partial match (one contains the other)
    if (oddsNorm.includes(dbNorm) || dbNorm.includes(oddsNorm)) return true
    
    // Check aliases
    for (const [canonical, aliases] of Object.entries(TEAM_NAME_ALIASES)) {
      const allNames = [canonical, ...aliases]
      const oddsMatches = allNames.some(a => oddsNorm.includes(a) || a.includes(oddsNorm))
      const dbMatches = allNames.some(a => dbNorm.includes(a) || a.includes(dbNorm))
      if (oddsMatches && dbMatches) return true
    }
    
    // First significant word match (e.g., "Arsenal" matches "Arsenal FC")
    const oddsFirst = oddsNorm.split(' ')[0]
    const dbFirst = dbNorm.split(' ')[0]
    if (oddsFirst.length >= 4 && dbFirst.length >= 4 && oddsFirst === dbFirst) return true
    
    return false
  }

  // Try to find match with both teams matching
  let match = odds.find(o => teamsMatch(o.homeTeam, homeTeam) && teamsMatch(o.awayTeam, awayTeam))

  // Try date-based disambiguation if no match found
  if (!match && matchDate) {
    const dateStr = matchDate.toISOString().slice(0, 10)
    match = odds.find(o => {
      const oddsDate = o.commenceTime.slice(0, 10)
      return oddsDate === dateStr && (
        teamsMatch(o.homeTeam, homeTeam) || teamsMatch(o.awayTeam, awayTeam)
      )
    })
  }

  return match || null
}
