'use client'

import { useState, useEffect, useCallback } from 'react'

interface PriceChartProps {
  marketId: string
  outcome: 'YES' | 'NO'
  currentPrice: number
  onClose: () => void
  onBuy?: (amount: number) => void
}

interface HistoryPoint {
  time: string
  yesPrice: number
  noPrice: number
  volume: number
}

const RANGES = [
  { key: '1h', label: '1H' },
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: 'max', label: 'MAX' },
]

export function PriceChart({ marketId, outcome, currentPrice, onClose }: PriceChartProps) {
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [range, setRange] = useState('1w')
  const [loading, setLoading] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/markets/${marketId}/history?range=${range}`)
      if (res.ok) {
        const data = await res.json()
        if (data.history && data.history.length > 0) {
          setHistory(data.history)
          setLoading(false)
          return
        }
      }
    } catch {}

    // Fallback: generate synthetic history from current price
    const points: HistoryPoint[] = []
    const now = new Date()
    const durationMs = range === '1h' ? 3600000 : range === '1d' ? 86400000 : range === '1w' ? 604800000 : range === '1m' ? 2592000000 : 7776000000
    const numPoints = range === '1h' ? 12 : range === '1d' ? 24 : 30
    let yP = currentPrice
    for (let i = numPoints; i >= 0; i--) {
      const t = new Date(now.getTime() - (durationMs / numPoints) * i)
      const variation = (Math.random() - 0.5) * 0.06
      yP = Math.max(0.01, Math.min(0.99, yP + variation))
      points.push({ time: t.toISOString(), yesPrice: yP, noPrice: 1 - yP, volume: 0 })
    }
    // Ensure last point matches current price
    points[points.length - 1] = { time: now.toISOString(), yesPrice: currentPrice, noPrice: 1 - currentPrice, volume: 0 }
    setHistory(points)
    setLoading(false)
  }, [marketId, range, currentPrice])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Derive display data
  const prices = history.map(p => outcome === 'YES' ? p.yesPrice : p.noPrice)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 1
  const priceRange = maxPrice - minPrice || 0.01
  const lineColor = outcome === 'YES' ? '#22c55e' : '#3b82f6'
  const fillColor = outcome === 'YES' ? 'rgba(34,197,94,0.08)' : 'rgba(59,130,246,0.08)'

  // Grid percentages for Y-axis
  const gridLines = [0, 25, 50, 75, 100]

  // Hovered point info
  const hoveredPoint = hoveredIndex !== null && history[hoveredIndex] ? history[hoveredIndex] : null
  const displayPrice = hoveredPoint ? (outcome === 'YES' ? hoveredPoint.yesPrice : hoveredPoint.noPrice) : currentPrice
  const displayTime = hoveredPoint ? new Date(hoveredPoint.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="rounded-lg">
      {/* Hover info or current price */}
      {hoveredPoint && (
        <div className="flex items-center gap-2 mb-1 text-xs">
          <span className="font-bold" style={{ color: lineColor }}>{Math.round(displayPrice * 100)}%</span>
          <span className="text-gray-500">{displayTime}</span>
        </div>
      )}

      {/* SVG Chart */}
      <div className="h-44 relative" onMouseLeave={() => setHoveredIndex(null)}>
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-green-500 rounded-full animate-spin" />
          </div>
        ) : (
          <svg
            className="w-full h-full"
            viewBox="0 0 300 130"
            preserveAspectRatio="none"
            onMouseMove={(e) => {
              if (prices.length < 2) return
              const rect = e.currentTarget.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width
              const idx = Math.min(Math.max(Math.round(x * (prices.length - 1)), 0), prices.length - 1)
              setHoveredIndex(idx)
            }}
          >
            {/* Dotted grid lines */}
            {gridLines.map(pct => (
              <line key={pct} x1="0" y1={120 - pct * 1.1} x2="300" y2={120 - pct * 1.1} stroke="#2d3148" strokeWidth="0.5" strokeDasharray="4 4" />
            ))}

            {/* Area fill under line */}
            {prices.length > 1 && (
              <polygon
                fill={fillColor}
                points={
                  prices.map((price, i) => {
                    const x = (i / (prices.length - 1)) * 300
                    const y = 120 - ((price - minPrice) / priceRange) * 100
                    return `${x},${y}`
                  }).join(' ') + ` 300,120 0,120`
                }
              />
            )}

            {/* Price line */}
            {prices.length > 1 && (
              <polyline
                fill="none"
                stroke={lineColor}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={prices.map((price, i) => {
                  const x = (i / (prices.length - 1)) * 300
                  const y = 120 - ((price - minPrice) / priceRange) * 100
                  return `${x},${y}`
                }).join(' ')}
              />
            )}

            {/* End dot */}
            {prices.length > 0 && (() => {
              const last = prices[prices.length - 1]
              const x = 300
              const y = 120 - ((last - minPrice) / priceRange) * 100
              return (
                <>
                  <circle cx={x} cy={y} r="4" fill={lineColor} opacity="0.3" />
                  <circle cx={x} cy={y} r="2.5" fill={lineColor} />
                </>
              )
            })()}

            {/* Hover crosshair */}
            {hoveredIndex !== null && prices[hoveredIndex] !== undefined && (() => {
              const x = (hoveredIndex / (prices.length - 1)) * 300
              const y = 120 - ((prices[hoveredIndex] - minPrice) / priceRange) * 100
              return (
                <>
                  <line x1={x} y1="0" x2={x} y2="120" stroke="#4b5563" strokeWidth="0.5" strokeDasharray="3 3" />
                  <circle cx={x} cy={y} r="4" fill={lineColor} stroke="#1e2130" strokeWidth="1.5" />
                </>
              )
            })()}
          </svg>
        )}

        {/* Y-axis labels */}
        <div className="absolute top-0 right-1 text-[10px] text-gray-500">{Math.round(maxPrice * 100)}%</div>
        <div className="absolute top-1/2 right-1 -translate-y-1/2 text-[10px] text-gray-500">{Math.round(((maxPrice + minPrice) / 2) * 100)}%</div>
        <div className="absolute bottom-4 right-1 text-[10px] text-gray-500">{Math.round(minPrice * 100)}%</div>
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[10px] text-gray-600 mt-1 mb-2">
        {history.length > 0 && (
          <>
            <span>{new Date(history[0].time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span>{new Date(history[Math.floor(history.length / 2)]?.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span>{new Date(history[history.length - 1].time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </>
        )}
      </div>

      {/* Time range selector */}
      <div className="flex items-center gap-1">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
              range === r.key
                ? 'bg-green-500/15 text-green-400'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}
