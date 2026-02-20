import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAllUpcomingMatches } from '@/lib/sports-api'
import crypto from 'crypto'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

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

    const results: { created: number; skipped: number; errors: string[] } = {
      created: 0,
      skipped: 0,
      errors: []
    }

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
          password: crypto.randomBytes(32).toString('hex'),
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
        const question = `${match.homeTeam.name} vs ${match.awayTeam.name}`

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
              status: 'ACTIVE',
              yesPrice: 0.5,
              noPrice: 0.5,
              liquidity: 10000,
              volume: 0,
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
                homeTeam: match.homeTeam.name,
                awayTeam: match.awayTeam.name,
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

    return NextResponse.json({
      message: `Processed ${matches.length} matches`,
      ...results
    })
  } catch (error: any) {
    console.error('[admin/sync-games] Sync error:', error)
    return NextResponse.json(
      { error: 'Sync failed', message: error.message },
      { status: 500 }
    )
  }
}
