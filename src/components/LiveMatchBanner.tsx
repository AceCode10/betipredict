'use client'

import { useState, useEffect, useCallback } from 'react'
import { Radio, ChevronRight } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface LiveMatch {
  id: number
  homeTeam: string
  awayTeam: string
  homeTeamCrest: string | null
  awayTeamCrest: string | null
  competition: string
  status: string
  minute: number | null
  homeScore: number | null
  awayScore: number | null
  marketId: string | null
  marketTitle: string | null
  yesPrice: number | null
  noPrice: number | null
}

interface LiveMatchBannerProps {
  onMarketClick?: (marketId: string) => void
}

export function LiveMatchBanner({ onMarketClick }: LiveMatchBannerProps) {
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
    const interval = setInterval(fetchLiveMatches, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [fetchLiveMatches])

  if (loading || matches.length === 0) return null

  const cardBg = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
  const cardBorder = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span className={`text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
            Live Now
          </span>
        </div>
        <span className={`text-xs ${textMuted}`}>({matches.length} match{matches.length !== 1 ? 'es' : ''})</span>
      </div>

      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {matches.map((match) => (
          <div
            key={match.id}
            className={`${cardBg} border ${cardBorder} rounded-xl p-3 min-w-[240px] max-w-[280px] flex-shrink-0 cursor-pointer hover:border-red-500/50 transition-all duration-200`}
            onClick={() => match.marketId && onMarketClick?.(match.marketId)}
          >
            {/* Competition + Live indicator */}
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[10px] font-medium ${textMuted} truncate`}>{match.competition}</span>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold text-red-400">
                  {match.minute ? `${match.minute}'` : 'LIVE'}
                </span>
              </div>
            </div>

            {/* Teams + Score */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {match.homeTeamCrest && (
                    <img src={match.homeTeamCrest} alt="" className="w-4 h-4 object-contain" />
                  )}
                  <span className={`text-sm font-medium ${textColor} truncate`}>{match.homeTeam}</span>
                </div>
                <span className={`text-lg font-bold ${textColor} ml-2 tabular-nums`}>
                  {match.homeScore ?? '-'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {match.awayTeamCrest && (
                    <img src={match.awayTeamCrest} alt="" className="w-4 h-4 object-contain" />
                  )}
                  <span className={`text-sm font-medium ${textColor} truncate`}>{match.awayTeam}</span>
                </div>
                <span className={`text-lg font-bold ${textColor} ml-2 tabular-nums`}>
                  {match.awayScore ?? '-'}
                </span>
              </div>
            </div>

            {/* Market odds if linked */}
            {match.marketId && match.yesPrice != null && (
              <div className={`flex items-center gap-2 mt-2 pt-2 border-t ${cardBorder}`}>
                <span className="text-[10px] text-green-400 font-semibold">
                  {match.homeTeam} {Math.round(match.yesPrice * 100)}%
                </span>
                <span className={`text-[10px] ${textMuted}`}>•</span>
                <span className="text-[10px] text-red-400 font-semibold">
                  {match.awayTeam} {Math.round((match.noPrice || 0) * 100)}%
                </span>
                <ChevronRight className={`w-3 h-3 ${textMuted} ml-auto`} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
