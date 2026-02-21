import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAllUpcomingMatches } from '@/lib/sports-api'
import crypto from 'crypto'

// Auto-sync sports games from the API and create markets for them
// This endpoint should be called periodically (e.g., every hour via external cron)
// Security: requires CRON_SECRET header to prevent unauthorized calls

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
  // Verify cron authentication
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: { created: number; skipped: number; errors: string[] } = {
    created: 0,
    skipped: 0,
    errors: []
  }

  try {
    // Fetch upcoming matches from sports API
    const matches = await getAllUpcomingMatches(50)

    if (!matches || matches.length === 0) {
      return NextResponse.json({
        message: 'No upcoming matches found',
        ...results
      })
    }

    // Get system user for market creation (or create one if doesn't exist)
    let systemUser = await prisma.user.findFirst({
      where: { email: 'system@betipredict.com' }
    })

    if (!systemUser) {
      systemUser = await prisma.user.create({
        data: {
          email: 'system@betipredict.com',
          username: 'BetiPredict',
          fullName: 'BetiPredict System',
          password: crypto.randomBytes(32).toString('hex'), // Random password, never used
          isVerified: true,
          balance: 0,
        }
      })
    }

    // Process each match
    for (const match of matches) {
      try {
        // Check if market already exists for this game
        const existingGame = await prisma.scheduledGame.findUnique({
          where: { externalId: match.id }
        })

        if (existingGame?.marketId) {
          // Market already exists for this game
          results.skipped++
          continue
        }

        // Check if match is in the future (at least 1 hour from now)
        const matchDate = new Date(match.utcDate)
        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000)
        if (matchDate <= oneHourFromNow) {
          results.skipped++
          continue
        }

        // Create market for this match
        const title = `${match.homeTeam.name} vs ${match.awayTeam.name}`
        const question = `Who will win: ${match.homeTeam.name} vs ${match.awayTeam.name}?`

        const market = await prisma.$transaction(async (tx) => {
          // Create the market
          const newMarket = await tx.market.create({
            data: {
              title,
              description: `${match.competition.name} - Matchday ${match.matchday || 'N/A'}`,
              category: 'Sports',
              subcategory: match.competition.name,
              question,
              resolveTime: matchDate,
              creatorId: systemUser!.id,
              status: 'ACTIVE',
              yesPrice: 0.5,
              noPrice: 0.5,
              liquidity: 10000, // K10,000 initial liquidity
              volume: 0,
              homeTeam: match.homeTeam.name,
              awayTeam: match.awayTeam.name,
              league: match.competition.name,
            }
          })

          // Create or update ScheduledGame record
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
                homeTeam: match.homeTeam.name,
                awayTeam: match.awayTeam.name,
                homeTeamCrest: match.homeTeam.crest || null,
                awayTeamCrest: match.awayTeam.crest || null,
                matchday: match.matchday || null,
                utcDate: matchDate,
                status: 'SCHEDULED',
                marketId: newMarket.id,
              }
            })
          }

          return newMarket
        })

        results.created++
        console.log(`[sync-games] Created market for: ${title}`)
      } catch (matchError: any) {
        console.error(`[sync-games] Error processing match ${match.id}:`, matchError)
        results.errors.push(`Match ${match.id}: ${matchError.message}`)
      }
    }

    return NextResponse.json({
      message: `Processed ${matches.length} matches`,
      ...results
    })
  } catch (error: any) {
    console.error('[sync-games] Sync error:', error)
    return NextResponse.json(
      { error: 'Sync failed', message: error.message },
      { status: 500 }
    )
  }
}

// Also support POST for flexibility
export async function POST(request: NextRequest) {
  return GET(request)
}
