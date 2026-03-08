'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, Trophy, Loader2, MessageSquare, BarChart3, RefreshCw, DollarSign, Users, Settings, Shield, Clock, FileText, Gavel, Wallet, Search, X, Zap } from 'lucide-react'
import { formatZambianCurrency, formatDateDMY, formatDateTimeDMY } from '@/utils/currency'
import { useTheme } from '@/contexts/ThemeContext'

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
  openDisputes: number
  pendingPayments: number
  newUsersLast7Days: number
  revenueBreakdown: Record<string, { total: number; count: number }>
}

interface PaymentEntry {
  id: string
  type: string
  amount: number
  feeAmount: number
  netAmount: number
  phoneNumber: string
  provider: string
  status: string
  statusMessage: string | null
  createdAt: string
  completedAt: string | null
  user: { id: string; username: string; fullName: string; email: string; balance: number }
}

interface PaymentSummary {
  totalDeposited: number
  depositCount: number
  totalWithdrawn: number
  withdrawalCount: number
  pendingCount: number
  processingCount: number
}

type TabType = 'markets' | 'disputes' | 'users' | 'payments' | 'audit' | 'sync' | 'stats' | 'admin-wallet'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isDarkMode } = useTheme()
  const [activeTab, setActiveTab] = useState<TabType>('markets')
  const [markets, setMarkets] = useState<any[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [payments, setPayments] = useState<PaymentEntry[]>([])
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [disputeResponse, setDisputeResponse] = useState('')
  const [disputeNewOutcome, setDisputeNewOutcome] = useState<string>('YES')
  const [showDisputeModal, setShowDisputeModal] = useState<{ id: string; action: 'UPHOLD' | 'REJECT' } | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // User balance adjustment modal state
  const [showAdjustModal, setShowAdjustModal] = useState<AdminUser | null>(null)
  const [adjustType, setAdjustType] = useState<'CREDIT' | 'DEBIT'>('CREDIT')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  // Search/filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // Admin wallet state
  const [adminDepositAmount, setAdminDepositAmount] = useState('')
  const [adminWithdrawAmount, setAdminWithdrawAmount] = useState('')
  const [adminWalletPhone, setAdminWalletPhone] = useState('')
  const [adminWalletProvider, setAdminWalletProvider] = useState<'AIRTEL' | 'MTN'>('AIRTEL')
  const [adminWalletProcessing, setAdminWalletProcessing] = useState(false)

  const bgColor = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'
  const surfaceColor = isDarkMode ? 'bg-[#1c2030]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-800' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'

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
          setIsAdmin(true)
        } else {
          router.push('/')
        }
      })
      .catch(() => router.push('/'))
  }, [status])

  // Track which tabs have been fetched to avoid redundant requests
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set())

  // Fetch data for a single tab
  const loadTabData = async (tab: string, force = false) => {
    if (!force && loadedTabs.has(tab)) return
    setLoading(true)
    try {
      const needStats = !loadedTabs.has('stats') || force
      const fetches: Promise<Response>[] = []

      switch (tab) {
        case 'markets': case 'sync': fetches.push(fetch('/api/markets?status=ALL&limit=200')); break
        case 'disputes': fetches.push(fetch('/api/admin/disputes?status=OPEN')); break
        case 'users': fetches.push(fetch('/api/admin/users')); break
        case 'audit': fetches.push(fetch('/api/admin/audit')); break
        case 'payments': case 'admin-wallet': fetches.push(fetch('/api/admin/wallet')); break
        case 'stats': needStats || fetches.push(fetch('/api/admin/stats')); break
      }
      if (needStats) fetches.push(fetch('/api/admin/stats'))

      const results = await Promise.all(fetches)
      let idx = 0

      // Process tab-specific result
      if (tab !== 'stats' || !needStats) {
        const res = results[idx++]
        if (res?.ok) {
          const data = await res.json()
          switch (tab) {
            case 'markets': case 'sync': setMarkets(Array.isArray(data) ? data : []); break
            case 'disputes': setDisputes(data.disputes || []); break
            case 'users': setAdminUsers(data.users || []); break
            case 'audit': setAuditLogs(data.logs || []); break
            case 'payments': case 'admin-wallet':
              setPayments(data.payments || [])
              setPaymentSummary(data.summary || null)
              break
          }
        }
      }
      // Process stats result
      if (needStats && idx < results.length) {
        const statsRes = results[idx]
        if (statsRes?.ok) setStats(await statsRes.json())
      }

      setLoadedTabs(prev => { const n = new Set(prev); n.add(tab); if (needStats) n.add('stats'); return n })
    } catch (err) {
      console.error('Failed to load tab data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Reload active tab after mutations (approve, deny, etc.)
  const loadData = async () => {
    setLoadedTabs(new Set()) // Invalidate all cached tabs
    await loadTabData(activeTab, true)
  }

  // Load data on auth
  useEffect(() => {
    if (isAdmin) loadTabData(activeTab)
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load when tab changes
  useEffect(() => {
    if (isAdmin) loadTabData(activeTab)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdjustBalance = async () => {
    if (!showAdjustModal) return
    const amt = parseFloat(adjustAmount)
    if (!amt || amt <= 0) { setMessage({ type: 'error', text: 'Enter a valid amount' }); return }
    if (!adjustReason.trim()) { setMessage({ type: 'error', text: 'Reason is required' }); return }

    setProcessing(showAdjustModal.id)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: showAdjustModal.id,
          amount: amt,
          type: adjustType,
          reason: adjustReason.trim(),
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to adjust balance')

      setMessage({ type: 'success', text: `${adjustType === 'CREDIT' ? 'Credited' : 'Debited'} K${amt.toFixed(2)}. New balance: ${formatZambianCurrency(data.newBalance)}` })
      setShowAdjustModal(null)
      setAdjustAmount('')
      setAdjustReason('')
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
        setMessage({ type: 'success', text: `Market resolved to ${winningOutcome}. 24h dispute window opened. Payouts after ${formatDateTimeDMY(data.disputeDeadline)}.` })
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

  const earlyFinalizeMarket = async (marketId: string) => {
    setResolving(marketId)
    setMessage(null)

    try {
      const res = await fetch('/api/markets/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, action: 'EARLY_FINALIZE' })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to early-finalize')

      setMessage({ type: 'success', text: `Market early-finalized! Payouts processed. Fees: ${formatZambianCurrency(data.feesCollected || 0)}` })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setResolving(null)
    }
  }

  const handleAdminDeposit = async () => {
    const amt = parseFloat(adminDepositAmount)
    if (!amt || amt <= 0) { setMessage({ type: 'error', text: 'Enter a valid amount' }); return }
    if (!adminWalletPhone.trim()) { setMessage({ type: 'error', text: 'Enter phone number' }); return }
    setAdminWalletProcessing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, phoneNumber: adminWalletPhone.trim(), provider: adminWalletProvider === 'MTN' ? 'MTN_MOMO' : 'AIRTEL_MONEY' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Deposit failed')
      setMessage({ type: 'success', text: `Deposit of ${formatZambianCurrency(amt)} initiated. Check payment status.` })
      setAdminDepositAmount('')
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setAdminWalletProcessing(false)
    }
  }

  const handleAdminWithdraw = async () => {
    const amt = parseFloat(adminWithdrawAmount)
    if (!amt || amt <= 0) { setMessage({ type: 'error', text: 'Enter a valid amount' }); return }
    if (!adminWalletPhone.trim()) { setMessage({ type: 'error', text: 'Enter phone number' }); return }
    setAdminWalletProcessing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, phoneNumber: adminWalletPhone.trim(), provider: adminWalletProvider === 'MTN' ? 'MTN_MOMO' : 'AIRTEL_MONEY' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed')
      setMessage({ type: 'success', text: `Withdrawal of ${formatZambianCurrency(amt)} initiated (fee: ${formatZambianCurrency(data.fee || 0)}).` })
      setAdminWithdrawAmount('')
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setAdminWalletProcessing(false)
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


  if (status === 'loading' || loading) {
    return (
      <div className={`min-h-screen ${bgColor} flex items-center justify-center`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className={`${textMuted} text-sm`}>Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  const q = searchQuery.toLowerCase()
  const matchSearch = (text: string | null | undefined) => !q || (text || '').toLowerCase().includes(q)

  const activeMarkets = markets.filter((m: any) => ['ACTIVE', 'PENDING', 'PENDING_APPROVAL'].includes(m.status) && matchSearch(m.title))
  const needsResolution = activeMarkets.filter((m: any) => m.status === 'ACTIVE' && new Date(m.resolveTime) <= new Date())
  const resolvedMarkets = markets.filter((m: any) => m.status === 'RESOLVED' && matchSearch(m.title))
  const finalizedMarkets = markets.filter((m: any) => m.status === 'FINALIZED' && matchSearch(m.title))
  const filteredDisputes = disputes.filter(d => matchSearch(d.market?.title) || matchSearch(d.reason) || matchSearch(d.disputer?.username))
  const filteredUsers = adminUsers.filter(u => matchSearch(u.fullName) || matchSearch(u.username) || matchSearch(u.email))
  const filteredPayments = payments.filter(p => matchSearch(p.user?.fullName) || matchSearch(p.user?.username) || matchSearch(p.type) || matchSearch(p.status) || matchSearch(p.provider))
  const filteredAuditLogs = auditLogs.filter(l => matchSearch(l.action) || matchSearch(l.category) || matchSearch(l.details))

  const sidebarItems: { id: TabType; label: string; icon: any; badge?: number }[] = [
    { id: 'stats', label: 'Overview', icon: BarChart3 },
    { id: 'markets', label: 'Markets', icon: Trophy, badge: needsResolution.length + resolvedMarkets.length },
    { id: 'disputes', label: 'Disputes', icon: Gavel, badge: disputes.length },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'payments', label: 'Payments', icon: DollarSign },
    { id: 'admin-wallet', label: 'My Wallet', icon: Wallet },
    { id: 'sync', label: 'Sync Games', icon: RefreshCw },
    { id: 'audit', label: 'Audit Log', icon: FileText },
  ]

  return (
    <div className={`min-h-screen ${bgColor} md:flex`}>
      {/* Mobile Header + Tab Bar */}
      <div className={`md:hidden sticky top-0 z-30 ${isDarkMode ? 'bg-[#171924]' : 'bg-white'} border-b ${borderColor}`}>
        <div className={`flex items-center gap-3 px-4 h-14`}>
          <button onClick={() => router.push('/')} className={`${textMuted} hover:text-white`}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className={`text-sm font-bold ${textColor}`}>Admin Dashboard</h1>
          <div className="flex-1" />
          <button onClick={() => loadData()} className={`p-2 ${textMuted} hover:text-white`}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1 px-3 pb-2 overflow-x-auto no-scrollbar">
          {sidebarItems.map(item => {
            const Icon = item.icon
            const isActive = activeTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => { setActiveTab(item.id); setSearchQuery('') }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                  isActive
                    ? isDarkMode ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30' : 'bg-green-50 text-green-700 ring-1 ring-green-200'
                    : `${textMuted} ${isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-100'}`
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
                {item.badge != null && item.badge > 0 && (
                  <span className={`px-1 py-0.5 text-[9px] font-bold rounded-full ${isActive ? 'bg-green-500/20' : isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex ${sidebarOpen ? 'w-56' : 'w-16'} flex-shrink-0 ${isDarkMode ? 'bg-[#171924]' : 'bg-white'} border-r ${borderColor} flex-col transition-all duration-200 fixed h-full z-30`}>
        {/* Sidebar Header */}
        <div className={`flex items-center ${sidebarOpen ? 'justify-between px-4' : 'justify-center'} h-14 border-b ${borderColor}`}>
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <button onClick={() => router.push('/')} className={`${textMuted} hover:${textColor}`}>
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h1 className={`text-sm font-bold ${textColor}`}>Admin</h1>
              {!isAdmin && <span className="px-1.5 py-0.5 text-[9px] bg-yellow-500/20 text-yellow-400 rounded">Limited</span>}
            </div>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className={`p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-100'} ${textMuted}`}>
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Sidebar Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {sidebarItems.map(item => {
            const Icon = item.icon
            const isActive = activeTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => { setActiveTab(item.id); setSearchQuery('') }}
                className={`w-full flex items-center gap-3 ${sidebarOpen ? 'px-4' : 'justify-center px-2'} py-2.5 text-sm transition-colors ${
                  isActive
                    ? `${isDarkMode ? 'bg-green-500/10 text-green-400 border-r-2 border-green-500' : 'bg-green-50 text-green-700 border-r-2 border-green-500'}`
                    : `${textMuted} ${isDarkMode ? 'hover:bg-[#1e2130] hover:text-white' : 'hover:bg-gray-100 hover:text-gray-900'}`
                }`}
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {sidebarOpen && (
                  <>
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${isActive ? 'bg-green-500/20' : isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 ${sidebarOpen ? 'md:ml-56' : 'md:ml-16'} transition-all duration-200`}>
        {/* Top Bar with Search (desktop only) */}
        <header className={`hidden md:block sticky top-0 z-20 ${isDarkMode ? 'bg-[#171924]' : 'bg-white'} border-b ${borderColor}`}>
          <div className="flex items-center h-14 px-6 gap-4">
            <h2 className={`text-lg font-bold ${textColor} capitalize`}>
              {activeTab === 'admin-wallet' ? 'My Wallet' : activeTab.replace('-', ' ')}
            </h2>
            <div className="flex-1" />
            {/* Search — shown for searchable tabs */}
            {['markets', 'disputes', 'users', 'payments', 'audit'].includes(activeTab) && (
              <div className={`flex items-center ${isDarkMode ? 'bg-[#1e2130] border-gray-700' : 'bg-gray-100 border-gray-200'} border rounded-lg px-3 py-1.5 w-64`}>
                <Search className={`w-4 h-4 ${textMuted} flex-shrink-0`} />
                <input
                  type="text"
                  placeholder={`Search ${activeTab}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`bg-transparent border-none outline-none text-sm ${textColor} ml-2 w-full`}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className={textMuted}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <button onClick={loadData} className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-100'} ${textMuted}`} title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="px-4 md:px-6 py-4 md:py-6 space-y-6 max-w-[1100px]">
          {/* Quick Stats Bar */}
          {stats && activeTab === 'stats' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'Users', value: stats.totalUsers, color: 'text-blue-400' },
                { label: 'Active Markets', value: stats.activeMarkets, color: 'text-green-400' },
                { label: 'Volume', value: formatZambianCurrency(stats.totalVolume), color: 'text-cyan-400' },
                { label: 'Revenue', value: formatZambianCurrency(stats.totalRevenue), color: 'text-yellow-400' },
                { label: 'Disputes', value: stats.openDisputes, color: 'text-orange-400' },
                { label: 'New (7d)', value: stats.newUsersLast7Days, color: 'text-purple-400' },
              ].map(s => (
                <div key={s.label} className={`${surfaceColor} border ${borderColor} rounded-lg px-3 py-2`}>
                  <p className={`text-[10px] ${textMuted} uppercase`}>{s.label}</p>
                  <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

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

        {/* Markets Tab */}
        {activeTab === 'markets' && (
          <>
          {/* Needs Resolution — expired ACTIVE markets shown first */}
          {needsResolution.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-orange-400 mb-3 uppercase tracking-wide flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Needs Resolution ({needsResolution.length})
              </h2>
              <div className="space-y-3">
                {needsResolution.map((market: any) => (
                  <div key={market.id} className={`${surfaceColor} border border-orange-500/30 rounded-xl p-4`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${textColor}`}>{market.title}</p>
                        <p className={`text-xs ${textMuted} mt-0.5`}>{market.question}</p>
                        <div className={`flex gap-3 mt-1 text-xs ${textMuted}`}>
                          <span>Vol: {formatZambianCurrency(market.volume || 0)}</span>
                          <span className="text-orange-400">Expired: {formatDateDMY(market.resolveTime)}</span>
                          <span>{market._count?.orders || 0} orders</span>
                        </div>
                      </div>
                      <div className="flex gap-1 text-xs">
                        <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                          {market.marketType === 'TRI_OUTCOME' ? 'Home' : 'YES'} {(market.yesPrice * 100).toFixed(0)}%
                        </span>
                        {market.marketType === 'TRI_OUTCOME' && (
                          <span className="px-2 py-0.5 rounded bg-gray-500/20 text-gray-400">
                            Draw {((market.drawPrice || 0) * 100).toFixed(0)}%
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                          {market.marketType === 'TRI_OUTCOME' ? 'Away' : 'NO'} {(market.noPrice * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className={`flex gap-2 mt-3 pt-3 border-t ${borderColor}`}>
                      {market.marketType === 'TRI_OUTCOME' ? (
                        <>
                          <button onClick={() => resolveMarket(market.id, 'HOME')} disabled={resolving === market.id}
                            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors">
                            {resolving === market.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Home
                          </button>
                          <button onClick={() => resolveMarket(market.id, 'DRAW')} disabled={resolving === market.id}
                            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium bg-gray-500/10 border border-gray-500/30 text-gray-400 rounded-lg hover:bg-gray-500/20 disabled:opacity-50 transition-colors">
                            Draw
                          </button>
                          <button onClick={() => resolveMarket(market.id, 'AWAY')} disabled={resolving === market.id}
                            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors">
                            <XCircle className="w-3 h-3" /> Away
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => resolveMarket(market.id, 'YES')} disabled={resolving === market.id}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors">
                            {resolving === market.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} YES Wins
                          </button>
                          <button onClick={() => resolveMarket(market.id, 'NO')} disabled={resolving === market.id}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors">
                            <XCircle className="w-4 h-4" /> NO Wins
                          </button>
                        </>
                      )}
                      <button onClick={() => resolveMarket(market.id, 'VOID')} disabled={resolving === market.id}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/20 disabled:opacity-50 transition-colors">
                        <AlertTriangle className="w-4 h-4" /> Void
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
            All Active Markets ({activeMarkets.length})
          </h2>
          {activeMarkets.length === 0 ? (
            <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
              <p className={`${textMuted} text-sm`}>No active markets.</p>
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
                        <span>Resolves: {formatDateDMY(market.resolveTime)}</span>
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

                  {market.status === 'ACTIVE' && (
                  <div className={`flex gap-2 mt-3 pt-3 border-t ${borderColor}`}>
                    {market.marketType === 'TRI_OUTCOME' ? (
                      <>
                        <button onClick={() => resolveMarket(market.id, 'HOME')} disabled={resolving === market.id}
                          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors">
                          {resolving === market.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Home
                        </button>
                        <button onClick={() => resolveMarket(market.id, 'DRAW')} disabled={resolving === market.id}
                          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium bg-gray-500/10 border border-gray-500/30 text-gray-400 rounded-lg hover:bg-gray-500/20 disabled:opacity-50 transition-colors">
                          Draw
                        </button>
                        <button onClick={() => resolveMarket(market.id, 'AWAY')} disabled={resolving === market.id}
                          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors">
                          <XCircle className="w-3 h-3" /> Away
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => resolveMarket(market.id, 'YES')} disabled={resolving === market.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-colors">
                          {resolving === market.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} YES Wins
                        </button>
                        <button onClick={() => resolveMarket(market.id, 'NO')} disabled={resolving === market.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors">
                          <XCircle className="w-4 h-4" /> NO Wins
                        </button>
                      </>
                    )}
                    <button onClick={() => resolveMarket(market.id, 'VOID')} disabled={resolving === market.id}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/20 disabled:opacity-50 transition-colors">
                      <AlertTriangle className="w-4 h-4" /> Void
                    </button>
                  </div>
                  )}
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
                          Resolved: <span className="font-semibold">{market.winningOutcome}</span> — {formatDateDMY(market.resolvedAt || market.updatedAt)}
                        </p>
                        {deadline && (
                          <p className={`text-xs mt-1 ${isPastDeadline ? 'text-green-400' : 'text-yellow-400'}`}>
                            <Clock className="w-3 h-3 inline mr-1" />
                            {isPastDeadline ? 'Dispute window closed — ready to finalize' : `Dispute window until ${formatDateTimeDMY(deadline)}`}
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
                      {isPastDeadline ? (
                        <button
                          onClick={() => finalizeMarket(market.id)}
                          disabled={resolving === market.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
                        >
                          {resolving === market.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
                          Finalize & Pay Out
                        </button>
                      ) : (
                        <button
                          onClick={() => earlyFinalizeMarket(market.id)}
                          disabled={resolving === market.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-purple-500/10 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/20 disabled:opacity-50 transition-colors"
                        >
                          {resolving === market.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                          Early Finalize & Pay Out
                        </button>
                      )}
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
              Open Disputes ({filteredDisputes.length})
            </h2>
            {filteredDisputes.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <Gavel className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>{searchQuery ? 'No disputes match your search.' : 'No open disputes.'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredDisputes.map((dispute) => (
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
                      Filed: {formatDateTimeDMY(dispute.createdAt)}
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
              Users ({filteredUsers.length})
            </h2>
            {filteredUsers.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <Users className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>{searchQuery ? 'No users match your search.' : 'No users found.'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((u) => (
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
                        <span>Joined {formatDateDMY(u.createdAt)}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                      <p className={`text-sm font-semibold ${textColor}`}>{formatZambianCurrency(u.balance)}</p>
                      <button
                        onClick={() => { setShowAdjustModal(u); setAdjustType('CREDIT'); setAdjustAmount(''); setAdjustReason('') }}
                        className="text-[10px] text-blue-400 hover:text-blue-300 font-medium"
                      >
                        Adjust Balance
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div>
            {/* Summary Cards */}
            {paymentSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-3`}>
                  <p className={`text-[10px] ${textMuted} uppercase`}>Total Deposited</p>
                  <p className={`text-lg font-bold text-green-400`}>{formatZambianCurrency(paymentSummary.totalDeposited)}</p>
                  <p className={`text-[10px] ${textMuted}`}>{paymentSummary.depositCount} deposits</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-3`}>
                  <p className={`text-[10px] ${textMuted} uppercase`}>Total Withdrawn</p>
                  <p className={`text-lg font-bold text-orange-400`}>{formatZambianCurrency(paymentSummary.totalWithdrawn)}</p>
                  <p className={`text-[10px] ${textMuted}`}>{paymentSummary.withdrawalCount} withdrawals</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-3`}>
                  <p className={`text-[10px] ${textMuted} uppercase`}>Pending</p>
                  <p className={`text-lg font-bold text-yellow-400`}>{paymentSummary.pendingCount}</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-3`}>
                  <p className={`text-[10px] ${textMuted} uppercase`}>Processing</p>
                  <p className={`text-lg font-bold text-blue-400`}>{paymentSummary.processingCount}</p>
                </div>
              </div>
            )}

            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Recent Payments ({filteredPayments.length})
            </h2>
            {filteredPayments.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <DollarSign className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>{searchQuery ? 'No payments match your search.' : 'No payments found.'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPayments.map((p) => {
                  const statusColor = p.status === 'COMPLETED' ? 'text-green-400 bg-green-500/20' :
                    p.status === 'FAILED' ? 'text-red-400 bg-red-500/20' :
                    p.status === 'PROCESSING' ? 'text-blue-400 bg-blue-500/20' :
                    'text-yellow-400 bg-yellow-500/20'
                  return (
                    <div key={p.id} className={`${surfaceColor} border ${borderColor} rounded-xl p-3`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${p.type === 'DEPOSIT' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                            {p.type}
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${statusColor}`}>
                            {p.status}
                          </span>
                          <span className={`text-[10px] ${textMuted}`}>{p.provider === 'MTN_MOMO' ? 'MTN' : 'Airtel'}</span>
                        </div>
                        <span className={`text-sm font-bold ${textColor}`}>{formatZambianCurrency(p.amount)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className={`text-xs ${textMuted}`}>
                          <span className="font-medium">{p.user?.fullName || p.user?.username}</span>
                          <span className="mx-1">•</span>
                          <span>+260{p.phoneNumber}</span>
                          {p.feeAmount > 0 && <span className="mx-1">• Fee: {formatZambianCurrency(p.feeAmount)}</span>}
                        </div>
                        <span className={`text-[10px] ${textMuted}`}>
                          {formatDateTimeDMY(p.createdAt)}
                        </span>
                      </div>
                      {p.statusMessage && (
                        <p className={`text-[10px] ${textMuted} mt-1 truncate`}>{p.statusMessage}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === 'audit' && (
          <div>
            <h2 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>
              Audit Log (Recent {filteredAuditLogs.length})
            </h2>
            {filteredAuditLogs.length === 0 ? (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <FileText className={`w-12 h-12 mx-auto mb-3 ${textMuted} opacity-50`} />
                <p className={`${textMuted} text-sm`}>{searchQuery ? 'No audit entries match your search.' : 'No audit entries yet.'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAuditLogs.map((log) => {
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
                          {formatDateTimeDMY(log.createdAt)}
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
              <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-blue-400" />
                    <span className={`text-xs ${textMuted}`}>Total Users</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.totalUsers.toLocaleString()}</p>
                  <p className={`text-xs ${textMuted}`}>+{stats.newUsersLast7Days} this week</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-purple-400" />
                    <span className={`text-xs ${textMuted}`}>Total Markets</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.totalMarkets.toLocaleString()}</p>
                  <p className={`text-xs ${textMuted}`}>{stats.activeMarkets} active, {stats.resolvedMarkets} resolved</p>
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
                    <span className={`text-xs ${textMuted}`}>Pending Actions</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.openDisputes}</p>
                  <p className={`text-xs ${textMuted}`}>{stats.openDisputes} open disputes</p>
                </div>
                <div className={`${surfaceColor} border ${borderColor} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-blue-400" />
                    <span className={`text-xs ${textMuted}`}>Pending Payments</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{stats.pendingPayments}</p>
                </div>
              </div>

              {/* Revenue Breakdown */}
              {stats.revenueBreakdown && Object.keys(stats.revenueBreakdown).length > 0 && (
                <div className="mt-4">
                  <h3 className={`text-sm font-semibold ${textMuted} mb-3 uppercase tracking-wide`}>Revenue Breakdown</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(stats.revenueBreakdown).map(([type, data]: [string, any]) => (
                      <div key={type} className={`${surfaceColor} border ${borderColor} rounded-xl p-3`}>
                        <p className={`text-[10px] ${textMuted} uppercase`}>{type.replace(/_/g, ' ')}</p>
                        <p className={`text-lg font-bold text-green-400`}>{formatZambianCurrency(data.total)}</p>
                        <p className={`text-[10px] ${textMuted}`}>{data.count} transactions</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </>
            ) : (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-8 text-center`}>
                <p className={textMuted}>Loading stats...</p>
              </div>
            )}
          </div>
        )}
        {/* Admin Wallet Tab */}
        {activeTab === 'admin-wallet' && (
          <div className="space-y-6">
            <div className={`${surfaceColor} border ${borderColor} rounded-xl p-6`}>
              <h3 className={`text-base font-semibold ${textColor} mb-4`}>Deposit Funds</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Provider</label>
                  <div className="flex gap-2">
                    <button onClick={() => setAdminWalletProvider('AIRTEL')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${adminWalletProvider === 'AIRTEL' ? 'bg-red-500 text-white' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`}`}>Airtel</button>
                    <button onClick={() => setAdminWalletProvider('MTN')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${adminWalletProvider === 'MTN' ? 'bg-yellow-500 text-black' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`}`}>MTN</button>
                  </div>
                </div>
                <div>
                  <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Phone Number</label>
                  <input type="text" value={adminWalletPhone} onChange={(e) => setAdminWalletPhone(e.target.value)} placeholder="e.g. 0971234567" className={`w-full px-3 py-2 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm`} />
                </div>
                <div>
                  <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Amount (K)</label>
                  <input type="number" value={adminDepositAmount} onChange={(e) => setAdminDepositAmount(e.target.value)} placeholder="0.00" min="5" className={`w-full px-3 py-2 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm`} />
                </div>
                <div className="flex items-end">
                  <button onClick={handleAdminDeposit} disabled={adminWalletProcessing} className="w-full py-2 text-sm font-medium bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50 transition-colors">
                    {adminWalletProcessing ? 'Processing...' : 'Deposit'}
                  </button>
                </div>
              </div>
            </div>

            <div className={`${surfaceColor} border ${borderColor} rounded-xl p-6`}>
              <h3 className={`text-base font-semibold ${textColor} mb-4`}>Withdraw Funds / Revenue</h3>
              <p className={`text-xs ${textMuted} mb-4`}>Withdraw your balance or platform revenue to your mobile money wallet. Standard withdrawal fees apply.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Provider</label>
                  <div className="flex gap-2">
                    <button onClick={() => setAdminWalletProvider('AIRTEL')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${adminWalletProvider === 'AIRTEL' ? 'bg-red-500 text-white' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`}`}>Airtel</button>
                    <button onClick={() => setAdminWalletProvider('MTN')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${adminWalletProvider === 'MTN' ? 'bg-yellow-500 text-black' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`}`}>MTN</button>
                  </div>
                </div>
                <div>
                  <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Phone Number</label>
                  <input type="text" value={adminWalletPhone} onChange={(e) => setAdminWalletPhone(e.target.value)} placeholder="e.g. 0971234567" className={`w-full px-3 py-2 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm`} />
                </div>
                <div>
                  <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Amount (K)</label>
                  <input type="number" value={adminWithdrawAmount} onChange={(e) => setAdminWithdrawAmount(e.target.value)} placeholder="0.00" min="5" className={`w-full px-3 py-2 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm`} />
                </div>
                <div className="flex items-end">
                  <button onClick={handleAdminWithdraw} disabled={adminWalletProcessing} className="w-full py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50 transition-colors">
                    {adminWalletProcessing ? 'Processing...' : 'Withdraw'}
                  </button>
                </div>
              </div>
            </div>

            {/* Revenue Summary */}
            {stats && (
              <div className={`${surfaceColor} border ${borderColor} rounded-xl p-6`}>
                <h3 className={`text-base font-semibold ${textColor} mb-4`}>Revenue Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <p className={`text-[10px] ${textMuted} uppercase`}>Total Revenue</p>
                    <p className="text-lg font-bold text-green-400">{formatZambianCurrency(stats.totalRevenue)}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] ${textMuted} uppercase`}>Total Volume</p>
                    <p className={`text-lg font-bold ${textColor}`}>{formatZambianCurrency(stats.totalVolume)}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] ${textMuted} uppercase`}>Total Users</p>
                    <p className={`text-lg font-bold ${textColor}`}>{stats.totalUsers}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] ${textMuted} uppercase`}>Active Markets</p>
                    <p className={`text-lg font-bold ${textColor}`}>{stats.activeMarkets}</p>
                  </div>
                </div>
                {stats.revenueBreakdown && Object.keys(stats.revenueBreakdown).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-700">
                    <p className={`text-xs font-medium ${textMuted} mb-2`}>Breakdown by Fee Type</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Object.entries(stats.revenueBreakdown).map(([type, data]: [string, any]) => (
                        <div key={type}>
                          <p className={`text-[10px] ${textMuted} uppercase`}>{type.replace(/_/g, ' ')}</p>
                          <p className="text-sm font-bold text-green-400">{formatZambianCurrency(data.total)}</p>
                          <p className={`text-[10px] ${textMuted}`}>{data.count} txns</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        </main>
      </div>

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

      {/* Balance Adjustment Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowAdjustModal(null)} />
          <div className={`relative ${surfaceColor} rounded-xl shadow-2xl w-full max-w-md p-6`}>
            <h3 className={`text-lg font-semibold ${textColor} mb-1`}>Adjust Balance</h3>
            <p className={`text-xs ${textMuted} mb-4`}>
              {showAdjustModal.fullName} (@{showAdjustModal.username}) — Current: {formatZambianCurrency(showAdjustModal.balance)}
            </p>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setAdjustType('CREDIT')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  adjustType === 'CREDIT' ? 'bg-green-500 text-white' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`
                }`}
              >
                + Credit
              </button>
              <button
                onClick={() => setAdjustType('DEBIT')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  adjustType === 'DEBIT' ? 'bg-red-500 text-white' : `${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} ${textMuted}`
                }`}
              >
                − Debit
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Amount (K)</label>
                <input
                  type="number"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm`}
                />
              </div>
              <div>
                <label className={`text-xs font-medium ${textMuted} mb-1 block`}>Reason (required)</label>
                <textarea
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Refund for failed deposit, promotional credit, correction..."
                  rows={2}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'} border ${borderColor} rounded-lg ${textColor} text-sm resize-none`}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowAdjustModal(null)}
                className={`flex-1 py-2 text-sm font-medium border ${borderColor} rounded-lg ${textMuted}`}
              >
                Cancel
              </button>
              <button
                onClick={handleAdjustBalance}
                disabled={!adjustAmount || !adjustReason.trim() || processing === showAdjustModal.id}
                className={`flex-1 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
                  adjustType === 'CREDIT' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {processing === showAdjustModal.id ? 'Processing...' : `${adjustType === 'CREDIT' ? 'Credit' : 'Debit'} K${adjustAmount || '0'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
