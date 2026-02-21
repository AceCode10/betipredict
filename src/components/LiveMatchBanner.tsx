'use client'

import { useState, useEffect, useCallback } from 'react'
import { Radio, BarChart3, Droplets } from 'lucide-react'
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

  // "other-sports" = anything NOT in the known categories
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

  // Filter matches by selected category
  const filteredMatches = matches.filter(m => matchesCategoryFilter(m, category))

  if (loading || filteredMatches.length === 0) return null

  const cardBg = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
  const cardBorder = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const subtleBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-50'

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
        <span className={`text-xs ${textMuted}`}>({filteredMatches.length} match{filteredMatches.length !== 1 ? 'es' : ''})</span>
      </div>

      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
        {filteredMatches.map((match) => {
          const homePercent = match.yesPrice != null ? Math.round(match.yesPrice * 100) : 50
          const awayPercent = match.noPrice != null ? Math.round(match.noPrice * 100) : 50
          const drawPercent = Math.max(0, 100 - homePercent - awayPercent)
          const live = isLive(match.status)

          return (
            <div
              key={match.id}
              className={`${cardBg} border ${cardBorder} rounded-xl p-3 min-w-[260px] max-w-[300px] flex-shrink-0 cursor-pointer hover:border-red-500/40 transition-all duration-200`}
              onClick={() => match.marketId && onMarketClick?.(match.marketId)}
            >
              {/* Competition + Live badge */}
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-[10px] font-medium ${textMuted} truncate`}>{match.competition}</span>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-red-400">
                    {match.minute ? `${match.minute}'` : 'LIVE'}
                  </span>
                </div>
              </div>

              {/* Teams + Scores + Percentages — Polymarket style */}
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {match.homeTeamCrest ? (
                      <img src={match.homeTeamCrest} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
                    ) : (
                      <div className={`w-5 h-5 rounded-full ${subtleBg} flex items-center justify-center text-[8px] font-bold ${textMuted} flex-shrink-0`}>
                        {match.homeTeam.charAt(0)}
                      </div>
                    )}
                    {live && (
                      <span className={`text-base font-bold ${textColor} tabular-nums w-5 text-center`}>
                        {match.homeScore ?? 0}
                      </span>
                    )}
                    <span className={`text-sm font-medium ${textColor} truncate`}>{match.homeTeam}</span>
                  </div>
                  <span className={`text-sm font-bold ${textColor} ml-2 tabular-nums`}>{homePercent}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {match.awayTeamCrest ? (
                      <img src={match.awayTeamCrest} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
                    ) : (
                      <div className={`w-5 h-5 rounded-full ${subtleBg} flex items-center justify-center text-[8px] font-bold ${textMuted} flex-shrink-0`}>
                        {match.awayTeam.charAt(0)}
                      </div>
                    )}
                    {live && (
                      <span className={`text-base font-bold ${textColor} tabular-nums w-5 text-center`}>
                        {match.awayScore ?? 0}
                      </span>
                    )}
                    <span className={`text-sm font-medium ${textColor} truncate`}>{match.awayTeam}</span>
                  </div>
                  <span className={`text-sm font-bold ${textColor} ml-2 tabular-nums`}>{awayPercent}%</span>
                </div>
              </div>

              {/* Bet buttons: TeamA | DRAW | TeamB — open trading interface */}
              {match.marketId && (
                <div className="flex gap-1.5 mb-2.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onMarketClick?.(match.marketId!, 'YES') }}
                    className={`flex-1 py-2 text-[11px] font-semibold rounded-lg ${subtleBg} text-green-500 border ${cardBorder} hover:border-green-500/50 hover:bg-green-500/10 transition-all duration-200 truncate`}
                  >
                    {match.homeTeam.length > 12 ? match.homeTeam.substring(0, 12) + '…' : match.homeTeam}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onMarketClick?.(match.marketId!, 'YES') }}
                    className={`px-2.5 py-2 text-[11px] font-semibold rounded-lg ${subtleBg} ${textMuted} border ${cardBorder} hover:border-gray-400 transition-all duration-200`}
                  >
                    DRAW
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onMarketClick?.(match.marketId!, 'NO') }}
                    className={`flex-1 py-2 text-[11px] font-semibold rounded-lg ${subtleBg} text-red-500 border ${cardBorder} hover:border-red-500/50 hover:bg-red-500/10 transition-all duration-200 truncate`}
                  >
                    {match.awayTeam.length > 12 ? match.awayTeam.substring(0, 12) + '…' : match.awayTeam}
                  </button>
                </div>
              )}

              {/* Footer: LIVE badge + Volume + League */}
              <div className={`flex items-center justify-between text-[10px] ${textMuted} pt-2 border-t ${cardBorder}`}>
                <div className="flex items-center gap-2">
                  {live && (
                    <span className="flex items-center gap-1 text-red-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      LIVE
                    </span>
                  )}
                  {match.volume != null && match.volume > 0 && (
                    <div className="flex items-center gap-0.5">
                      <BarChart3 className="w-2.5 h-2.5" />
                      <span>{formatVolume(match.volume)} Vol.</span>
                    </div>
                  )}
                </div>
                <span className="truncate max-w-[80px]">{match.competition}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
