import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Rate limit: 5 exports per hour per user
    const rl = checkRateLimit(`export:${session.user.id}`, 5, 3600_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many export requests. Please wait.' }, { status: 429 })
    }

    const transactions = await prisma.transaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })

    // Build CSV
    const headers = ['Date', 'Type', 'Description', 'Amount (ZMW)', 'Fee (ZMW)', 'Status']
    const rows = transactions.map(tx => [
      new Date(tx.createdAt).toISOString(),
      tx.type,
      `"${tx.description.replace(/"/g, '""')}"`,
      tx.amount.toFixed(2),
      tx.feeAmount.toFixed(2),
      tx.status,
    ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="betipredict-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (error) {
    console.error('Error exporting transactions:', error)
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 })
  }
}
