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
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              isResolved 
                ? 'bg-slate-100 text-slate-600'
                : market.status === 'ACTIVE'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              {isResolved ? market.winningOutcome : (market.status || 'ACTIVE')}
            </span>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="w-3 h-3" />
              Resolves {formatResolveDate(market.resolveTime)}
            </div>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900 line-clamp-2">{market.question}</h3>
            {market.description && <p className="text-sm text-slate-500">{market.description}</p>}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <BarChart3 className="w-3 h-3" />
              <span>Vol: ${volume >= 1000 ? `${(volume / 1000).toFixed(0)}K` : volume.toFixed(0)}</span>
            </div>
            {market.liquidity != null && market.liquidity > 0 && (
              <span>Liq: ${market.liquidity >= 1000 ? `${(market.liquidity / 1000).toFixed(0)}K` : market.liquidity.toFixed(0)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-slate-500">YES</span>
            <div className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold">
              {yesPercentage}%
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-slate-500">NO</span>
            <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold">
              {noPercentage}%
            </div>
          </div>
          {!isResolved && (
            <Button
              size="sm"
              className="ml-2"
              onClick={(e) => {
                e.stopPropagation()
                onTrade?.(market)
              }}
            >
              Trade
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
