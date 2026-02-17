import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MarketResolver } from '@/lib/market-resolution'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { outcome } = await request.json()

    if (!outcome || !['YES', 'NO'].includes(outcome)) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 })
    }

    const result = await MarketResolver.resolveMarket(id, outcome)

    return NextResponse.json(result)

  } catch (error) {
    console.error('Error resolving market:', error)
    return NextResponse.json(
      { error: 'Failed to resolve market' },
      { status: 500 }
    )
  }
}
