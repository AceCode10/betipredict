'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

export interface LiveTradeToast {
  id: string
  username: string
  side: string
  outcome: string
  price: number
  amount: number
  marketTitle: string
  marketId: string
  createdAt: string
}

interface LiveBetToastProps {
  trades: LiveTradeToast[]
  maxVisible?: number
}

export function LiveBetToast({ trades, maxVisible = 3 }: LiveBetToastProps) {
  const [visibleToasts, setVisibleToasts] = useState<(LiveTradeToast & { exiting?: boolean })[]>([])
  const seenIds = useRef(new Set<string>())

  // Add new trades to visible queue
  useEffect(() => {
    const newTrades = trades.filter(t => !seenIds.current.has(t.id))
    if (newTrades.length === 0) return

    for (const t of newTrades) {
      seenIds.current.add(t.id)
    }

    setVisibleToasts(prev => {
      const updated = [...newTrades, ...prev].slice(0, maxVisible + 2)
      return updated
    })
  }, [trades, maxVisible])

  // Auto-dismiss toasts after 4 seconds
  useEffect(() => {
    if (visibleToasts.length === 0) return

    const timer = setTimeout(() => {
      setVisibleToasts(prev => {
        if (prev.length === 0) return prev
        // Mark the oldest toast as exiting
        const updated = [...prev]
        updated[updated.length - 1] = { ...updated[updated.length - 1], exiting: true }
        return updated
      })

      // Remove after exit animation
      setTimeout(() => {
        setVisibleToasts(prev => prev.slice(0, -1))
      }, 300)
    }, 4000)

    return () => clearTimeout(timer)
  }, [visibleToasts.length])

  // Limit to keep GC on seenIds
  useEffect(() => {
    if (seenIds.current.size > 200) {
      const arr = Array.from(seenIds.current)
      seenIds.current = new Set(arr.slice(-100))
    }
  }, [trades])

  if (visibleToasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col gap-2 pointer-events-none max-w-xs sm:max-w-sm">
      {visibleToasts.slice(0, maxVisible).map((toast, i) => (
        <div
          key={toast.id}
          className={`pointer-events-auto bg-[#1e2130] border border-gray-700/60 rounded-lg px-3 py-2.5 shadow-xl backdrop-blur-sm transition-all duration-300 ${
            toast.exiting ? 'opacity-0 translate-x-[-20px]' : 'opacity-100 translate-x-0'
          }`}
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <div className="flex items-center gap-2">
            <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
              toast.outcome === 'YES' ? 'bg-green-500/20' : 'bg-red-500/20'
            }`}>
              {toast.side === 'BUY' ? (
                <TrendingUp className={`w-3.5 h-3.5 ${toast.outcome === 'YES' ? 'text-green-400' : 'text-red-400'}`} />
              ) : (
                <TrendingDown className={`w-3.5 h-3.5 ${toast.outcome === 'YES' ? 'text-green-400' : 'text-red-400'}`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 font-medium">{toast.username}</span>
                <span className="text-[11px] text-gray-600">
                  {toast.side === 'BUY' ? 'bought' : 'sold'}
                </span>
                <span className={`text-[11px] font-bold ${toast.outcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                  {toast.outcome}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-white font-semibold">
                  {formatZambianCurrency(toast.amount * toast.price)}
                </span>
                <span className="text-[10px] text-gray-500 truncate">
                  {toast.marketTitle}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
