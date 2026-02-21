'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, Trophy, Loader2, MessageSquare, BarChart3, RefreshCw, DollarSign, Users, Settings, Shield, Clock, FileText, Gavel } from 'lucide-react'
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

interface Dispute {
  id: string
  reason: string
  evidence: string | null
  status: string
  adminResponse: string | null
  createdAt: string
  market: { id: string; title: string; winningOutcome: string | null; status: string }
  disputer: { id: string; username: string; email: string }
  resolvedBy: { id: string; username: string } | null
}

interface AuditEntry {
  id: string
  action: string
  category: string
  details: string
  ipAddress: string | null
  actorId: string | null
  createdAt: string
}

interface AdminUser {
  id: string
  email: string
  username: string
  fullName: string
  balance: number
  isVerified: boolean
  createdAt: string
  _count: { orders: number; positions: number; transactions: number }
}

interface Stats {
  totalUsers: number
  totalMarkets: number
  activeMarkets: number
  resolvedMarkets: number
  totalVolume: number
  totalRevenue: number
  pendingSuggestions: number
  openDisputes: number
  pendingPayments: number
  newUsersLast7Days: number
  revenueBreakdown: Record<string, { total: number; count: number }>
}

type TabType = 'suggestions' | 'markets' | 'disputes' | 'users' | 'audit' | 'sync' | 'stats'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isDarkMode } = useTheme()
  const [activeTab, setActiveTab] = useState<TabType>('suggestions')
  const [markets, setMarkets] = useState<any[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null)
  const [disputeResponse, setDisputeResponse] = useState('')
  const [disputeNewOutcome, setDisputeNewOutcome] = useState<string>('YES')
  const [showDisputeModal, setShowDisputeModal] = useState<{ id: string; action: 'UPHOLD' | 'REJECT' } | null>(null)
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
      const [marketsRes, suggestionsRes, statsRes, disputesRes, usersRes, auditRes] = await Promise.all([
        fetch('/api/markets'),
        fetch('/api/suggestions?admin=true&status=PENDING'),
        fetch('/api/admin/stats'),
        fetch('/api/admin/disputes?status=OPEN'),
        fetch('/api/admin/users'),
        fetch('/api/admin/audit'),
      ])
      
      if (marketsRes.ok) {
        setMarkets(await marketsRes.json())
      }
      if (suggestionsRes.ok) {
        const data = await suggestionsRes.json()
        setSuggestions(data.suggestions || [])
        setIsAdmin(data.isAdmin || false)
      }
      if (statsRes.ok) {
        setStats(await statsRes.json())
      }
      if (disputesRes.ok) {
        const data = await disputesRes.json()
        setDisputes(data.disputes || [])
      }
      if (usersRes.ok) {
        const data = await usersRes.json()
        setAdminUsers(data.users || [])
      }
      if (auditRes.ok) {
        const data = await auditRes.json()
        setAuditLogs(data.logs || [])
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const syncGames = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/sync-games', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setMessage({
        type: 'success',
        text: `Synced games: ${data.created} created, ${data.skipped} skipped`
      })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSyncing(false)
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

      if (data.action === 'VOIDED') {
        setMessage({ type: 'success', text: `Market voided! ${data.payoutsProcessed} refunds totaling ${formatZambianCurrency(data.totalPaidOut)}` })
      } else {
        setMessage({ type: 'success', text: `Market resolved to ${winningOutcome}. 24h dispute window opened. Payouts after ${new Date(data.disputeDeadline).toLocaleString()}.` })
      }

      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setResolving(null)
    }
  }

  const finalizeMarket = async (marketId: string) => {
    setResolving(marketId)
    setMessage(null)

    try {
      const res = await fetch('/api/markets/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, action: 'FINALIZE' })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to finalize')

      setMessage({ type: 'success', text: `Market finalized! Payouts processed. Fees collected: ${formatZambianCurrency(data.feesCollected || 0)}` })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setResolving(null)
    }
  }

  const handleDispute = async () => {
    if (!showDisputeModal) return
    setProcessing(showDisputeModal.id)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disputeId: showDisputeModal.id,
          action: showDisputeModal.action,
          adminResponse: disputeResponse,
          newOutcome: showDisputeModal.action === 'UPHOLD' ? disputeNewOutcome : undefined,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to resolve dispute')

      setMessage({ type: 'success', text: showDisputeModal.action === 'UPHOLD' ? 'Dispute upheld — outcome changed.' : 'Dispute rejected — resolution stands.' })
      setShowDisputeModal(null)
      setDisputeResponse('')
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
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
  const finalizedMarkets = markets.filter((m: any) => m.status === 'FINALIZED')

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
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('suggestions')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'markets'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Resolve ({activeMarkets.length})
            </button>
            <button
              onClick={() => setActiveTab('disputes')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'disputes'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <Gavel className="w-4 h-4" />
              Disputes ({disputes.length})
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'users'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <Users className="w-4 h-4" />
              Users
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'audit'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <FileText className="w-4 h-4" />
              Audit Log
            </button>
            <button
              onClick={() => setActiveTab('sync')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'sync'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <RefreshCw className="w-4 h-4" />
              Sync Games
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'stats'
                  ? 'border-green-500 text-green-500'
                  : `border-transparent ${textMuted} hover:${textColor}`
              }`}
            >
              <DollarSign className="w-4 h-4" />
              Stats
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
            <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
              <p className={`${textMuted} text-sm`}>No active markets to resolve.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeMarkets.map((market: any) => (
                <div key={market.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${textColor}`}>{market.title}</p>
                      <p className={`text-xs ${textMuted} mt-0.5`}>{market.question}</p>
                      <div className={`flex gap-3 mt-1 text-xs ${textMuted}`}>
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

                  <div className={`flex gap-2 mt-3 pt-3 border-t ${borderColor}`}>
                    <button
                      onClick={() => resolveMarket(market.id, 'YES')}
                      disabled={resolving === market.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                    >
                      {resolving === market.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
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

          {/* Resolved Markets — awaiting finalization */}
          {resolvedMarkets.length > 0 && (
            <div className="mt-6">
              <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
                Awaiting Finalization ({resolvedMarkets.length})
              </h2>
              <div className="space-y-3">
                {resolvedMarkets.map((market: any) => {
                  const deadline = market.disputeDeadline ? new Date(market.disputeDeadline) : null
                  const isPastDeadline = deadline ? new Date() > deadline : false
                  return (
                  <div key={market.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${textColor}`}>{market.title}</p>
                        <p className={`text-xs ${textMuted} mt-0.5`}>
                          Resolved: <span className="font-semibold">{market.winningOutcome}</span> — {new Date(market.resolvedAt || market.updatedAt).toLocaleDateString()}
                        </p>
                        {deadline && (
                          <p className={`text-xs mt-1 ${isPastDeadline ? 'text-green-400' : 'text-yellow-400'}`}>
                            <Clock className="w-3 h-3 inline mr-1" />
                            {isPastDeadline ? 'Dispute window closed — ready to finalize' : `Dispute window until ${deadline.toLocaleString()}`}
                          </p>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                        market.winningOutcome === 'YES' ? 'bg-green-500/20 text-green-400' :
                        market.winningOutcome === 'NO' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {market.winningOutcome}
                      </span>
                    </div>
                    <div className={`flex gap-2 mt-2 pt-2 border-t ${borderColor}`}>
                      <button
                        onClick={() => finalizeMarket(market.id)}
                        disabled={resolving === market.id || !isPastDeadline}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
                      >
                        {resolving === market.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
                        Finalize & Pay Out
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
                  )
                })}
              </div>
            </div>
          )}

          {/* Finalized Markets */}
          {finalizedMarkets.length > 0 && (
            <div className="mt-6">
              <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
                Finalized ({finalizedMarkets.length})
              </h2>
              <div className="space-y-2">
                {finalizedMarkets.slice(0, 10).map((market: any) => (
                  <div key={market.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-3 flex items-center gap-3`}>
                    <Trophy className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${textColor} truncate`}>{market.title}</p>
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

        {/* Disputes Tab */}
        {activeTab === 'disputes' && (
          <div>
            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Open Disputes ({disputes.length})
            </h2>
            {disputes.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <Gavel className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>No open disputes.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {disputes.map((dispute) => (
                  <div key={dispute.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${textColor}`}>{dispute.market.title}</p>
                        <p className={`text-xs ${textMuted} mt-0.5`}>
                          Current outcome: <span className="font-semibold">{dispute.market.winningOutcome}</span> • Disputed by: {dispute.disputer.username}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 text-xs font-bold rounded bg-orange-500/20 text-orange-400">
                        {dispute.status}
                      </span>
                    </div>
                    <div className={`${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} rounded-lg p-3 mb-3`}>
                      <p className={`text-xs font-medium ${textMuted} mb-1`}>Reason:</p>
                      <p className={`text-sm ${textColor}`}>{dispute.reason}</p>
                      {dispute.evidence && (
                        <p className={`text-xs ${textMuted} mt-2`}>Evidence: {dispute.evidence}</p>
                      )}
                    </div>
                    <p className={`text-[10px] ${textMuted} mb-3`}>
                      Filed: {new Date(dispute.createdAt).toLocaleString()}
                    </p>
                    <div className={`flex gap-2 pt-3 border-t ${borderColor}`}>
                      <button
                        onClick={() => { setShowDisputeModal({ id: dispute.id, action: 'UPHOLD' }); setDisputeResponse(''); }}
                        disabled={processing === dispute.id}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Uphold
                      </button>
                      <button
                        onClick={() => { setShowDisputeModal({ id: dispute.id, action: 'REJECT' }); setDisputeResponse(''); }}
                        disabled={processing === dispute.id}
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

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div>
            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Users ({adminUsers.length})
            </h2>
            {adminUsers.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <Users className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>No users found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {adminUsers.map((u) => (
                  <div key={u.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4 flex items-center gap-3`}>
                    <div className={`w-9 h-9 rounded-full ${isDarkMode ? 'bg-blue-500/10' : 'bg-blue-50'} flex items-center justify-center flex-shrink-0`}>
                      <span className={`text-sm font-bold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {u.fullName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${textColor} truncate`}>{u.fullName}</p>
                        {u.isVerified && <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />}
                      </div>
                      <p className={`text-xs ${textMuted} truncate`}>@{u.username} • {u.email}</p>
                      <div className={`flex gap-3 text-[10px] ${textMuted} mt-0.5`}>
                        <span>{u._count.orders} orders</span>
                        <span>{u._count.positions} positions</span>
                        <span>Joined {new Date(u.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${textColor}`}>{formatZambianCurrency(u.balance)}</p>
                      <p className={`text-[10px] ${textMuted}`}>balance</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === 'audit' && (
          <div>
            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Audit Log (Recent {auditLogs.length})
            </h2>
            {auditLogs.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <FileText className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>No audit entries yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((log) => {
                  let details: any = {}
                  try { details = JSON.parse(log.details) } catch {}
                  const actionColor = log.action.includes('RESOLVED') ? 'text-blue-400' :
                    log.action.includes('UPHELD') ? 'text-green-400' :
                    log.action.includes('REJECTED') ? 'text-red-400' :
                    log.action.includes('FINALIZED') ? 'text-yellow-400' : textMuted
                  return (
                    <div key={log.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-3`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-100'} ${actionColor}`}>
                            {log.action}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-100'} ${textMuted}`}>
                            {log.category}
                          </span>
                        </div>
                        <span className={`text-[10px] ${textMuted}`}>
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className={`text-xs ${textMuted} truncate`}>
                        {details.marketId ? `Market: ${details.marketId.slice(0, 8)}...` : ''}
                        {details.winningOutcome ? ` → ${details.winningOutcome}` : ''}
                        {details.disputeId ? ` Dispute: ${details.disputeId.slice(0, 8)}...` : ''}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Sync Games Tab */}
        {activeTab === 'sync' && (
          <div>
            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Sync Sports Games
            </h2>
            <div className={`${surfaceColor} border ${borderColor} rounded-xl p-6`}>
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-full ${isDarkMode ? 'bg-green-500/10' : 'bg-green-50'} flex items-center justify-center flex-shrink-0`}>
                  <RefreshCw className="w-6 h-6 text-green-500" />
                </div>
                <div className="flex-1">
                  <h3 className={`text-base font-semibold ${textColor} mb-1`}>Auto-Sync Scheduled Games</h3>
                  <p className={`text-sm ${textMuted} mb-4`}>
                    Fetch upcoming matches from the sports API and automatically create markets for them. 
                    This will skip games that already have markets.
                  </p>
                  <button
                    onClick={syncGames}
                    disabled={syncing || !isAdmin}
                    className="px-6 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    {syncing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Sync Now
                      </>
                    )}
                  </button>
                  {!isAdmin && (
                    <p className="text-xs text-yellow-400 mt-2">Admin access required</p>
                  )}
                </div>
              </div>
            </div>
            <p className={`text-xs ${textMuted} mt-4`}>
              Tip: Games are automatically synced hourly. Use this button to manually trigger a sync.
            </p>
          </div>
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && (
          <div>
            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Platform Statistics
            </h2>
            {stats ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-blue-400" />
                    <span className={`text-xs ${textMuted}`}>Total Users</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.totalUsers.toLocaleString()}</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-purple-400" />
                    <span className={`text-xs ${textMuted}`}>Total Markets</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.totalMarkets.toLocaleString()}</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Trophy className="w-4 h-4 text-green-400" />
                    <span className={`text-xs ${textMuted}`}>Active Markets</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.activeMarkets.toLocaleString()}</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-cyan-400" />
                    <span className={`text-xs ${textMuted}`}>Total Volume</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{formatZambianCurrency(stats.totalVolume)}</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-yellow-400" />
                    <span className={`text-xs ${textMuted}`}>Platform Revenue</span>
                  </div>
                  <p className={`text-2xl font-bold text-green-500`}>{formatZambianCurrency(stats.totalRevenue)}</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="w-4 h-4 text-orange-400" />
                    <span className={`text-xs ${textMuted}`}>Pending Suggestions</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.pendingSuggestions}</p>
                </div>
              </div>
            ) : (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <p className={textMuted}>Loading stats...</p>
              </div>
            )}
          </div>
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

      {/* Dispute Resolution Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowDisputeModal(null)} />
          <div className={`relative ${surfaceColor} rounded-xl shadow-2xl w-full max-w-md p-6`}>
            <h3 className={`text-lg font-semibold ${textColor} mb-4`}>
              {showDisputeModal.action === 'UPHOLD' ? 'Uphold Dispute' : 'Reject Dispute'}
            </h3>
            <textarea
              value={disputeResponse}
              onChange={(e) => setDisputeResponse(e.target.value)}
              placeholder="Admin response (required)..."
              rows={3}
              className={`w-full px-4 py-2.5 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm resize-none`}
            />
            {showDisputeModal.action === 'UPHOLD' && (
              <div className="mt-3">
                <label className={`text-sm ${textMuted} mb-1 block`}>New Correct Outcome</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDisputeNewOutcome('YES')}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                      disputeNewOutcome === 'YES' ? 'bg-green-500 text-white' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`
                    }`}
                  >
                    YES
                  </button>
                  <button
                    onClick={() => setDisputeNewOutcome('NO')}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                      disputeNewOutcome === 'NO' ? 'bg-red-500 text-white' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`
                    }`}
                  >
                    NO
                  </button>
                </div>
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowDisputeModal(null)}
                className={`flex-1 py-2 text-sm font-medium border ${borderColor} rounded-lg ${textMuted}`}
              >
                Cancel
              </button>
              <button
                onClick={handleDispute}
                disabled={!disputeResponse.trim() || processing === showDisputeModal.id}
                className={`flex-1 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
                  showDisputeModal.action === 'UPHOLD' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {processing === showDisputeModal.id ? 'Processing...' : showDisputeModal.action === 'UPHOLD' ? 'Confirm Uphold' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
