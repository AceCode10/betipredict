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
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'X-Auth-Token': FOOTBALL_DATA_API_KEY,
    },
    next: { revalidate: 300 }, // Cache for 5 minutes
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again in a minute.')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

// Get upcoming matches for a competition
export async function getUpcomingMatches(
  competitionCode: CompetitionCode = 'PL',
  limit: number = 20
): Promise<Match[]> {
  try {
    const data: MatchesResponse = await fetchFromAPI(
      `/competitions/${competitionCode}/matches?status=SCHEDULED&limit=${limit}`
    )
    return data.matches || []
  } catch (error) {
    console.error('Error fetching upcoming matches:', error)
    return []
  }
}

// Get all scheduled matches across multiple competitions
export async function getAllUpcomingMatches(limit: number = 50): Promise<Match[]> {
  try {
    // Get next 14 days of matches
    const dateFrom = new Date().toISOString().split('T')[0]
    const dateTo = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    const data: MatchesResponse = await fetchFromAPI(
      `/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED`
    )
    return (data.matches || []).slice(0, limit)
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
