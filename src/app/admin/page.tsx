'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, Trophy } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [markets, setMarkets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
  }, [status, router])

  useEffect(() => {
    if (status !== 'authenticated') return
    loadMarkets()
  }, [status])

  const loadMarkets = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/markets')
      if (res.ok) {
        const data = await res.json()
        setMarkets(data)
      }
    } catch (err) {
      console.error('Failed to load markets:', err)
    } finally {
      setLoading(false)
    }
  }

  const resolveMarket = async (marketId: string, winningOutcome: string) => {
    setResolving(marketId)
    setMessage(null)

    try {
      const res = await fetch('/api/markets/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, winningOutcome })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to resolve')

      setMessage({
        type: 'success',
        text: `Market resolved! ${data.payoutsProcessed} payouts totaling ${formatZambianCurrency(data.totalPaidOut)}`
      })

      // Reload markets
      await loadMarkets()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setResolving(null)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#131722] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  const activeMarkets = markets.filter((m: any) => m.status === 'ACTIVE' || m.status === 'PENDING')
  const resolvedMarkets = markets.filter((m: any) => m.status === 'RESOLVED')

  return (
    <div className="min-h-screen bg-[#131722]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-[#171924]">
        <div className="max-w-[1000px] mx-auto px-4">
          <div className="flex items-center h-14 gap-4">
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-white">Admin — Resolve Markets</h1>
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-4 py-6 space-y-6">
        {/* Message */}
        {message && (
          <div className={`rounded-xl p-4 text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* Active Markets */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">
            Active Markets ({activeMarkets.length})
          </h2>
          {activeMarkets.length === 0 ? (
            <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">No active markets to resolve.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeMarkets.map((market: any) => (
                <div key={market.id} className="bg-[#1c2030] border border-gray-800 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{market.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{market.question}</p>
                      <div className="flex gap-3 mt-1 text-xs text-gray-500">
                        <span>Vol: {formatZambianCurrency(market.volume || 0)}</span>
                        <span>Resolves: {new Date(market.resolveTime).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 text-xs">
                      <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                        YES {(market.yesPrice * 100).toFixed(0)}%
                      </span>
                      <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                        NO {(market.noPrice * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {/* Resolution Buttons */}
                  <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
                    <button
                      onClick={() => resolveMarket(market.id, 'YES')}
                      disabled={resolving === market.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle className="w-4 h-4" />
                      YES Wins
                    </button>
                    <button
                      onClick={() => resolveMarket(market.id, 'NO')}
                      disabled={resolving === market.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      NO Wins
                    </button>
                    <button
                      onClick={() => resolveMarket(market.id, 'VOID')}
                      disabled={resolving === market.id}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/20 disabled:opacity-50 transition-colors"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Void
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resolved Markets */}
        {resolvedMarkets.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">
              Resolved Markets ({resolvedMarkets.length})
            </h2>
            <div className="space-y-2">
              {resolvedMarkets.map((market: any) => (
                <div key={market.id} className="bg-[#1c2030] border border-gray-800 rounded-xl p-4 flex items-center gap-3">
                  <Trophy className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{market.title}</p>
                    <p className="text-xs text-gray-500">
                      Resolved: {market.winningOutcome} — {new Date(market.resolvedAt || market.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                    market.winningOutcome === 'YES' ? 'bg-green-500/20 text-green-400' :
                    market.winningOutcome === 'NO' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {market.winningOutcome}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
