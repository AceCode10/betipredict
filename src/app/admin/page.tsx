'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, Trophy, Loader2, MessageSquare, BarChart3 } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'
import { useTheme } from '@/contexts/ThemeContext'

interface Suggestion {
  id: string
  title: string
  description: string | null
  category: string
  question: string
  resolutionSource: string | null
  status: string
  rejectionReason: string | null
  createdAt: string
  suggester: { id: string; username: string; fullName: string; avatar: string | null }
}

type TabType = 'markets' | 'suggestions'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isDarkMode } = useTheme()
  const [activeTab, setActiveTab] = useState<TabType>('suggestions')
  const [markets, setMarkets] = useState<any[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const bgColor = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'
  const surfaceColor = isDarkMode ? 'bg-[#1c2030]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-800' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
  }, [status, router])

  useEffect(() => {
    if (status !== 'authenticated') return
    loadData()
  }, [status])

  const loadData = async () => {
    setLoading(true)
    try {
      const [marketsRes, suggestionsRes] = await Promise.all([
        fetch('/api/markets'),
        fetch('/api/suggestions?admin=true&status=PENDING')
      ])
      
      if (marketsRes.ok) {
        setMarkets(await marketsRes.json())
      }
      if (suggestionsRes.ok) {
        const data = await suggestionsRes.json()
        setSuggestions(data.suggestions || [])
        setIsAdmin(data.isAdmin || false)
      }
    } catch (err) {
      console.error('Failed to load data:', err)
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

      // Reload data
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setResolving(null)
    }
  }

  const handleSuggestion = async (suggestionId: string, action: 'APPROVED' | 'REJECTED') => {
    setProcessing(suggestionId)
    setMessage(null)

    try {
      const res = await fetch('/api/suggestions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId,
          action,
          rejectionReason: action === 'REJECTED' ? rejectionReason : undefined
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to process suggestion')

      setMessage({
        type: 'success',
        text: action === 'APPROVED' 
          ? 'Suggestion approved and market created!'
          : 'Suggestion rejected.'
      })

      setShowRejectModal(null)
      setRejectionReason('')
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
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
    <div className={`min-h-screen ${bgColor}`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 border-b ${borderColor} ${isDarkMode ? 'bg-[#171924]' : 'bg-white'}`}>
        <div className="max-w-[1000px] mx-auto px-4">
          <div className="flex items-center h-14 gap-4">
            <button onClick={() => router.push('/')} className={`${textMuted} hover:${textColor}`}>
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className={`text-lg font-bold ${textColor}`}>Admin Dashboard</h1>
            {!isAdmin && (
              <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                Limited Access
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className={`border-b ${borderColor} ${isDarkMode ? 'bg-[#171924]' : 'bg-white'}`}>
        <div className="max-w-[1000px] mx-auto px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('suggestions')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'suggestions'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Suggestions ({suggestions.length})
            </button>
            <button
              onClick={() => setActiveTab('markets')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'markets'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Resolve Markets ({activeMarkets.length})
            </button>
          </div>
        </div>
      </div>

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

        {/* Suggestions Tab */}
        {activeTab === 'suggestions' && (
          <div>
            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Pending Suggestions ({suggestions.length})
            </h2>
            {!isAdmin ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <p className={`${textMuted} text-sm`}>Admin access required to review suggestions.</p>
              </div>
            ) : suggestions.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <MessageSquare className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>No pending suggestions to review.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {suggestions.map((suggestion) => (
                  <div key={suggestion.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 text-[10px] font-medium rounded ${isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                            {suggestion.category}
                          </span>
                          <span className={`text-xs ${textMuted}`}>
                            by {suggestion.suggester.username || suggestion.suggester.fullName}
                          </span>
                        </div>
                        <p className={`text-sm font-medium ${textColor}`}>{suggestion.title}</p>
                        <p className={`text-xs ${textMuted} mt-0.5`}>{suggestion.question}</p>
                        {suggestion.description && (
                          <p className={`text-xs ${textMuted} mt-1 line-clamp-2`}>{suggestion.description}</p>
                        )}
                        {suggestion.resolutionSource && (
                          <p className={`text-xs ${textMuted} mt-1`}>
                            <span className="font-medium">Resolution:</span> {suggestion.resolutionSource}
                          </p>
                        )}
                        <p className={`text-[10px] ${textMuted} mt-2`}>
                          Submitted: {new Date(suggestion.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className={`flex gap-2 mt-3 pt-3 border-t ${borderColor}`}>
                      <button
                        onClick={() => handleSuggestion(suggestion.id, 'APPROVED')}
                        disabled={processing === suggestion.id}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                      >
                        {processing === suggestion.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        Approve
                      </button>
                      <button
                        onClick={() => setShowRejectModal(suggestion.id)}
                        disabled={processing === suggestion.id}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Markets Tab */}
        {activeTab === 'markets' && (
          <>
          <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
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

          {/* Resolved Markets */}
          {resolvedMarkets.length > 0 && (
            <div>
              <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
                Resolved Markets ({resolvedMarkets.length})
              </h2>
              <div className="space-y-2">
                {resolvedMarkets.map((market: any) => (
                  <div key={market.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4 flex items-center gap-3`}>
                    <Trophy className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${textColor} truncate`}>{market.title}</p>
                      <p className={`text-xs ${textMuted}`}>
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
          </>
        )}
      </main>

      {/* Rejection Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowRejectModal(null)} />
          <div className={`relative ${surfaceColor} rounded-xl shadow-2xl w-full max-w-md p-6`}>
            <h3 className={`text-lg font-semibold ${textColor} mb-4`}>Reject Suggestion</h3>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Reason for rejection (optional)..."
              rows={3}
              className={`w-full px-4 py-2.5 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm resize-none`}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowRejectModal(null)}
                className={`flex-1 py-2 text-sm font-medium border ${borderColor} rounded-lg ${textMuted} hover:${textColor}`}
              >
                Cancel
              </button>
              <button
                onClick={() => handleSuggestion(showRejectModal, 'REJECTED')}
                disabled={processing === showRejectModal}
                className="flex-1 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
              >
                {processing === showRejectModal ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
