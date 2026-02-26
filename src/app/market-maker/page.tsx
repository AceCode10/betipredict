'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/contexts/ThemeContext'
import { formatZambianCurrency } from '@/utils/currency'
import {
  ArrowLeft, CheckCircle, XCircle, RefreshCw, Loader2, Trophy,
  BarChart3, Clock, Search, Settings, ChevronDown, ChevronUp,
  Zap, Eye, AlertTriangle, DollarSign, TrendingUp
} from 'lucide-react'

interface PendingMarket {
  id: string
  title: string
  description: string | null
  homeTeam: string | null
  awayTeam: string | null
  league: string | null
  yesPrice: number
  noPrice: number
  drawPrice: number | null
  resolveTime: string
  createdAt: string
  marketType: string
  scheduledGame?: {
    externalId: number
    competition: string
    competitionCode: string
    homeTeamCrest: string | null
    awayTeamCrest: string | null
    utcDate: string
    matchday: number | null
  }
}

interface ActiveMarket {
  id: string
  title: string
  homeTeam: string | null
  awayTeam: string | null
  league: string | null
  yesPrice: number
  noPrice: number
  drawPrice: number | null
  volume: number
  resolveTime: string
  status: string
  scheduledGame?: {
    status: string
    homeScore: number | null
    awayScore: number | null
    homeTeamCrest: string | null
    awayTeamCrest: string | null
  }
  _count?: { orders: number; positions: number }
}

interface Suggestion {
  id: string
  title: string
  description: string | null
  category: string
  question: string
  status: string
  createdAt: string
  suggester: { id: string; username: string; fullName: string; avatar: string | null }
}

const LEAGUES = [
  { code: 'PL', name: 'Premier League' },
  { code: 'PD', name: 'La Liga' },
  { code: 'BL1', name: 'Bundesliga' },
  { code: 'SA', name: 'Serie A' },
  { code: 'FL1', name: 'Ligue 1' },
  { code: 'CL', name: 'Champions League' },
]

type TabType = 'pending' | 'active' | 'suggestions' | 'sync' | 'categories'

export default function MarketMakerPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isDarkMode } = useTheme()

  const [activeTab, setActiveTab] = useState<TabType>('pending')
  const [pendingMarkets, setPendingMarkets] = useState<PendingMarket[]>([])
  const [activeMarkets, setActiveMarkets] = useState<ActiveMarket[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncLeague, setSyncLeague] = useState<string>('all')
  const [processing, setProcessing] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // Price editing state: { [marketId]: { home, draw, away } }
  const [priceEdits, setPriceEdits] = useState<Record<string, { home: string; draw: string; away: string }>>({})
  // Selected markets for bulk approve
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPrices, setBulkPrices] = useState({ home: '33', draw: '33', away: '33' })
  // Suggestion price modal — supports Yes/No and tri-outcome with category editing
  const [suggestionModal, setSuggestionModal] = useState<{
    suggestion: Suggestion;
    prices: { home: string; draw: string; away: string };
    isTri: boolean;
    category: string;
    title: string;
    question: string;
  } | null>(null)

  const bgColor = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'
  const surfaceColor = isDarkMode ? 'bg-[#1c2030]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-800' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const inputBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-100'

  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
  }, [status, router])

  // Server-side admin check — redirect non-admins
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/admin/check')
      .then(r => r.json())
      .then(data => {
        if (data.isAdmin) {
          setAuthorized(true)
        } else {
          router.push('/')
        }
      })
      .catch(() => router.push('/'))
  }, [status, router])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [pendingRes, activeRes, suggestionsRes, statsRes] = await Promise.all([
        fetch('/api/market-maker?tab=pending'),
        fetch('/api/market-maker?tab=active'),
        fetch('/api/market-maker?tab=suggestions'),
        fetch('/api/market-maker?tab=stats'),
      ])

      if (pendingRes.ok) {
        const data = await pendingRes.json()
        setPendingMarkets(data.markets || [])
      }
      if (activeRes.ok) {
        const data = await activeRes.json()
        setActiveMarkets(data.markets || [])
      }
      if (suggestionsRes.ok) {
        const data = await suggestionsRes.json()
        setSuggestions(data.suggestions || [])
      }
      if (statsRes.ok) {
        setStats(await statsRes.json())
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && authorized) loadData()
  }, [status, authorized, loadData])

  // Auto-populate price edits from DB prices when pending markets load
  // Treat Prisma defaults (0.5/0.5/null) as unset → use 33/33/33
  useEffect(() => {
    if (pendingMarkets.length === 0) return
    setPriceEdits(prev => {
      const next = { ...prev }
      for (const m of pendingMarkets) {
        if (!next[m.id]) {
          const isPrismaDefault = m.yesPrice === 0.5 && m.noPrice === 0.5 && (m.drawPrice === null || m.drawPrice === undefined)
          next[m.id] = {
            home: String(Math.round((isPrismaDefault ? 0.33 : m.yesPrice) * 100)),
            draw: String(Math.round((isPrismaDefault ? 0.33 : (m.drawPrice ?? 0.33)) * 100)),
            away: String(Math.round((isPrismaDefault ? 0.33 : m.noPrice) * 100)),
          }
        }
      }
      return next
    })
  }, [pendingMarkets])

  // ─── Actions ───

  const approveMarket = async (marketId: string) => {
    const edit = priceEdits[marketId]
    if (!edit || !edit.home || !edit.draw || !edit.away) {
      setMessage({ type: 'error', text: 'Please set all three prices before approving' })
      return
    }
    const hp = parseFloat(edit.home) / 100
    const dp = parseFloat(edit.draw) / 100
    const ap = parseFloat(edit.away) / 100

    if (hp < 0.01 || dp < 0.01 || ap < 0.01 || hp > 0.99 || dp > 0.99 || ap > 0.99) {
      setMessage({ type: 'error', text: 'Each price must be between 1% and 99%' })
      return
    }

    setProcessing(marketId)
    setMessage(null)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', marketId, homePrice: hp, drawPrice: dp, awayPrice: ap }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: `Market approved: ${data.market?.title || marketId}` })
      setPriceEdits(prev => { const n = { ...prev }; delete n[marketId]; return n })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  const denyMarket = async (marketId: string) => {
    setProcessing(marketId)
    setMessage(null)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deny', marketId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: 'Market denied' })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  const bulkApprove = async () => {
    if (selectedIds.size === 0) return
    const hp = parseFloat(bulkPrices.home) / 100
    const dp = parseFloat(bulkPrices.draw) / 100
    const ap = parseFloat(bulkPrices.away) / 100

    if (hp < 0.01 || dp < 0.01 || ap < 0.01) {
      setMessage({ type: 'error', text: 'All prices must be > 0%' })
      return
    }

    setProcessing('bulk')
    setMessage(null)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk-approve',
          marketIds: Array.from(selectedIds),
          homePrice: hp,
          drawPrice: dp,
          awayPrice: ap,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: data.message })
      setSelectedIds(new Set())
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  const syncGames = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const body: any = { action: 'sync' }
      if (syncLeague !== 'all') body.league = syncLeague

      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setMessage({
        type: 'success',
        text: `Synced ${data.leagues?.join(', ')}: ${data.created} created, ${data.skipped} skipped${data.oddsApplied ? `, ${data.oddsApplied} odds-priced` : ''}`,
      })
      await loadData()
    } catch (err: any) {
      const msg = err.message === 'Failed to fetch'
        ? 'Request timed out. Try syncing a single league instead of all.'
        : err.message
      setMessage({ type: 'error', text: msg })
    } finally {
      setSyncing(false)
    }
  }

  const approveSuggestion = async () => {
    if (!suggestionModal) return
    const { suggestion, prices, isTri, category, title, question } = suggestionModal
    const hp = parseFloat(prices.home) / 100
    const dp = isTri ? parseFloat(prices.draw) / 100 : 0
    const ap = isTri ? parseFloat(prices.away) / 100 : parseFloat(prices.away) / 100

    if (isTri && (hp + dp + ap > 1.0)) {
      setMessage({ type: 'error', text: `Prices sum to ${((hp + dp + ap) * 100).toFixed(0)}% which exceeds 100%` })
      return
    }
    if (!isTri && (hp + ap > 1.0)) {
      setMessage({ type: 'error', text: `Prices sum to ${((hp + ap) * 100).toFixed(0)}% which exceeds 100%` })
      return
    }

    setProcessing(suggestion.id)
    setMessage(null)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve-suggestion',
          suggestionId: suggestion.id,
          homePrice: hp,
          drawPrice: dp,
          awayPrice: ap,
          category,
          title,
          question,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: 'Suggestion approved and market created' })
      setSuggestionModal(null)
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  const denySuggestion = async (suggestionId: string) => {
    setProcessing(suggestionId)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deny-suggestion', suggestionId }),
      })
      if (!res.ok) throw new Error('Failed')
      setMessage({ type: 'success', text: 'Suggestion denied' })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  const revertToPending = async (marketId: string) => {
    setProcessing(marketId)
    setMessage(null)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert-to-pending', marketId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: 'Market reverted to pending — set new prices and re-approve' })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  const refreshOdds = async () => {
    setProcessing('refresh-odds')
    setMessage(null)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-odds' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: data.message })
      // Clear price edits so they re-populate from updated DB
      setPriceEdits({})
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  const revertLegacy = async () => {
    setProcessing('revert-legacy')
    setMessage(null)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert-legacy' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: data.message })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setProcessing(null)
    }
  }

  // ─── Helpers ───

  const setPriceForMarket = (marketId: string, field: 'home' | 'draw' | 'away', value: string) => {
    setPriceEdits(prev => ({
      ...prev,
      [marketId]: { ...(prev[marketId] || { home: '', draw: '', away: '' }), [field]: value },
    }))
  }

  const initPriceEdit = (market: PendingMarket) => {
    if (!priceEdits[market.id]) {
      const isPrismaDefault = market.yesPrice === 0.5 && market.noPrice === 0.5 && (market.drawPrice === null || market.drawPrice === undefined)
      setPriceEdits(prev => ({
        ...prev,
        [market.id]: {
          home: String(Math.round((isPrismaDefault ? 0.33 : market.yesPrice) * 100)),
          draw: String(Math.round((isPrismaDefault ? 0.33 : (market.drawPrice ?? 0.33)) * 100)),
          away: String(Math.round((isPrismaDefault ? 0.33 : market.noPrice) * 100)),
        }
      }))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredPending.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredPending.map(m => m.id)))
    }
  }

  const filteredPending = pendingMarkets.filter(m =>
    !searchQuery || m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.league?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredActive = activeMarkets.filter(m =>
    !searchQuery || m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.league?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (status === 'loading') {
    return (
      <div className={`min-h-screen ${bgColor} flex items-center justify-center`}>
        <Loader2 className="w-8 h-8 animate-spin text-green-500" />
      </div>
    )
  }

  const tabs = [
    { id: 'pending' as TabType, label: 'Pending Markets', icon: Clock, badge: pendingMarkets.length },
    { id: 'active' as TabType, label: 'Active Markets', icon: TrendingUp, badge: activeMarkets.length },
    { id: 'suggestions' as TabType, label: 'Suggestions', icon: Zap, badge: suggestions.length },
    { id: 'sync' as TabType, label: 'Sync Games', icon: RefreshCw },
    { id: 'categories' as TabType, label: 'Categories', icon: Settings },
  ]

  return (
    <div className={`min-h-screen ${bgColor} flex`}>
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-16'} flex-shrink-0 ${isDarkMode ? 'bg-[#171924]' : 'bg-white'} border-r ${borderColor} flex flex-col transition-all duration-200 fixed h-full z-30`}>
        <div className={`flex items-center ${sidebarOpen ? 'justify-between px-4' : 'justify-center'} h-14 border-b ${borderColor}`}>
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <button onClick={() => router.push('/')} className={`${textMuted} hover:${textColor}`}>
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h1 className={`text-sm font-bold ${textColor}`}>Market Maker</h1>
            </div>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className={`p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-100'} ${textMuted}`}>
            <Settings className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center ${sidebarOpen ? 'gap-3 px-4' : 'justify-center'} py-2.5 text-sm transition-colors ${
                activeTab === tab.id
                  ? isDarkMode ? 'bg-green-500/10 text-green-400 border-l-2 border-green-500' : 'bg-green-50 text-green-700 border-l-2 border-green-500'
                  : `${textMuted} hover:${textColor} ${isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-50'} border-l-2 border-transparent`
              }`}
              title={!sidebarOpen ? tab.label : undefined}
            >
              <tab.icon className="w-4 h-4 flex-shrink-0" />
              {sidebarOpen && (
                <>
                  <span className="flex-1 text-left">{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      activeTab === tab.id
                        ? 'bg-green-500/20 text-green-400'
                        : isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </nav>

        {/* Stats footer */}
        {sidebarOpen && stats && (
          <div className={`px-4 py-3 border-t ${borderColor} space-y-1`}>
            <div className="flex justify-between text-[11px]">
              <span className={textMuted}>Pending</span>
              <span className="text-yellow-400 font-semibold">{stats.pending}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className={textMuted}>Active</span>
              <span className="text-green-400 font-semibold">{stats.active}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className={textMuted}>Resolved</span>
              <span className={`${textColor} font-semibold`}>{stats.resolved}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className={textMuted}>Volume</span>
              <span className={`${textColor} font-semibold`}>{formatZambianCurrency(stats.totalVolume)}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className={`flex-1 ${sidebarOpen ? 'ml-56' : 'ml-16'} transition-all duration-200 min-h-screen`}>
        {/* Top bar */}
        <div className={`sticky top-0 z-20 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border-b ${borderColor} px-6 py-3 flex items-center gap-4`}>
          <h2 className={`text-lg font-bold ${textColor}`}>
            {tabs.find(t => t.id === activeTab)?.label}
          </h2>
          <div className="flex-1" />
          <div className={`flex items-center ${inputBg} border ${borderColor} rounded-lg px-3 py-1.5`}>
            <Search className={`w-4 h-4 ${textMuted}`} />
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className={`bg-transparent border-none outline-none text-sm ${textColor} ml-2 w-48`}
            />
          </div>
          <button onClick={loadData} className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-100'} ${textMuted}`}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="p-6">
          {/* Message banner */}
          {message && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
              message.type === 'success'
                ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                : 'bg-red-500/10 text-red-400 border border-red-500/30'
            }`}>
              {message.text}
            </div>
          )}

          {/* ─── PENDING MARKETS TAB ─── */}
          {activeTab === 'pending' && (
            <div>
              {/* Bulk actions bar */}
              {filteredPending.length > 0 && (
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4 mb-4`}>
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filteredPending.length && filteredPending.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-gray-600 text-green-500 focus:ring-green-500"
                      />
                      <span className={`text-sm ${textColor}`}>Select All ({filteredPending.length})</span>
                    </label>
                    {selectedIds.size > 0 && (
                      <>
                        <span className={`text-sm ${textMuted}`}>|</span>
                        <span className={`text-sm font-medium ${textColor}`}>{selectedIds.size} selected</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${textMuted}`}>Bulk prices:</span>
                          <input
                            type="number" min="1" max="99" placeholder="Home%"
                            value={bulkPrices.home}
                            onChange={e => setBulkPrices(p => ({ ...p, home: e.target.value }))}
                            className={`w-16 px-2 py-1 text-xs rounded ${inputBg} border ${borderColor} ${textColor}`}
                          />
                          <input
                            type="number" min="1" max="99" placeholder="Draw%"
                            value={bulkPrices.draw}
                            onChange={e => setBulkPrices(p => ({ ...p, draw: e.target.value }))}
                            className={`w-16 px-2 py-1 text-xs rounded ${inputBg} border ${borderColor} ${textColor}`}
                          />
                          <input
                            type="number" min="1" max="99" placeholder="Away%"
                            value={bulkPrices.away}
                            onChange={e => setBulkPrices(p => ({ ...p, away: e.target.value }))}
                            className={`w-16 px-2 py-1 text-xs rounded ${inputBg} border ${borderColor} ${textColor}`}
                          />
                          <button
                            onClick={bulkApprove}
                            disabled={processing === 'bulk'}
                            className="px-3 py-1 text-xs font-medium bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50 flex items-center gap-1"
                          >
                            {processing === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                            Bulk Approve
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Market cards */}
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-green-500" />
                </div>
              ) : filteredPending.length === 0 ? (
                <div className={`text-center py-16 ${textMuted}`}>
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No pending markets. Sync games to fetch new matches.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPending.map(market => {
                    const edit = priceEdits[market.id] || { home: '', draw: '', away: '' }
                    const hp = parseFloat(edit.home) || 0
                    const dp = parseFloat(edit.draw) || 0
                    const ap = parseFloat(edit.away) || 0
                    const sum = hp + dp + ap
                    const sumOk = sum >= 90 && sum <= 110
                    const matchDate = new Date(market.resolveTime)
                    const crest1 = market.scheduledGame?.homeTeamCrest
                    const crest2 = market.scheduledGame?.awayTeamCrest

                    return (
                      <div key={market.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4 transition-all hover:border-green-500/30`}>
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={selectedIds.has(market.id)}
                            onChange={() => toggleSelect(market.id)}
                            className="w-4 h-4 mt-1 rounded border-gray-600 text-green-500 focus:ring-green-500 flex-shrink-0"
                          />

                          {/* Match info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              {/* Home team */}
                              <div className="flex items-center gap-2">
                                {crest1 ? (
                                  <img src={crest1} alt="" className="w-6 h-6 object-contain" />
                                ) : (
                                  <div className={`w-6 h-6 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'} flex items-center justify-center text-[10px] font-bold ${textMuted}`}>
                                    {market.homeTeam?.charAt(0) || '?'}
                                  </div>
                                )}
                                <span className={`text-sm font-semibold ${textColor}`}>{market.homeTeam || 'Home'}</span>
                              </div>
                              <span className={`text-xs ${textMuted}`}>vs</span>
                              {/* Away team */}
                              <div className="flex items-center gap-2">
                                {crest2 ? (
                                  <img src={crest2} alt="" className="w-6 h-6 object-contain" />
                                ) : (
                                  <div className={`w-6 h-6 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'} flex items-center justify-center text-[10px] font-bold ${textMuted}`}>
                                    {market.awayTeam?.charAt(0) || '?'}
                                  </div>
                                )}
                                <span className={`text-sm font-semibold ${textColor}`}>{market.awayTeam || 'Away'}</span>
                              </div>
                            </div>
                            <div className={`flex items-center gap-3 text-xs ${textMuted}`}>
                              <span>{market.league || 'Sports'}</span>
                              <span>•</span>
                              <span>{matchDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                              <span>{matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                              {market.scheduledGame?.matchday && <span>• MD {market.scheduledGame.matchday}</span>}
                              {/* Odds source badge — shows if prices differ from both defaults (0.33 and 0.5 Prisma default) */}
                              {market.yesPrice !== 0.5 && market.noPrice !== 0.5 && (Math.round(market.yesPrice * 100) !== 33 || Math.round(market.noPrice * 100) !== 33) && (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded" title={`Odds-based: H${Math.round(market.yesPrice*100)}% D${Math.round((market.drawPrice??0)*100)}% A${Math.round(market.noPrice*100)}%`}>
                                  ODDS
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Price inputs */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-center">
                              <div className={`text-[10px] ${textMuted} mb-0.5`}>Home%</div>
                              <input
                                type="number" min="1" max="99"
                                value={edit.home}
                                onFocus={() => initPriceEdit(market)}
                                onChange={e => setPriceForMarket(market.id, 'home', e.target.value)}
                                className={`w-14 px-2 py-1.5 text-sm text-center font-bold rounded-lg ${inputBg} border ${borderColor} ${textColor} focus:border-red-500 focus:outline-none`}
                                placeholder="40"
                              />
                            </div>
                            <div className="text-center">
                              <div className={`text-[10px] ${textMuted} mb-0.5`}>Draw%</div>
                              <input
                                type="number" min="1" max="99"
                                value={edit.draw}
                                onFocus={() => initPriceEdit(market)}
                                onChange={e => setPriceForMarket(market.id, 'draw', e.target.value)}
                                className={`w-14 px-2 py-1.5 text-sm text-center font-bold rounded-lg ${inputBg} border ${borderColor} ${textColor} focus:border-gray-400 focus:outline-none`}
                                placeholder="28"
                              />
                            </div>
                            <div className="text-center">
                              <div className={`text-[10px] ${textMuted} mb-0.5`}>Away%</div>
                              <input
                                type="number" min="1" max="99"
                                value={edit.away}
                                onFocus={() => initPriceEdit(market)}
                                onChange={e => setPriceForMarket(market.id, 'away', e.target.value)}
                                className={`w-14 px-2 py-1.5 text-sm text-center font-bold rounded-lg ${inputBg} border ${borderColor} ${textColor} focus:border-blue-500 focus:outline-none`}
                                placeholder="32"
                              />
                            </div>
                            {/* Sum indicator */}
                            <div className={`text-xs font-bold px-2 py-1 rounded ${
                              sum === 0 ? `${textMuted}` :
                              sumOk ? 'text-green-400 bg-green-500/10' :
                              'text-red-400 bg-red-500/10'
                            }`}>
                              {sum > 0 ? `Σ${sum}%` : '—'}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => approveMarket(market.id)}
                              disabled={processing === market.id || !edit.home || !edit.draw || !edit.away}
                              className="px-3 py-2 text-xs font-medium bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                            >
                              {processing === market.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                              Approve
                            </button>
                            <button
                              onClick={() => denyMarket(market.id)}
                              disabled={processing === market.id}
                              className={`px-3 py-2 text-xs font-medium rounded-lg border ${borderColor} ${textMuted} hover:text-red-400 hover:border-red-500/50 disabled:opacity-40 transition-colors`}
                            >
                              <XCircle className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── ACTIVE MARKETS TAB ─── */}
          {activeTab === 'active' && (
            <div>
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-green-500" />
                </div>
              ) : filteredActive.length === 0 ? (
                <div className={`text-center py-16 ${textMuted}`}>
                  <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No active markets yet. Approve pending markets to make them live.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredActive.map(market => {
                    const isLive = market.scheduledGame?.status === 'IN_PLAY' || market.scheduledGame?.status === 'LIVE'
                    const matchDate = new Date(market.resolveTime)
                    const crest1 = market.scheduledGame?.homeTeamCrest
                    const crest2 = market.scheduledGame?.awayTeamCrest
                    return (
                      <div key={market.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                        <div className="flex items-center gap-4">
                          {/* Match info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <div className="flex items-center gap-2">
                                {crest1 ? <img src={crest1} alt="" className="w-5 h-5 object-contain" /> : null}
                                <span className={`text-sm font-semibold ${textColor}`}>{market.homeTeam || market.title.split(' vs ')[0] || 'Home'}</span>
                              </div>
                              {isLive && market.scheduledGame?.homeScore != null && (
                                <span className="text-sm font-bold text-green-400">
                                  {market.scheduledGame.homeScore} - {market.scheduledGame.awayScore}
                                </span>
                              )}
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${textColor}`}>{market.awayTeam || market.title.split(' vs ')[1] || 'Away'}</span>
                                {crest2 ? <img src={crest2} alt="" className="w-5 h-5 object-contain" /> : null}
                              </div>
                              {isLive && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                  LIVE
                                </span>
                              )}
                            </div>
                            <div className={`flex items-center gap-3 text-xs ${textMuted}`}>
                              <span>{market.league}</span>
                              <span>•</span>
                              <span>{matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <span>•</span>
                              <span>{formatZambianCurrency(market.volume)} vol</span>
                              <span>•</span>
                              <span>{market._count?.orders || 0} orders</span>
                              <span>•</span>
                              <span>{market._count?.positions || 0} positions</span>
                            </div>
                          </div>

                          {/* Current prices */}
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-center">
                              <div className={`text-[10px] ${textMuted}`}>Home</div>
                              <div className="text-sm font-bold text-red-400">{Math.round(market.yesPrice * 100)}%</div>
                            </div>
                            <div className="text-center">
                              <div className={`text-[10px] ${textMuted}`}>Draw</div>
                              <div className={`text-sm font-bold ${textMuted}`}>{Math.round((market.drawPrice || 0) * 100)}%</div>
                            </div>
                            <div className="text-center">
                              <div className={`text-[10px] ${textMuted}`}>Away</div>
                              <div className="text-sm font-bold text-blue-400">{Math.round(market.noPrice * 100)}%</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => router.push(`/?market=${market.id}`)}
                              className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-[#252840]' : 'hover:bg-gray-100'} ${textMuted} transition-colors`}
                              title="View on platform"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {market.volume === 0 && (
                              <button
                                onClick={() => revertToPending(market.id)}
                                disabled={processing === market.id}
                                className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-[#252840]' : 'hover:bg-gray-100'} text-yellow-500 transition-colors`}
                                title="Revert to pending (re-price)"
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── SUGGESTIONS TAB ─── */}
          {activeTab === 'suggestions' && (
            <div>
              {suggestions.length === 0 ? (
                <div className={`text-center py-16 ${textMuted}`}>
                  <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No pending suggestions.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {suggestions.map(s => (
                    <div key={s.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className={`text-sm font-semibold ${textColor} mb-1`}>{s.title}</h3>
                          <p className={`text-xs ${textMuted} mb-2 line-clamp-2`}>{s.description || s.question}</p>
                          <div className={`flex items-center gap-2 text-xs ${textMuted}`}>
                            <span>{s.category}</span>
                            <span>•</span>
                            <span>by {s.suggester.username}</span>
                            <span>•</span>
                            <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => setSuggestionModal({
                              suggestion: s,
                              prices: { home: '50', draw: '25', away: '25' },
                              isTri: false,
                              category: s.category,
                              title: s.title,
                              question: s.question,
                            })}
                            disabled={processing === s.id}
                            className="px-3 py-2 text-xs font-medium bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-40 flex items-center gap-1"
                          >
                            <CheckCircle className="w-3 h-3" />
                            Set Prices
                          </button>
                          <button
                            onClick={() => denySuggestion(s.id)}
                            disabled={processing === s.id}
                            className={`px-3 py-2 text-xs font-medium rounded-lg border ${borderColor} ${textMuted} hover:text-red-400 hover:border-red-500/50 disabled:opacity-40 transition-colors`}
                          >
                            <XCircle className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestion pricing modal */}
              {suggestionModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                  <div className="absolute inset-0 bg-black/60" onClick={() => setSuggestionModal(null)} />
                  <div className={`relative ${surfaceColor} border ${borderColor} rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto`}>
                    <h3 className={`text-base font-bold ${textColor} mb-3`}>Edit & Set Prices</h3>

                    {/* Editable title */}
                    <div className="mb-3">
                      <label className={`text-xs ${textMuted} mb-1 block`}>Title</label>
                      <input type="text" value={suggestionModal.title}
                        onChange={e => setSuggestionModal(prev => prev ? { ...prev, title: e.target.value } : null)}
                        className={`w-full px-3 py-2 text-sm rounded-lg ${inputBg} border ${borderColor} ${textColor}`} />
                    </div>

                    {/* Editable question */}
                    <div className="mb-3">
                      <label className={`text-xs ${textMuted} mb-1 block`}>Question</label>
                      <input type="text" value={suggestionModal.question}
                        onChange={e => setSuggestionModal(prev => prev ? { ...prev, question: e.target.value } : null)}
                        className={`w-full px-3 py-2 text-sm rounded-lg ${inputBg} border ${borderColor} ${textColor}`} />
                    </div>

                    {/* Category selector */}
                    <div className="mb-3">
                      <label className={`text-xs ${textMuted} mb-1 block`}>Category</label>
                      <select value={suggestionModal.category}
                        onChange={e => setSuggestionModal(prev => prev ? { ...prev, category: e.target.value } : null)}
                        className={`w-full px-3 py-2 text-sm rounded-lg ${inputBg} border ${borderColor} ${textColor}`}>
                        {['Football', 'Entertainment', 'Social', 'Politics', 'Finance', 'Weather', 'Other'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    {/* Market type toggle */}
                    <div className="mb-3">
                      <label className={`text-xs ${textMuted} mb-1 block`}>Market Type</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setSuggestionModal(prev => prev ? { ...prev, isTri: false } : null)}
                          className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${!suggestionModal.isTri ? 'border-green-500 bg-green-500/10 text-green-400' : `${borderColor} ${textMuted}`}`}>
                          Yes / No
                        </button>
                        <button type="button" onClick={() => setSuggestionModal(prev => prev ? { ...prev, isTri: true } : null)}
                          className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${suggestionModal.isTri ? 'border-green-500 bg-green-500/10 text-green-400' : `${borderColor} ${textMuted}`}`}>
                          Home / Draw / Away
                        </button>
                      </div>
                    </div>

                    {/* Price inputs */}
                    <div className={`flex gap-3 mb-2`}>
                      <div className="flex-1">
                        <label className={`text-xs ${textMuted} mb-1 block`}>{suggestionModal.isTri ? 'Home %' : 'Yes %'}</label>
                        <input type="number" min="1" max="99" value={suggestionModal.prices.home}
                          onChange={e => setSuggestionModal(prev => prev ? { ...prev, prices: { ...prev.prices, home: e.target.value } } : null)}
                          className={`w-full px-3 py-2 text-sm font-bold rounded-lg ${inputBg} border ${borderColor} ${textColor}`} />
                      </div>
                      {suggestionModal.isTri && (
                        <div className="flex-1">
                          <label className={`text-xs ${textMuted} mb-1 block`}>Draw %</label>
                          <input type="number" min="1" max="99" value={suggestionModal.prices.draw}
                            onChange={e => setSuggestionModal(prev => prev ? { ...prev, prices: { ...prev.prices, draw: e.target.value } } : null)}
                            className={`w-full px-3 py-2 text-sm font-bold rounded-lg ${inputBg} border ${borderColor} ${textColor}`} />
                        </div>
                      )}
                      <div className="flex-1">
                        <label className={`text-xs ${textMuted} mb-1 block`}>{suggestionModal.isTri ? 'Away %' : 'No %'}</label>
                        <input type="number" min="1" max="99" value={suggestionModal.prices.away}
                          onChange={e => setSuggestionModal(prev => prev ? { ...prev, prices: { ...prev.prices, away: e.target.value } } : null)}
                          className={`w-full px-3 py-2 text-sm font-bold rounded-lg ${inputBg} border ${borderColor} ${textColor}`} />
                      </div>
                    </div>

                    {/* Price sum indicator */}
                    {(() => {
                      const sum = parseFloat(suggestionModal.prices.home || '0') + (suggestionModal.isTri ? parseFloat(suggestionModal.prices.draw || '0') : 0) + parseFloat(suggestionModal.prices.away || '0')
                      return (
                        <p className={`text-xs mb-4 ${sum > 100 ? 'text-red-400' : sum === 100 ? 'text-green-400' : textMuted}`}>
                          Total: {sum}% {sum > 100 ? '— exceeds 100%!' : ''}
                        </p>
                      )
                    })()}

                    <div className="flex gap-2">
                      <button onClick={approveSuggestion}
                        disabled={processing === suggestionModal.suggestion.id}
                        className="flex-1 py-2.5 text-sm font-medium bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
                        {processing === suggestionModal.suggestion.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve & Create Market'}
                      </button>
                      <button onClick={() => setSuggestionModal(null)}
                        className={`px-4 py-2.5 text-sm rounded-lg border ${borderColor} ${textMuted}`}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── SYNC GAMES TAB ─── */}
          {activeTab === 'sync' && (
            <div className="max-w-2xl">
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-6`}>
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-full ${isDarkMode ? 'bg-green-500/10' : 'bg-green-50'} flex items-center justify-center flex-shrink-0`}>
                    <RefreshCw className="w-6 h-6 text-green-500" />
                  </div>
                  <div className="flex-1">
                    <h3 className={`text-base font-semibold ${textColor} mb-1`}>Sync Scheduled Games</h3>
                    <p className={`text-sm ${textMuted} mb-4`}>
                      Fetch upcoming matches from football-data.org and create pending markets.
                      Markets will appear in the Pending tab for you to set prices and approve.
                    </p>

                    <div className="flex items-center gap-3 mb-4">
                      <label className={`text-sm ${textMuted}`}>League:</label>
                      <select
                        value={syncLeague}
                        onChange={e => setSyncLeague(e.target.value)}
                        className={`px-3 py-2 text-sm rounded-lg ${inputBg} border ${borderColor} ${textColor} focus:outline-none`}
                      >
                        <option value="all">All Leagues (2 at a time)</option>
                        {LEAGUES.map(l => (
                          <option key={l.code} value={l.code}>{l.name}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={syncGames}
                      disabled={syncing}
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
                  </div>
                </div>
              </div>

              {/* Refresh Odds Prices for existing pending markets */}
              <div className={`mt-4 ${surfaceColor} border border-blue-500/30 rounded-xl p-4`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0`}>
                    <DollarSign className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className={`text-sm font-semibold ${textColor} mb-1`}>Refresh Odds Prices</h4>
                    <p className={`text-xs ${textMuted} mb-3`}>
                      Fetch latest odds from The Odds API and update prices on all pending markets.
                      Also fixes markets stuck with Prisma default prices (50/50).
                    </p>
                    <button
                      onClick={refreshOdds}
                      disabled={processing === 'refresh-odds'}
                      className="px-4 py-2 text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                      {processing === 'refresh-odds' ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
                      Refresh Odds Prices
                    </button>
                  </div>
                </div>
              </div>

              <div className={`mt-4 ${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                <h4 className={`text-sm font-semibold ${textColor} mb-2`}>Available Leagues</h4>
                <div className="grid grid-cols-2 gap-2">
                  {LEAGUES.map(l => (
                    <div key={l.code} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${inputBg}`}>
                      <Trophy className="w-4 h-4 text-yellow-500" />
                      <span className={`text-sm ${textColor}`}>{l.name}</span>
                      <span className={`text-xs ${textMuted} ml-auto`}>{l.code}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Revert Legacy Markets */}
              <div className={`mt-4 ${surfaceColor} border border-yellow-500/30 rounded-xl p-4`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className={`text-sm font-semibold ${textColor} mb-1`}>Revert Legacy Markets</h4>
                    <p className={`text-xs ${textMuted} mb-3`}>
                      Move all ACTIVE sports markets with zero volume back to Pending Approval.
                      Use this to fix markets created with default 50% or 33% pricing before the Market Maker flow was enabled.
                    </p>
                    <button
                      onClick={revertLegacy}
                      disabled={processing === 'revert-legacy'}
                      className="px-4 py-2 text-xs font-medium bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-500/20 rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                      {processing === 'revert-legacy' ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                      Revert Legacy Markets
                    </button>
                  </div>
                </div>
              </div>

              <p className={`text-xs ${textMuted} mt-4`}>
                The cron job syncs games automatically every 2 hours, rotating through leagues.
                Use this manual sync to fetch specific leagues on demand.
              </p>
            </div>
          )}

          {/* ─── CATEGORIES TAB ─── */}
          {activeTab === 'categories' && (
            <CategoriesManager
              surfaceColor={surfaceColor} borderColor={borderColor} textColor={textColor}
              textMuted={textMuted} inputBg={inputBg} isDarkMode={isDarkMode}
              setMessage={setMessage}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ─── Categories Manager Component ───
function CategoriesManager({ surfaceColor, borderColor, textColor, textMuted, inputBg, isDarkMode, setMessage }: {
  surfaceColor: string; borderColor: string; textColor: string; textMuted: string; inputBg: string; isDarkMode: boolean;
  setMessage: (msg: { type: 'success' | 'error'; text: string } | null) => void
}) {
  const [categories, setCategories] = useState<{ value: string; label: string; icon: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newCat, setNewCat] = useState({ value: '', label: '', icon: '🌍' })

  useEffect(() => {
    fetch('/api/market-maker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get-categories' }),
    })
      .then(r => r.json())
      .then(data => setCategories(data.categories || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const addCategory = () => {
    const val = newCat.value.trim()
    const label = newCat.label.trim() || val
    if (!val) return
    if (categories.some(c => c.value.toLowerCase() === val.toLowerCase())) {
      setMessage({ type: 'error', text: 'Category already exists' })
      return
    }
    setCategories(prev => [...prev, { value: val, label, icon: newCat.icon || '🌍' }])
    setNewCat({ value: '', label: '', icon: '🌍' })
  }

  const removeCategory = (value: string) => {
    setCategories(prev => prev.filter(c => c.value !== value))
  }

  const saveCategories = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/market-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-categories', categories }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: data.message })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>

  return (
    <div className="max-w-2xl space-y-4">
      <div className={`${surfaceColor} border ${borderColor} rounded-xl p-6`}>
        <h3 className={`text-base font-semibold ${textColor} mb-1`}>Manage Categories</h3>
        <p className={`text-sm ${textMuted} mb-4`}>
          Add or remove categories that appear on the platform. Changes apply to market creation and the main page navigation.
        </p>

        {/* Current categories */}
        <div className="space-y-2 mb-4">
          {categories.map((cat, i) => (
            <div key={cat.value} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${inputBg}`}>
              <span className="text-lg">{cat.icon}</span>
              <span className={`text-sm font-medium ${textColor} flex-1`}>{cat.label}</span>
              <span className={`text-xs ${textMuted}`}>{cat.value}</span>
              <button
                onClick={() => removeCategory(cat.value)}
                className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Add new category */}
        <div className={`flex gap-2 items-end pt-3 border-t ${borderColor}`}>
          <div className="flex-1">
            <label className={`text-xs ${textMuted} mb-1 block`}>Name</label>
            <input type="text" value={newCat.label} placeholder="e.g. Esports"
              onChange={e => setNewCat(prev => ({ ...prev, label: e.target.value, value: e.target.value }))}
              className={`w-full px-3 py-2 text-sm rounded-lg ${inputBg} border ${borderColor} ${textColor}`} />
          </div>
          <div className="w-16">
            <label className={`text-xs ${textMuted} mb-1 block`}>Icon</label>
            <input type="text" value={newCat.icon} maxLength={2}
              onChange={e => setNewCat(prev => ({ ...prev, icon: e.target.value }))}
              className={`w-full px-3 py-2 text-sm rounded-lg ${inputBg} border ${borderColor} ${textColor} text-center`} />
          </div>
          <button onClick={addCategory}
            className="px-4 py-2 text-sm font-medium bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors">
            Add
          </button>
        </div>
      </div>

      {/* Save button */}
      <button onClick={saveCategories} disabled={saving}
        className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
        Save Categories
      </button>

      <p className={`text-xs ${textMuted}`}>
        Note: Existing markets keep their original categories. New markets will use the updated list.
      </p>
    </div>
  )
}
