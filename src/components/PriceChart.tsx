'use client'

import { useState, useEffect, useCallback } from 'react'

interface PriceChartProps {
  marketId: string
  outcome: 'YES' | 'NO' | 'HOME' | 'DRAW' | 'AWAY'
  currentPrice: number
  onClose: () => void
  onBuy?: (amount: number) => void
  isTri?: boolean
  homeTeam?: string
  awayTeam?: string
  homePrice?: number
  drawPrice?: number
  awayPrice?: number
}

interface HistoryPoint {
  time: string
  yesPrice: number
  noPrice: number
  homePrice?: number
  drawPrice?: number
  awayPrice?: number
  volume: number
}

const RANGES = [
  { key: '1h', label: '1H' },
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: 'max', label: 'MAX' },
]

// Line config for tri-outcome charts (Polymarket style)
const TRI_LINES = [
  { key: 'homePrice' as const, color: '#ef4444', label: '' },  // Red
  { key: 'awayPrice' as const, color: '#3b82f6', label: '' },  // Blue
  { key: 'drawPrice' as const, color: '#9ca3af', label: 'Draw' }, // Gray
]

export function PriceChart({
  marketId, outcome, currentPrice, onClose, onBuy,
  isTri, homeTeam, awayTeam, homePrice, drawPrice, awayPrice,
}: PriceChartProps) {
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

    // Fallback: generate flat line from current prices (no fake variation)
    const now = new Date()
    const durationMs = range === '1h' ? 3600000 : range === '1d' ? 86400000 : range === '1w' ? 604800000 : range === '1m' ? 2592000000 : 7776000000
    const numPoints = range === '1h' ? 12 : range === '1d' ? 24 : 30
    const points: HistoryPoint[] = []
    const hp = homePrice ?? currentPrice
    const ap = awayPrice ?? (1 - currentPrice)
    const dp = drawPrice ?? 0.28
    for (let i = numPoints; i >= 0; i--) {
      const t = new Date(now.getTime() - (durationMs / numPoints) * i)
      const pt: HistoryPoint = { time: t.toISOString(), yesPrice: hp, noPrice: ap, volume: 0 }
      if (isTri) { pt.homePrice = hp; pt.drawPrice = dp; pt.awayPrice = ap }
      points.push(pt)
    }
    setHistory(points)
    setLoading(false)
  }, [marketId, range, currentPrice, isTri, homePrice, drawPrice, awayPrice])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Chart dimensions
  const W = 300, H = 120, LABEL_W = 0 // label space is outside SVG

  // For tri-outcome: render all 3 lines. For binary: single line.
  const lines = isTri
    ? TRI_LINES.map(l => ({
        ...l,
        label: l.key === 'homePrice' ? (homeTeam || 'Home') : l.key === 'awayPrice' ? (awayTeam || 'Away') : 'Draw',
        prices: history.map(p => p[l.key] ?? (l.key === 'homePrice' ? p.yesPrice : l.key === 'awayPrice' ? p.noPrice : 0.28)),
      }))
    : [{
        key: 'selected' as any,
        color: outcome === 'YES' || outcome === 'HOME' ? '#22c55e' : outcome === 'DRAW' ? '#9ca3af' : '#ef4444',
        label: '',
        prices: history.map(p => outcome === 'NO' || outcome === 'AWAY' ? p.noPrice : p.yesPrice),
      }]

  // Global min/max across all lines for consistent Y-axis
  const allPrices = lines.flatMap(l => l.prices)
  const minPrice = allPrices.length > 0 ? Math.max(0, Math.min(...allPrices) - 0.02) : 0
  const maxPrice = allPrices.length > 0 ? Math.min(1, Math.max(...allPrices) + 0.02) : 1
  const priceRange = maxPrice - minPrice || 0.01

  const toY = (price: number) => H - ((price - minPrice) / priceRange) * (H - 10)
  const toX = (i: number, len: number) => len > 1 ? (i / (len - 1)) * W : W / 2

  // Hovered point info
  const hoveredPoint = hoveredIndex !== null && history[hoveredIndex] ? history[hoveredIndex] : null
  const displayTime = hoveredPoint ? new Date(hoveredPoint.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="rounded-lg">
      {/* Hover info */}
      {hoveredPoint && (
        <div className="flex items-center gap-3 mb-1 text-xs flex-wrap">
          {lines.map(l => {
            const val = hoveredIndex !== null ? l.prices[hoveredIndex] : 0
            return (
              <span key={l.key} className="font-bold" style={{ color: l.color }}>
                {l.label ? `${l.label} ` : ''}{Math.round(val * 100)}%
              </span>
            )
          })}
          <span className="text-gray-500">{displayTime}</span>
        </div>
      )}

      {/* Chart area with labels */}
      <div className="flex items-stretch">
        {/* SVG Chart */}
        <div className="flex-1 h-52 relative" onMouseLeave={() => setHoveredIndex(null)}>
          {loading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-green-500 rounded-full animate-spin" />
            </div>
          ) : (
            <svg
              className="w-full h-full"
              viewBox={`0 0 ${W} ${H + 10}`}
              preserveAspectRatio="none"
              onMouseMove={(e) => {
                if (history.length < 2) return
                const rect = e.currentTarget.getBoundingClientRect()
                const x = (e.clientX - rect.left) / rect.width
                const idx = Math.min(Math.max(Math.round(x * (history.length - 1)), 0), history.length - 1)
                setHoveredIndex(idx)
              }}
            >
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                const yVal = minPrice + frac * priceRange
                const y = toY(yVal)
                return <line key={frac} x1="0" y1={y} x2={W} y2={y} stroke="#2d3148" strokeWidth="0.5" strokeDasharray="4 4" />
              })}

              {/* Render each line */}
              {lines.map(l => {
                if (l.prices.length < 2) return null
                const pts = l.prices.map((p, i) => `${toX(i, l.prices.length)},${toY(p)}`).join(' ')
                const lastX = toX(l.prices.length - 1, l.prices.length)
                const lastY = toY(l.prices[l.prices.length - 1])
                return (
                  <g key={l.key}>
                    <polyline
                      fill="none"
                      stroke={l.color}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={pts}
                    />
                    {/* End dot */}
                    <circle cx={lastX} cy={lastY} r="3.5" fill={l.color} opacity="0.3" />
                    <circle cx={lastX} cy={lastY} r="2" fill={l.color} />
                  </g>
                )
              })}

              {/* Hover crosshair */}
              {hoveredIndex !== null && history[hoveredIndex] && (() => {
                const x = toX(hoveredIndex, history.length)
                return (
                  <g>
                    <line x1={x} y1="0" x2={x} y2={H + 10} stroke="#4b5563" strokeWidth="0.5" strokeDasharray="3 3" />
                    {lines.map(l => {
                      const y = toY(l.prices[hoveredIndex])
                      return <circle key={l.key} cx={x} cy={y} r="3.5" fill={l.color} stroke="#1e2130" strokeWidth="1.5" />
                    })}
                  </g>
                )
              })()}
            </svg>
          )}

          {/* Y-axis labels */}
          <div className="absolute top-0 right-1 text-[10px] text-gray-500">{Math.round(maxPrice * 100)}%</div>
          <div className="absolute top-1/2 right-1 -translate-y-1/2 text-[10px] text-gray-500">{Math.round(((maxPrice + minPrice) / 2) * 100)}%</div>
          <div className="absolute bottom-4 right-1 text-[10px] text-gray-500">{Math.round(minPrice * 100)}%</div>
        </div>

        {/* Right-side labels at end of lines (Polymarket style) */}
        {isTri && !loading && (
          <div className="flex flex-col justify-center gap-0 ml-2 w-[90px] flex-shrink-0 relative" style={{ height: '208px' }}>
            {lines.map(l => {
              const lastPrice = l.prices.length > 0 ? l.prices[l.prices.length - 1] : 0
              // Position label vertically aligned with the line end
              const topPct = ((maxPrice - lastPrice) / priceRange) * 100
              return (
                <div
                  key={l.key}
                  className="absolute left-0 right-0 text-right pr-1"
                  style={{ top: `${Math.max(2, Math.min(88, topPct))}%` }}
                >
                  <div className="text-xs font-bold truncate" style={{ color: l.color }}>
                    {l.label}
                  </div>
                  <div className="text-lg font-bold" style={{ color: l.color }}>
                    {Math.round(lastPrice * 100)}%
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
