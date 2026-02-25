import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMatchesForLeagues, FREE_TIER_COMPS, type CompetitionCode } from '@/lib/sports-api'
import crypto from 'crypto'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

// Admin sync now creates markets as PENDING_APPROVAL (Market Maker must set prices)
// Accepts optional ?league=PL to sync a single league and avoid timeout
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = ADMIN_EMAILS.includes(session.user.email.toLowerCase())
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Accept league param from body or query
    let leagueParam: string | null = null
    try {
      const body = await request.json()
      leagueParam = body?.league || null
    } catch {}
    if (!leagueParam) {
      leagueParam = new URL(request.url).searchParams.get('league')
    }

    // Determine which leagues to sync
    const leagues: CompetitionCode[] = leagueParam && FREE_TIER_COMPS.includes(leagueParam as CompetitionCode)
      ? [leagueParam as CompetitionCode]
      : FREE_TIER_COMPS.slice(0, 2) // Default: first 2 leagues to avoid timeout

    const results: { created: number; skipped: number; errors: string[]; leagues: string[] } = {
      created: 0,
      skipped: 0,
      errors: [],
      leagues,
    }

    const matches = await getMatchesForLeagues(leagues, 14)

    if (!matches || matches.length === 0) {
      return NextResponse.json({ message: 'No upcoming matches found', ...results })
    }

    let systemUser = await prisma.user.findFirst({ where: { email: 'system@betipredict.com' } })
    if (!systemUser) {
      systemUser = await prisma.user.create({
        data: {
          email: 'system@betipredict.com',
          username: 'BetiPredict',
          fullName: 'BetiPredict System',
          password: crypto.randomBytes(32).toString('hex'),
          isVerified: true,
          balance: 0,
        }
      })
    }

    for (const match of matches) {
      try {
        const existingGame = await prisma.scheduledGame.findUnique({
          where: { externalId: match.id },
          include: { market: { select: { id: true, status: true } } }
        })

        if (existingGame?.marketId && existingGame.market) {
          if (['PENDING_APPROVAL', 'ACTIVE', 'RESOLVED', 'FINALIZING'].includes(existingGame.market.status)) {
            results.skipped++
            continue
          }
        }

        const matchDate = new Date(match.utcDate)
        if (matchDate <= new Date(Date.now() + 60 * 60 * 1000)) {
          results.skipped++
          continue
        }

        const homeShort = match.homeTeam.shortName || match.homeTeam.name
        const awayShort = match.awayTeam.shortName || match.awayTeam.name
        const title = `${homeShort} vs ${awayShort}`
        const question = `Who will win: ${match.homeTeam.name} vs ${match.awayTeam.name}?`

        await prisma.$transaction(async (tx) => {
          const newMarket = await tx.market.create({
            data: {
              title,
              description: `${match.competition.name} - Matchday ${match.matchday || 'N/A'}`,
              category: 'Sports',
              subcategory: match.competition.name,
              question,
              resolveTime: matchDate,
              creatorId: systemUser!.id,
              status: 'PENDING_APPROVAL',
              marketType: 'TRI_OUTCOME',
              pricingEngine: 'CLOB',
              yesPrice: 0.33,
              noPrice: 0.33,
              drawPrice: 0.33,
              liquidity: 0,
              volume: 0,
              homeTeam: homeShort,
              awayTeam: awayShort,
              league: match.competition.name,
            }
          })

          if (existingGame) {
            await tx.scheduledGame.update({
              where: { id: existingGame.id },
              data: { marketId: newMarket.id }
            })
          } else {
            await tx.scheduledGame.create({
              data: {
                externalId: match.id,
                competition: match.competition.name,
                competitionCode: match.competition.code || '',
                homeTeam: homeShort,
                awayTeam: awayShort,
                homeTeamCrest: match.homeTeam.crest || null,
                awayTeamCrest: match.awayTeam.crest || null,
                matchday: match.matchday || null,
                utcDate: matchDate,
                status: 'SCHEDULED',
                marketId: newMarket.id,
              }
            })
          }
        })

        results.created++
      } catch (matchError: any) {
        console.error(`[admin/sync-games] Error processing match ${match.id}:`, matchError)
        results.errors.push(`Match ${match.id}: ${matchError.message}`)
      }
    }

    return NextResponse.json({ message: `Synced ${leagues.join(',')}`, ...results })
  } catch (error: any) {
    console.error('[admin/sync-games] Sync error:', error)
    return NextResponse.json({ error: 'Sync failed', message: error.message }, { status: 500 })
  }
}
