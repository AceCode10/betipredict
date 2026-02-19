// Football-data.org API integration
// Free tier: 10 requests/minute, access to top leagues

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || ''
const BASE_URL = 'https://api.football-data.org/v4'

// Competition codes for free tier
export const COMPETITIONS = {
  PL: { code: 'PL', name: 'Premier League', country: 'England' },
  BL1: { code: 'BL1', name: 'Bundesliga', country: 'Germany' },
  SA: { code: 'SA', name: 'Serie A', country: 'Italy' },
  PD: { code: 'PD', name: 'La Liga', country: 'Spain' },
  FL1: { code: 'FL1', name: 'Ligue 1', country: 'France' },
  CL: { code: 'CL', name: 'Champions League', country: 'Europe' },
  EC: { code: 'EC', name: 'European Championship', country: 'Europe' },
  WC: { code: 'WC', name: 'World Cup', country: 'World' },
} as const

export type CompetitionCode = keyof typeof COMPETITIONS

export interface Match {
  id: number
  competition: {
    id: number
    name: string
    code: string
    emblem: string
  }
  homeTeam: {
    id: number
    name: string
    shortName: string
    crest: string
  }
  awayTeam: {
    id: number
    name: string
    shortName: string
    crest: string
  }
  utcDate: string
  status: 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED' | 'AWARDED'
  matchday: number
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
    fullTime: {
      home: number | null
      away: number | null
    }
    halfTime: {
      home: number | null
      away: number | null
    }
  }
}

interface MatchesResponse {
  matches: Match[]
  resultSet: {
    count: number
    competitions: string
    first: string
    last: string
    played: number
  }
}

async function fetchFromAPI(endpoint: string): Promise<any> {
  if (!FOOTBALL_DATA_API_KEY) {
    console.error('FOOTBALL_DATA_API_KEY is not set')
    throw new Error('Football API key not configured')
  }

  const url = `${BASE_URL}${endpoint}`
  console.log(`[sports-api] Fetching: ${url}`)

  const response = await fetch(url, {
    headers: {
      'X-Auth-Token': FOOTBALL_DATA_API_KEY,
    },
    cache: 'no-store', // Always fetch fresh in route handlers
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.error(`[sports-api] Error ${response.status}: ${text}`)
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again in a minute.')
    }
    throw new Error(`Football API error: ${response.status} - ${text}`)
  }

  return response.json()
}

// Get upcoming matches for a competition
export async function getUpcomingMatches(
  competitionCode: CompetitionCode = 'PL',
  limit: number = 20
): Promise<Match[]> {
  try {
    // Use SCHEDULED,TIMED to get upcoming matches (free tier)
    const dateFrom = new Date().toISOString().split('T')[0]
    const dateTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const data: MatchesResponse = await fetchFromAPI(
      `/competitions/${competitionCode}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED,TIMED`
    )
    return (data.matches || []).slice(0, limit)
  } catch (error) {
    console.error('Error fetching upcoming matches:', error)
    return []
  }
}

// Free-tier competition codes
const FREE_TIER_COMPS: CompetitionCode[] = ['PL', 'BL1', 'SA', 'PD', 'FL1', 'CL']

// Get all scheduled matches across multiple competitions (free tier compatible)
export async function getAllUpcomingMatches(limit: number = 50): Promise<Match[]> {
  try {
    // Fetch from each competition individually (free tier doesn't support global /matches)
    const results = await Promise.allSettled(
      FREE_TIER_COMPS.map(code => getUpcomingMatches(code, 10))
    )
    
    const allMatches: Match[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allMatches.push(...result.value)
      }
    }
    
    // Sort by date and limit
    allMatches.sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
    return allMatches.slice(0, limit)
  } catch (error) {
    console.error('Error fetching all upcoming matches:', error)
    return []
  }
}

// Get live matches
export async function getLiveMatches(): Promise<Match[]> {
  try {
    const data: MatchesResponse = await fetchFromAPI('/matches?status=IN_PLAY')
    return data.matches || []
  } catch (error) {
    console.error('Error fetching live matches:', error)
    return []
  }
}

// Get match by ID
export async function getMatchById(matchId: number): Promise<Match | null> {
  try {
    const data = await fetchFromAPI(`/matches/${matchId}`)
    return data
  } catch (error) {
    console.error('Error fetching match:', error)
    return null
  }
}

// Get finished matches (for result verification)
export async function getFinishedMatches(
  competitionCode: CompetitionCode = 'PL',
  limit: number = 20
): Promise<Match[]> {
  try {
    const data: MatchesResponse = await fetchFromAPI(
      `/competitions/${competitionCode}/matches?status=FINISHED&limit=${limit}`
    )
    return data.matches || []
  } catch (error) {
    console.error('Error fetching finished matches:', error)
    return []
  }
}

// Generate market question from match
export function generateMatchQuestion(match: Match): string {
  return `Who will win: ${match.homeTeam.name} vs ${match.awayTeam.name}?`
}

// Generate market title from match
export function generateMatchTitle(match: Match): string {
  const date = new Date(match.utcDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
  return `${match.homeTeam.shortName || match.homeTeam.name} vs ${match.awayTeam.shortName || match.awayTeam.name} - ${date}`
}
