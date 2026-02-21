'use client'

import { useState, useEffect, useCallback } from 'react'
import { Radio, BarChart3, Bookmark } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { formatVolume } from '@/utils/currency'

interface LiveMatch {
  id: number
  homeTeam: string
  awayTeam: string
  homeTeamCrest: string | null
  awayTeamCrest: string | null
  competition: string
  competitionCode: string
  status: string
  minute: number | null
  homeScore: number | null
  awayScore: number | null
  marketId: string | null
  marketTitle: string | null
  yesPrice: number | null
  noPrice: number | null
  volume?: number
  liquidity?: number
}

interface LiveMatchBannerProps {
  category?: string
  onMarketClick?: (marketId: string, outcome?: 'YES' | 'NO') => void
  onBet?: (marketId: string, outcome: 'YES' | 'NO') => void
}

// Map competition codes/names to UI category slugs
const competitionToCategoryMap: Record<string, string[]> = {
  'premier-league': ['PL', 'Premier League', 'ELC', 'Championship'],
  'la-liga': ['PD', 'Primera Division', 'La Liga'],
  'bundesliga': ['BL1', 'Bundesliga'],
  'serie-a': ['SA', 'Serie A'],
  'ligue-1': ['FL1', 'Ligue 1'],
  'champions-league': ['CL', 'UEFA Champions League', 'Champions League'],
  'zambia-super-league': ['ZSL', 'Zambia Super League'],
}

function matchesCategoryFilter(match: LiveMatch, category: string): boolean {
  if (category === 'all') return true

  if (category === 'other-sports') {
    const code = (match.competitionCode || '').toUpperCase()
    const name = (match.competition || '').toLowerCase()
    const knownCodes = Object.values(competitionToCategoryMap).flat()
    return !knownCodes.some(t => t.toUpperCase() === code || name.includes(t.toLowerCase()))
  }

  const targets = competitionToCategoryMap[category]
  if (!targets) return false
  const code = (match.competitionCode || '').toUpperCase()
  const name = (match.competition || '').toLowerCase()
  return targets.some(t => t.toUpperCase() === code || name.includes(t.toLowerCase()))
}

// Short competition code for footer display (e.g. "EPL", "UCL")
function getCompetitionShort(code: string, name: string): string {
  const map: Record<string, string> = {
    'PL': 'EPL', 'PD': 'La Liga', 'BL1': 'BL', 'SA': 'Serie A',
    'FL1': 'L1', 'CL': 'UCL', 'ZSL': 'ZSL', 'ELC': 'EFL',
  }
  return map[code] || code || name.split(' ').map(w => w[0]).join('').substring(0, 3).toUpperCase()
}

export function LiveMatchBanner({ category = 'all', onMarketClick, onBet }: LiveMatchBannerProps) {
  const { isDarkMode } = useTheme()
  const [matches, setMatches] = useState<LiveMatch[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLiveMatches = useCallback(async () => {
    try {
      const res = await fetch('/api/matches/live')
      if (res.ok) {
        const data = await res.json()
        setMatches(data.matches || [])
      }
    } catch (err) {
      console.error('Failed to fetch live matches:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLiveMatches()
    const interval = setInterval(fetchLiveMatches, 30000)
    return () => clearInterval(interval)
  }, [fetchLiveMatches])

  const filteredMatches = matches.filter(m => matchesCategoryFilter(m, category))

  if (loading || filteredMatches.length === 0) return null

  const isLive = (status: string) => ['IN_PLAY', 'LIVE', 'PAUSED'].includes(status)

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span className={`text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
            Live Now
          </span>
        </div>
        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>({filteredMatches.length})</span>
      </div>

      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
        {filteredMatches.map((match) => {
          const homePercent = match.yesPrice != null ? Math.round(match.yesPrice * 100) : 50
          const awayPercent = match.noPrice != null ? Math.round(match.noPrice * 100) : 50
          const live = isLive(match.status)
          const hasMkt = !!match.marketId
          const shortComp = getCompetitionShort(match.competitionCode, match.competition)

          // Determine half from minute
          const half = match.minute != null
            ? match.minute <= 45 ? '1H' : '2H'
            : ''
          const minuteDisplay = match.minute != null
            ? `${half} - ${match.minute}'`
            : 'LIVE'

          return (
            <div
              key={match.id}
              className={`rounded-xl min-w-[280px] max-w-[320px] flex-shrink-0 transition-all duration-200 overflow-hidden ${
                isDarkMode
                  ? 'bg-[#1a1d2e] hover:bg-[#1e2236]'
                  : 'bg-white border border-gray-200 hover:border-gray-300'
              } ${hasMkt ? 'cursor-pointer' : 'opacity-80'}`}
              onClick={() => hasMkt && onMarketClick?.(match.marketId!)}
            >
              {/* ── Team rows: crest + score + name + percentage ── */}
              <div className="px-4 pt-4 pb-2 space-y-3">
                {/* Home team row */}
                <div className="flex items-center gap-3">
                  {match.homeTeamCrest ? (
                    <img src={match.homeTeamCrest} alt="" className="w-6 h-6 object-contain flex-shrink-0" />
                  ) : (
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {match.homeTeam.charAt(0)}
                    </div>
                  )}
                  {live && (
                    <span className={`text-lg font-bold tabular-nums w-4 text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {match.homeScore ?? 0}
                    </span>
                  )}
                  <span className={`text-sm font-medium flex-1 truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {match.homeTeam}
                  </span>
                  <span className={`text-sm font-bold tabular-nums ml-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {homePercent}%
                  </span>
                </div>

                {/* Away team row */}
                <div className="flex items-center gap-3">
                  {match.awayTeamCrest ? (
                    <img src={match.awayTeamCrest} alt="" className="w-6 h-6 object-contain flex-shrink-0" />
                  ) : (
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {match.awayTeam.charAt(0)}
                    </div>
                  )}
                  {live && (
                    <span className={`text-lg font-bold tabular-nums w-4 text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {match.awayScore ?? 0}
                    </span>
                  )}
                  <span className={`text-sm font-medium flex-1 truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {match.awayTeam}
                  </span>
                  <span className={`text-sm font-bold tabular-nums ml-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {awayPercent}%
                  </span>
                </div>
              </div>

              {/* ── Bet buttons: Home | DRAW | Away — Polymarket colored style ── */}
              <div className="flex gap-1.5 px-4 pb-3">
                <button
                  onClick={(e) => { e.stopPropagation(); hasMkt && onMarketClick?.(match.marketId!, 'YES') }}
                  disabled={!hasMkt}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all duration-150 truncate ${
                    hasMkt
                      ? 'bg-[#2d9cdb]/15 text-[#2d9cdb] hover:bg-[#2d9cdb]/25 active:bg-[#2d9cdb]/35'
                      : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {match.homeTeam.length > 12 ? match.homeTeam.substring(0, 12) + '…' : match.homeTeam}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); hasMkt && onMarketClick?.(match.marketId!, 'YES') }}
                  disabled={!hasMkt}
                  className={`px-4 py-2.5 text-xs font-bold rounded-lg transition-all duration-150 ${
                    hasMkt
                      ? isDarkMode
                        ? 'bg-gray-700/60 text-gray-300 hover:bg-gray-700 active:bg-gray-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400'
                      : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  DRAW
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); hasMkt && onMarketClick?.(match.marketId!, 'NO') }}
                  disabled={!hasMkt}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all duration-150 truncate ${
                    hasMkt
                      ? 'bg-[#27ae60]/15 text-[#27ae60] hover:bg-[#27ae60]/25 active:bg-[#27ae60]/35'
                      : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {match.awayTeam.length > 12 ? match.awayTeam.substring(0, 12) + '…' : match.awayTeam}
                </button>
              </div>

              {/* ── Footer: live dot + half/minute · volume · league · bookmark ── */}
              <div className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] ${
                isDarkMode ? 'border-t border-gray-800 text-gray-500' : 'border-t border-gray-100 text-gray-400'
              }`}>
                {live && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                )}
                <span className="font-medium">{minuteDisplay}</span>
                <span className={isDarkMode ? 'text-gray-700' : 'text-gray-300'}>·</span>
                {match.volume != null && match.volume > 0 ? (
                  <span>{formatVolume(match.volume)} Vol.</span>
                ) : (
                  <span>K0 Vol.</span>
                )}
                <span className={isDarkMode ? 'text-gray-700' : 'text-gray-300'}>·</span>
                <span>{shortComp}</span>
                <div className="ml-auto flex-shrink-0">
                  <Bookmark className={`w-3.5 h-3.5 ${isDarkMode ? 'text-gray-600 hover:text-gray-400' : 'text-gray-300 hover:text-gray-500'} cursor-pointer transition-colors`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
