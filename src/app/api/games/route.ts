import { NextRequest, NextResponse } from 'next/server'
import { getUpcomingMatches, getAllUpcomingMatches, COMPETITIONS, CompetitionCode } from '@/lib/sports-api'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const competition = searchParams.get('competition') as CompetitionCode | null
    const limit = parseInt(searchParams.get('limit') || '20')

    let matches
    if (competition && COMPETITIONS[competition]) {
      matches = await getUpcomingMatches(competition, limit)
    } else {
      matches = await getAllUpcomingMatches(limit)
    }

    // Transform to a simpler format for the frontend
    const games = matches.map(match => ({
      id: match.id,
      competition: match.competition.name,
      competitionCode: match.competition.code,
      competitionEmblem: match.competition.emblem,
      homeTeam: match.homeTeam.name,
      homeTeamShort: match.homeTeam.shortName,
      homeTeamCrest: match.homeTeam.crest,
      awayTeam: match.awayTeam.name,
      awayTeamShort: match.awayTeam.shortName,
      awayTeamCrest: match.awayTeam.crest,
      utcDate: match.utcDate,
      matchday: match.matchday,
      status: match.status,
    }))

    return NextResponse.json({
      games,
      competitions: Object.values(COMPETITIONS),
    })
  } catch (error) {
    console.error('Error fetching games:', error)
    return NextResponse.json(
      { error: 'Failed to fetch games', games: [], competitions: Object.values(COMPETITIONS) },
      { status: 500 }
    )
  }
}
