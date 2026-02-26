'use client'

import { BarChart3 } from 'lucide-react'
import { formatVolume } from '@/utils/currency'
import { useTheme } from '@/contexts/ThemeContext'

interface GroupMarketCardProps {
  group: any
  onOptionClick: (marketId: string) => void
}

export function GroupMarketCard({ group, onOptionClick }: GroupMarketCardProps) {
  const { isDarkMode } = useTheme()
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const cardBg = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
  const cardBorder = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
  const cardHover = isDarkMode ? 'hover:border-gray-600 hover:shadow-lg hover:shadow-black/20' : 'hover:border-gray-300 hover:shadow-lg hover:shadow-gray-200/80'
  const subtleBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-50'

  const totalVol = group.markets.reduce((s: number, m: any) => s + (m.volume || 0), 0)
  const sorted = [...group.markets].sort((a: any, b: any) => (b.yesPrice || 0) - (a.yesPrice || 0))
  const topOptions = sorted.slice(0, 4)
  const remaining = sorted.length - topOptions.length

  const displayIcon = group.icon || (
    group.displayType === 'range' ? '📈' :
    group.displayType === 'sentiment' ? '📊' :
    group.displayType === 'date' ? '📅' :
    group.displayType === 'head-to-head' ? '⚔️' : '🏆'
  )

  const getOptionStyle = (i: number) => {
    const dt = group.displayType || 'multi-option'
    if (dt === 'sentiment') {
      return i === 0
        ? { bar: 'bg-green-500', text: isDarkMode ? 'text-green-400' : 'text-green-600', btn: isDarkMode ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20 hover:text-white' : 'bg-green-50 border-green-200 hover:bg-green-100' }
        : { bar: 'bg-red-500', text: isDarkMode ? 'text-red-400' : 'text-red-600', btn: isDarkMode ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20 hover:text-white' : 'bg-red-50 border-red-200 hover:bg-red-100' }
    }
    if (dt === 'range') {
      return { bar: 'bg-blue-500', text: isDarkMode ? 'text-blue-400' : 'text-blue-600', btn: isDarkMode ? 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20 hover:text-white' : 'bg-blue-50 border-blue-200 hover:bg-blue-100' }
    }
    if (dt === 'head-to-head') {
      return i === 0
        ? { bar: 'bg-emerald-500', text: isDarkMode ? 'text-emerald-400' : 'text-emerald-600', btn: isDarkMode ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 hover:text-white' : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' }
        : { bar: 'bg-blue-500', text: isDarkMode ? 'text-blue-400' : 'text-blue-600', btn: isDarkMode ? 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20 hover:text-white' : 'bg-blue-50 border-blue-200 hover:bg-blue-100' }
    }
    // multi-option, date, default
    return { bar: 'bg-green-500', text: isDarkMode ? 'text-green-400' : 'text-green-600', btn: isDarkMode ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20 hover:text-white' : 'bg-green-50 border-green-200 hover:bg-green-100' }
  }

  return (
    <div className={`${cardBg} border ${cardBorder} rounded-xl p-4 ${cardHover} transition-all duration-200 cursor-pointer group card-hover-lift`}>
      {/* Group header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-full ${subtleBg} flex items-center justify-center text-base ${isDarkMode ? 'border border-gray-700' : 'border border-gray-200'} flex-shrink-0`}>
          {displayIcon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`text-[15px] font-semibold ${textColor} leading-snug line-clamp-2 group-hover:text-green-500 transition-colors`}>
            {group.title}
          </h3>
          {group.displayType && group.displayType !== 'multi-option' && (
            <span className={`text-[10px] font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {group.displayType.replace('-', ' ')}
            </span>
          )}
        </div>
      </div>

      {/* Options list with progress bars */}
      <div className="space-y-1.5 mb-3">
        {topOptions.map((opt: any, i: number) => {
          const pct = Math.round((opt.yesPrice || 0.5) * 100)
          const style = getOptionStyle(i)
          const label = group.displayType === 'range' ? `↑${opt.title}` : opt.title
          return (
            <button
              key={opt.id}
              onClick={(e) => { e.stopPropagation(); onOptionClick(opt.id) }}
              className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-sm font-medium border transition-all duration-200 ${style.btn} ${style.text}`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className={`w-1 h-4 rounded-full ${style.bar} flex-shrink-0`} />
                <span className="truncate">{label}</span>
              </div>
              <span className="ml-2 flex-shrink-0 font-bold tabular-nums">{pct}%</span>
            </button>
          )
        })}
        {remaining > 0 && (
          <div className={`text-center text-xs ${textMuted} py-1`}>
            +{remaining} more option{remaining > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`flex items-center justify-between text-[11px] ${textMuted} pt-2.5 border-t ${cardBorder}`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5" title="Total Volume">
            <BarChart3 className="w-3 h-3" />
            <span>{formatVolume(totalVol)} Vol.</span>
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isDarkMode ? 'bg-purple-500/10 text-purple-400' : 'bg-purple-50 text-purple-600'}`}>
            {sorted.length} options
          </span>
        </div>
        <span className="truncate max-w-[80px]">{group.category}</span>
      </div>
    </div>
  )
}
