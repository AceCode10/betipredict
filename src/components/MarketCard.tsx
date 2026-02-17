'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { TrendingUp, TrendingDown, Clock, BarChart3 } from 'lucide-react'

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
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => onTrade?.(market)}>
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg line-clamp-2">{market.question}</CardTitle>
          <div className={`px-2 py-1 rounded-full text-xs font-medium shrink-0 ml-2 ${
            isResolved 
              ? 'bg-gray-100 text-gray-600'
              : market.status === 'ACTIVE'
              ? 'bg-green-100 text-green-600'
              : 'bg-yellow-100 text-yellow-600'
          }`}>
            {isResolved ? market.winningOutcome : (market.status || 'ACTIVE')}
          </div>
        </div>
        {market.description && <p className="text-sm text-gray-600">{market.description}</p>}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          Resolves {formatResolveDate(market.resolveTime)}
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-3">
          {/* Price bars */}
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-green-600">YES</span>
                <span className="text-sm font-bold">{yesPercentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${yesPercentage}%` }}
                />
              </div>
            </div>
            
            <div className="relative">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-red-600">NO</span>
                <span className="text-sm font-bold">{noPercentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-red-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${noPercentage}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* Market stats */}
          <div className="flex justify-between text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <BarChart3 className="w-3 h-3" />
              <span>Vol: ${volume >= 1000 ? `${(volume/1000).toFixed(0)}K` : volume.toFixed(0)}</span>
            </div>
            {market.liquidity != null && market.liquidity > 0 && (
              <span>Liq: ${market.liquidity >= 1000 ? `${(market.liquidity/1000).toFixed(0)}K` : market.liquidity.toFixed(0)}</span>
            )}
          </div>
          
          {!isResolved && (
            <Button 
              className="w-full" 
              onClick={(e) => {
                e.stopPropagation()
                onTrade?.(market)
              }}
            >
              Trade Now
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
