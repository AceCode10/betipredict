'use client'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { Clock, BarChart3 } from 'lucide-react'

interface MarketCardMarket {
  id: string
  title: string
  description?: string
  question: string
  yesPrice: number
  noPrice: number
  volume?: number
  liquidity?: number
  status?: string
  resolveTime: string | Date
  winningOutcome?: string
  [key: string]: any
}

interface MarketCardProps {
  market: MarketCardMarket
  onTrade?: (market: MarketCardMarket) => void
}

function formatResolveDate(date: string | Date): string {
  try {
    const d = new Date(date)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return 'TBD'
  }
}

export function MarketCard({ market, onTrade }: MarketCardProps) {
  const yesPercentage = Math.round(market.yesPrice * 100)
  const noPercentage = Math.round(market.noPrice * 100)
  const isResolved = market.status === 'RESOLVED'
  const volume = market.volume ?? 0
  
  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onTrade?.(market)}>
      <div className="p-5">
        {/* Card Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 text-lg">
            📊
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-2 mb-1">
              {market.question}
            </h3>
            {market.description && (
              <p className="text-sm text-slate-500 dark:text-gray-400 line-clamp-2">{market.description}</p>
            )}
          </div>
        </div>

        {/* Status and Time */}
        <div className="flex items-center gap-3 mb-4">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            isResolved 
              ? 'bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-400'
              : market.status === 'ACTIVE'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          }`}>
            {isResolved ? market.winningOutcome : (market.status || 'ACTIVE')}
          </span>
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400">
            <Clock className="w-3 h-3" />
            Resolves {formatResolveDate(market.resolveTime)}
          </div>
        </div>

        {/* Yes/No Buttons with Percentages */}
        {!isResolved && (
          <div className="flex gap-3 mb-4">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTrade?.(market)
              }}
              className="flex-1 py-3 px-4 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <span>YES</span>
              <span className="text-xs opacity-90">{yesPercentage}%</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTrade?.(market)
              }}
              className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <span>NO</span>
              <span className="text-xs opacity-90">{noPercentage}%</span>
            </button>
          </div>
        )}

        {/* Footer: Volume and Liquidity */}
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-gray-400 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <BarChart3 className="w-3 h-3" />
              <span>Vol: ${volume >= 1000 ? `${(volume / 1000).toFixed(0)}K` : volume.toFixed(0)}</span>
            </div>
            {market.liquidity != null && market.liquidity > 0 && (
              <span>Liq: ${market.liquidity >= 1000 ? `${(market.liquidity / 1000).toFixed(0)}K` : market.liquidity.toFixed(0)}</span>
            )}
          </div>
          {isResolved && (
            <span className="font-medium">{market.winningOutcome}</span>
          )}
        </div>
      </div>
    </Card>
  )
}
