'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

export interface LiveTrade {
  id: string
  side: string
  outcome: string
  price: number
  amount: number
  createdAt: string
  marketId: string
  username: string
  marketTitle: string
  marketQuestion?: string
}

export interface MarketPriceUpdate {
  id: string
  yesPrice: number
  noPrice: number
  volume: number
  liquidity: number
}

interface StreamCallbacks {
  onPriceUpdate?: (markets: MarketPriceUpdate[]) => void
  onNewTrades?: (trades: LiveTrade[]) => void
  onSnapshot?: (markets: any[]) => void
}

/**
 * SSE hook for real-time market data.
 * Automatically reconnects with exponential backoff.
 * Cleans up on unmount.
 */
export function useMarketStream(callbacks: StreamCallbacks) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(1000)
  const mountedRef = useRef(true)
  const [isConnected, setIsConnected] = useState(false)

  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    try {
      const es = new EventSource('/api/markets/stream')
      eventSourceRef.current = es

      es.onopen = () => {
        if (!mountedRef.current) return
        setIsConnected(true)
        reconnectDelayRef.current = 1000 // Reset backoff
      }

      es.addEventListener('snapshot', (e) => {
        if (!mountedRef.current) return
        try {
          const data = JSON.parse(e.data)
          callbacksRef.current.onSnapshot?.(data.markets)
        } catch {}
      })

      es.addEventListener('prices', (e) => {
        if (!mountedRef.current) return
        try {
          const data = JSON.parse(e.data)
          callbacksRef.current.onPriceUpdate?.(data.markets)
        } catch {}
      })

      es.addEventListener('trades', (e) => {
        if (!mountedRef.current) return
        try {
          const data = JSON.parse(e.data)
          const trades: LiveTrade[] = data.trades.map((t: any) => ({
            id: t.id,
            side: t.side,
            outcome: t.outcome,
            price: t.price,
            amount: t.amount,
            createdAt: t.createdAt,
            marketId: t.marketId,
            username: t.user?.username?.slice(0, 3) + '***' || 'anon',
            marketTitle: t.market?.title || '',
            marketQuestion: t.market?.question || '',
          }))
          callbacksRef.current.onNewTrades?.(trades)
        } catch {}
      })

      es.onerror = () => {
        if (!mountedRef.current) return
        setIsConnected(false)
        es.close()
        
        // Exponential backoff reconnect (max 30s)
        const delay = Math.min(reconnectDelayRef.current, 30000)
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectDelayRef.current = delay * 1.5
          connect()
        }, delay)
      }
    } catch {
      // EventSource not supported or blocked
      setIsConnected(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [connect])

  return { isConnected }
}
