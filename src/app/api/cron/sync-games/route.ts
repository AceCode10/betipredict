import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getMatchesForLeagues, FREE_TIER_COMPS, type CompetitionCode } from '@/lib/sports-api'
import crypto from 'crypto'

// Auto-sync sports games from the API and create markets as PENDING_APPROVAL.
// Markets require Market Maker approval (pricing) before appearing on the platform.
//
// Supports ?league=PL param to sync a single league (avoids serverless timeout).
// Without ?league, rotates through leagues 2 at a time using a DB counter.
//
// Security: requires CRON_SECRET header to prevent unauthorized calls.

const CRON_SECRET = process.env.CRON_SECRET || ''

function verifyCronAuth(request: NextRequest): boolean {
  if (!CRON_SECRET) return false
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(CRON_SECRET))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const leagueParam = searchParams.get('league')

  const results: { created: number; skipped: number; errors: string[]; leagues: string[] } = {
    created: 0,
    skipped: 0,
    errors: [],
    leagues: [],
  }

  try {
    // Determine which leagues to sync this invocation
    let leagues: CompetitionCode[]

    if (leagueParam && FREE_TIER_COMPS.includes(leagueParam as CompetitionCode)) {
      leagues = [leagueParam as CompetitionCode]
    } else {
      // Rotate: sync 2 leagues per invocation to stay under 10-15s
      // Use a simple DB-based counter stored in system user metadata
      const idx = Math.floor(Date.now() / (2 * 60 * 60 * 1000)) % Math.ceil(FREE_TIER_COMPS.length / 2)
      const start = idx * 2
      leagues = FREE_TIER_COMPS.slice(start, start + 2)
    }

    results.leagues = leagues
    const matches = await getMatchesForLeagues(leagues, 14)

    if (!matches || matches.length === 0) {
      return NextResponse.json({ message: 'No upcoming matches found', ...results })
    }

    // Get or create system user
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
          // Create market as PENDING_APPROVAL — Market Maker must set prices and approve
          const newMarket = await tx.market.create({
            data: {
              title,
              description: `${match.competition.name} - Matchday ${match.matchday || 'N/A'}`,
              category: 'Football',
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
        console.log(`[sync-games] Created pending market: ${title}`)
      } catch (matchError: any) {
        console.error(`[sync-games] Error processing match ${match.id}:`, matchError)
        results.errors.push(`Match ${match.id}: ${matchError.message}`)
      }
    }

    return NextResponse.json({ message: `Synced ${leagues.join(',')}`, ...results })
  } catch (error: any) {
    console.error('[sync-games] Sync error:', error)
    return NextResponse.json({ error: 'Sync failed', message: error.message }, { status: 500 })
  }
}

// Also support POST for flexibility
export async function POST(request: NextRequest) {
  return GET(request)
}
