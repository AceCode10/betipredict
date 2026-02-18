'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatZambianCurrency, formatPriceAsNgwee, formatTotalCost } from '@/utils/currency'

interface PriceChartProps {
  marketId: string
  outcome: 'YES' | 'NO'
  currentPrice: number
  onClose: () => void
  onBuy: (amount: number) => void
}

interface PricePoint {
  time: string
  price: number
}

export function PriceChart({ marketId, outcome, currentPrice, onClose, onBuy }: PriceChartProps) {
  const [amount, setAmount] = useState('')
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(false)

  // Generate mock price history data
  useEffect(() => {
    const generatePriceHistory = () => {
      const points: PricePoint[] = []
      const now = new Date()
      let basePrice = currentPrice
      
      for (let i = 30; i >= 0; i--) {
        const time = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
        const variation = (Math.random() - 0.5) * 0.1
        basePrice = Math.max(0.01, Math.min(0.99, basePrice + variation))
        
        points.push({
          time: time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          price: basePrice
        })
      }
      
      setPriceHistory(points)
    }

    generatePriceHistory()
  }, [currentPrice])

  const handleBuy = () => {
    const buyAmount = parseFloat(amount)
    if (!buyAmount || buyAmount <= 0) return
    
    setLoading(true)
    setTimeout(() => {
      onBuy(buyAmount)
      setAmount('')
      setLoading(false)
      onClose()
    }, 1000)
  }

  const minPrice = Math.min(...priceHistory.map(p => p.price))
  const maxPrice = Math.max(...priceHistory.map(p => p.price))
  const priceRange = maxPrice - minPrice || 0.01

  const totalCost = (parseFloat(amount) || 0) * currentPrice
  const potentialReturn = parseFloat(amount) || 0

  return (
    <div className="rounded-lg">
      {/* SVG Price Chart */}
      <div className="h-40 relative">
        <svg className="w-full h-full" viewBox="0 0 300 120" preserveAspectRatio="none">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(pct => (
            <line key={pct} x1="0" y1={110 - pct * 1.0} x2="300" y2={110 - pct * 1.0} stroke="#2d3148" strokeWidth="0.5" />
          ))}
          {/* Price line */}
          {priceHistory.length > 1 && (
            <polyline
              fill="none"
              stroke={outcome === 'YES' ? '#22c55e' : '#3b82f6'}
              strokeWidth="2"
              points={priceHistory.map((point, index) => {
                const x = (index / (priceHistory.length - 1)) * 300
                const y = 110 - ((point.price - minPrice) / priceRange) * 90
                return `${x},${y}`
              }).join(' ')}
            />
          )}
          {/* End dot */}
          {priceHistory.length > 0 && (() => {
            const last = priceHistory[priceHistory.length - 1]
            const x = 300
            const y = 110 - ((last.price - minPrice) / priceRange) * 90
            return <circle cx={x} cy={y} r="3" fill={outcome === 'YES' ? '#22c55e' : '#3b82f6'} />
          })()}
        </svg>

        {/* Y-axis labels */}
        <div className="absolute top-0 right-0 text-[10px] text-gray-500">{Math.round(maxPrice * 100)}%</div>
        <div className="absolute bottom-2 right-0 text-[10px] text-gray-500">{Math.round(minPrice * 100)}%</div>
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[10px] text-gray-600 mt-1">
        <span>{priceHistory[0]?.time}</span>
        <span>{priceHistory[Math.floor(priceHistory.length / 2)]?.time}</span>
        <span>{priceHistory[priceHistory.length - 1]?.time}</span>
      </div>
    </div>
  )
}
