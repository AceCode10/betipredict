'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Trophy, TrendingUp, Medal } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

type Period = 'all' | 'month' | 'week'

interface LeaderboardEntry {
  rank: number
  userId: string
  username: string
  avatar: string | null
  totalPnl: number
  roi: number
  trades: number
  marketsTraded: number
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('all')
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/leaderboard?period=${period}&limit=50`)
      .then(r => r.json())
      .then(data => setEntries(data.leaderboard || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [period])

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Medal className="w-5 h-5 text-yellow-400" />
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-300" />
    if (rank === 3) return <Medal className="w-5 h-5 text-orange-400" />
    return <span className="text-sm font-bold text-gray-500 w-5 text-center">{rank}</span>
  }

  return (
    <div className="min-h-screen bg-[#131722]">
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-[#171924]">
        <div className="max-w-[800px] mx-auto px-4">
          <div className="flex items-center gap-4 h-14">
            <Link href="/" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h1 className="text-lg font-bold text-white">Leaderboard</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[800px] mx-auto px-4 py-6 space-y-4">
        {/* Period Filter */}
        <div className="flex gap-2">
          {([['all', 'All Time'], ['month', 'This Month'], ['week', 'This Week']] as [Period, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setPeriod(val)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                period === val ? 'bg-green-500 text-white' : 'bg-[#1c2030] text-gray-400 hover:text-white border border-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Table Header */}
        <div className="flex items-center gap-3 px-4 py-2 text-xs text-gray-500 font-medium uppercase">
          <span className="w-8">#</span>
          <span className="flex-1">Trader</span>
          <span className="w-24 text-right">P&L</span>
          <span className="w-16 text-right hidden sm:block">ROI</span>
          <span className="w-16 text-right hidden sm:block">Trades</span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-8 text-center">
            <TrendingUp className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No traders yet for this period.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map(entry => (
              <div
                key={entry.userId}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  entry.rank <= 3 ? 'bg-[#1c2030] border border-gray-800' : 'hover:bg-[#1c2030]'
                }`}
              >
                <div className="w-8 flex justify-center">{getRankIcon(entry.rank)}</div>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm font-bold flex-shrink-0">
                    {entry.username[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-white truncate">{entry.username}</span>
                </div>
                <div className="w-24 text-right">
                  <span className={`text-sm font-semibold ${entry.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {entry.totalPnl >= 0 ? '+' : ''}{formatZambianCurrency(entry.totalPnl)}
                  </span>
                </div>
                <div className="w-16 text-right hidden sm:block">
                  <span className={`text-xs font-medium ${entry.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {entry.roi >= 0 ? '+' : ''}{entry.roi}%
                  </span>
                </div>
                <div className="w-16 text-right hidden sm:block">
                  <span className="text-xs text-gray-400">{entry.trades}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
