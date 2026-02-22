// Optimized football-data.org API usage for MVP
// Maximizes efficiency with 10 calls/minute free tier limit

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || ''
const BASE_URL = 'https://api.football-data.org/v4'

// Rate limiting: 10 calls per minute = 1 call every 6 seconds
const RATE_LIMIT_DELAY = 6000 // 6 seconds between calls
let lastCallTime = 0

async function respectRateLimit(): Promise<void> {
  const now = Date.now()
  const timeSinceLastCall = now - lastCallTime
  
  if (timeSinceLastCall < RATE_LIMIT_DELAY) {
    const waitTime = RATE_LIMIT_DELAY - timeSinceLastCall
    console.log(`[sports-api] Rate limiting: waiting ${waitTime}ms`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  
  lastCallTime = Date.now()
}

async function fetchFromAPI(endpoint: string): Promise<any> {
  if (!FOOTBALL_DATA_API_KEY) {
    throw new Error('FOOTBALL_DATA_API_KEY not configured')
  }

  await respectRateLimit()

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY },
    cache: 'no-store'
  })

  if (!response.ok) {
    if (response.status === 429) {
      console.error('[sports-api] Rate limit exceeded, backing off...')
      await new Promise(resolve => setTimeout(resolve, 60000)) // Wait 1 minute
      throw new Error('Rate limit exceeded')
    }
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

// Get live matches efficiently (1 call)
export async function getLiveMatchesOptimized(): Promise<any[]> {
  try {
    const data = await fetchFromAPI('/matches?status=IN_PLAY')
    return data.matches || []
  } catch (error) {
    console.error('[sports-api] Error fetching live matches:', error)
    return []
  }
}

// Batch check multiple matches with smart batching
export async function checkMatchesForResolution(matchIds: number[]): Promise<{
  matchId: number
  isFinished: boolean
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
  finalScore: { home: number; away: number } | null
}[]> {
  const results = []
  const batchSize = 8 // Stay well under 10 calls/minute limit
  
  for (let i = 0; i < matchIds.length; i += batchSize) {
    const batch = matchIds.slice(i, i + batchSize)
    console.log(`[sports-api] Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.length} matches`)
    
    for (const matchId of batch) {
      try {
        const result = await getMatchStatusOptimized(matchId)
        results.push(result)
      } catch (error) {
        console.error(`[sports-api] Failed to check match ${matchId}:`, error)
        results.push({
          matchId,
          isFinished: false,
          winner: null,
          finalScore: null
        })
      }
    }
    
    // If we have more batches, wait before continuing
    if (i + batchSize < matchIds.length) {
      console.log(`[sports-api] Batch completed, waiting before next batch...`)
      await new Promise(resolve => setTimeout(resolve, 30000)) // 30 second break between batches
    }
  }
  
  return results
}

// Get match status with caching
const matchStatusCache = new Map<number, { data: any; timestamp: number }>()
const CACHE_DURATION = 2 * 60 * 1000 // 2 minutes

async function getMatchStatusOptimized(matchId: number): Promise<{
  matchId: number
  isFinished: boolean
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
  finalScore: { home: number; away: number } | null
}> {
  // Check cache first
  const cached = matchStatusCache.get(matchId)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    const data = cached.data
    return {
      matchId,
      isFinished: data.status === 'FINISHED',
      winner: data.score?.winner || null,
      finalScore: data.score?.fullTime?.home !== null ? {
        home: data.score.fullTime.home,
        away: data.score.fullTime.away
      } : null
    }
  }

  // Fetch fresh data
  const data = await fetchFromAPI(`/matches/${matchId}`)
  
  // Cache the result
  matchStatusCache.set(matchId, { data, timestamp: Date.now() })
  
  // Clean old cache entries
  for (const [key, value] of matchStatusCache.entries()) {
    if (Date.now() - value.timestamp > CACHE_DURATION * 2) {
      matchStatusCache.delete(key)
    }
  }

  return {
    matchId,
    isFinished: data.status === 'FINISHED',
    winner: data.score?.winner || null,
    finalScore: data.score?.fullTime?.home !== null ? {
      home: data.score.fullTime.home,
      away: data.score.fullTime.away
    } : null
  }
}

// Smart scheduling: only check matches likely to finish soon
export async function getMatchesToCheckNow(): Promise<number[]> {
  try {
    // Get live matches first (1 call)
    const liveMatches = await getLiveMatchesOptimized()
    
    // Filter matches that have been running for a while (likely to finish soon)
    const now = new Date()
    const matchesToCheck = []
    
    for (const match of liveMatches) {
      const matchTime = new Date(match.utcDate)
      const minutesElapsed = (now.getTime() - matchTime.getTime()) / (1000 * 60)
      
      // Only check matches that have been running for at least 60 minutes
      // (most football matches are 90 minutes + stoppage)
      if (minutesElapsed >= 60) {
        matchesToCheck.push(match.id)
      }
    }
    
    console.log(`[sports-api] Found ${liveMatches.length} live matches, ${matchesToCheck.length} eligible for resolution check`)
    return matchesToCheck
  } catch (error) {
    console.error('[sports-api] Error getting matches to check:', error)
    return []
  }
}

// Get finished matches from today for verification (1 call)
export async function getTodayFinishedMatches(): Promise<any[]> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const data = await fetchFromAPI(`/matches?status=FINISHED&dateFrom=${today}&dateTo=${today}`)
    return data.matches || []
  } catch (error) {
    console.error('[sports-api] Error fetching finished matches:', error)
    return []
  }
}
