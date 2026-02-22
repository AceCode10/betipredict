// Real-time sports API integration
// Replaces football-data.org for immediate match resolution

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || ''
const BASE_URL = 'https://v3.football.api-sports.io'

interface RealtimeMatch {
  fixture: {
    id: number
    status: {
      long: string
      short: string
      elapsed: number | null
    }
    venue: {
      name: string
      city: string
    }
    date: string
    referee: string | null
    teams: {
      home: {
        id: number
        name: string
        logo: string
      }
      away: {
        id: number
        name: string
        logo: string
      }
    }
    goals: {
      home: number | null
      away: number | null
    }
    score: {
      halftime: {
        home: number | null
        away: number | null
      }
      fulltime: {
        home: number | null
        away: number | null
      }
      extratime: {
        home: number | null
        away: number | null
      }
      penalty: {
        home: number | null
        away: number | null
      }
    }
  }
}

async function fetchFromRealtimeAPI(endpoint: string): Promise<any> {
  if (!API_FOOTBALL_KEY) {
    throw new Error('API_FOOTBALL_KEY not configured')
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'x-rapidapi-key': API_FOOTBALL_KEY,
      'x-rapidapi-host': 'v3.football.api-sports.io'
    },
    cache: 'no-store'
  })

  if (!response.ok) {
    throw new Error(`Real-time API error: ${response.status}`)
  }

  return response.json()
}

// Get live matches with real-time status
export async function getRealtimeLiveMatches(): Promise<RealtimeMatch[]> {
  try {
    const data = await fetchFromRealtimeAPI('/fixtures?live=all')
    return data.response || []
  } catch (error) {
    console.error('Error fetching live matches:', error)
    return []
  }
}

// Get specific match status for immediate resolution
export async function getMatchStatusRealtime(matchId: number): Promise<{
  isFinished: boolean
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
  finalScore: { home: number; away: number } | null
}> {
  try {
    const data = await fetchFromRealtimeAPI(`/fixtures?id=${matchId}`)
    const match: RealtimeMatch = data.response?.[0]
    
    if (!match) {
      return { isFinished: false, winner: null, finalScore: null }
    }

    const isFinished = match.fixture.status.long === 'Match Finished' || 
                     match.fixture.status.short === 'FT'
    
    let winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null = null
    let finalScore: { home: number; away: number } | null = null

    if (isFinished && match.fixture.goals.home !== null && match.fixture.goals.away !== null) {
      finalScore = { home: match.fixture.goals.home, away: match.fixture.goals.away }
      
      if (match.fixture.goals.home > match.fixture.goals.away) {
        winner = 'HOME_TEAM'
      } else if (match.fixture.goals.away > match.fixture.goals.home) {
        winner = 'AWAY_TEAM'
      } else {
        winner = 'DRAW'
      }
    }

    return { isFinished, winner, finalScore }
  } catch (error) {
    console.error(`Error fetching match ${matchId}:`, error)
    return { isFinished: false, winner: null, finalScore: null }
  }
}

// Check multiple matches for batch resolution
export async function checkMatchesForResolution(matchIds: number[]): Promise<{
  matchId: number
  isFinished: boolean
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
}[]> {
  const results = []
  
  for (const matchId of matchIds) {
    try {
      const status = await getMatchStatusRealtime(matchId)
      results.push({
        matchId,
        isFinished: status.isFinished,
        winner: status.winner
      })
    } catch (error) {
      console.error(`Failed to check match ${matchId}:`, error)
      results.push({
        matchId,
        isFinished: false,
        winner: null
      })
    }
  }
  
  return results
}
