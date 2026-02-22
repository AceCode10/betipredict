'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown,
  Clock, DollarSign, RefreshCw, Download, Edit3, Check, X,
  Wallet, BarChart3, History, User, Shield, LogOut, Eye, EyeOff,
  Trophy, Target, Percent, AlertCircle, CheckCircle2, ChevronRight
} from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'
import { DepositModal } from '@/components/DepositModal'
import { WithdrawModal } from '@/components/WithdrawModal'

type TabType = 'overview' | 'positions' | 'transactions' | 'settings'
type TxFilter = 'ALL' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'WINNINGS' | 'MARKET_CREATION_FEE'
type PositionFilter = 'open' | 'closed' | 'all'

export default function AccountPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tab, setTab] = useState<TabType>('overview')
  const [positions, setPositions] = useState<any[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [txFilter, setTxFilter] = useState<TxFilter>('ALL')
  const [posFilter, setPosFilter] = useState<PositionFilter>('open')
  const [showDeposit, setShowDeposit] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [editUsername, setEditUsername] = useState('')
  const [editFullName, setEditFullName] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [hideBalance, setHideBalance] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin')
  }, [status, router])

  const loadData = useCallback(async () => {
    if (status !== 'authenticated') return
    setLoading(true)
    try {
      const [balRes, posRes, txRes, profRes, notifRes] = await Promise.all([
        fetch('/api/user/balance'),
        fetch('/api/user/positions'),
        fetch('/api/user/transactions'),
        fetch('/api/user/profile'),
        fetch('/api/notifications').catch(() => null),
      ])
      if (balRes.ok) { const d = await balRes.json(); setBalance(d.balance || 0) }
      if (posRes.ok) { const d = await posRes.json(); setPositions(d.positions || []) }
      if (txRes.ok) { const d = await txRes.json(); setTransactions(d.transactions || []) }
      if (profRes.ok) {
        const d = await profRes.json()
        setProfile(d.user)
        setEditUsername(d.user?.username || '')
        setEditFullName(d.user?.fullName || '')
      }
      if (notifRes?.ok) { const d = await notifRes.json(); setNotifications(d.notifications || []) }
    } catch (err) {
      console.error('Failed to load account data:', err)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { loadData() }, [loadData])

  const handleDeposit = async () => { await loadData() }
  const handleWithdraw = async () => { await loadData() }
  const handleExportCSV = () => { window.open('/api/user/export', '_blank') }

  const handleSaveProfile = async () => {
    setProfileSaving(true)
    setProfileError('')
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: editUsername, fullName: editFullName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update')
      setProfile({ ...profile, ...data.user })
      setEditingProfile(false)
    } catch (err: any) {
      setProfileError(err.message)
    } finally {
      setProfileSaving(false)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Loading your portfolio...</p>
        </div>
      </div>
    )
  }

  const openPositions = positions.filter((p: any) => !p.isClosed)
  const closedPositions = positions.filter((p: any) => p.isClosed)
  const totalPositionValue = openPositions.reduce((sum: number, p: any) => sum + (p.currentValue || 0), 0)
  const totalUnrealizedPnl = openPositions.reduce((sum: number, p: any) => sum + (p.unrealizedPnl || 0), 0)
  const totalRealizedPnl = closedPositions.reduce((sum: number, p: any) => sum + (p.realizedPnl || 0), 0)
  const totalPortfolio = balance + totalPositionValue
  const winCount = closedPositions.filter((p: any) => (p.realizedPnl || 0) > 0).length
  const winRate = closedPositions.length > 0 ? Math.round((winCount / closedPositions.length) * 100) : 0

  const filteredTx = txFilter === 'ALL' ? transactions : transactions.filter((tx: any) => tx.type === txFilter)
  const filteredPositions = posFilter === 'open' ? openPositions : posFilter === 'closed' ? closedPositions : positions

  const totalDeposits = transactions.filter((t: any) => t.type === 'DEPOSIT' && t.status === 'COMPLETED').reduce((s: number, t: any) => s + Math.abs(t.amount), 0)
  const totalWithdrawals = transactions.filter((t: any) => t.type === 'WITHDRAWAL' && t.status === 'COMPLETED').reduce((s: number, t: any) => s + Math.abs(t.amount), 0)

  const displayAmount = (amt: number) => hideBalance ? '••••••' : formatZambianCurrency(amt)

  const sidebarItems: { key: TabType; label: string; icon: any; badge?: string }[] = [
    { key: 'overview', label: 'Overview', icon: BarChart3 },
    { key: 'positions', label: 'Positions', icon: Target, badge: openPositions.length > 0 ? `${openPositions.length}` : undefined },
    { key: 'transactions', label: 'History', icon: History },
    { key: 'settings', label: 'Profile', icon: User },
  ]

  return (
    <div className="min-h-screen bg-[#0d1117] flex">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-[#161b22] border-r border-gray-800/60 flex flex-col fixed h-full z-30">
        {/* Sidebar Header */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-gray-800/60">
          <button onClick={() => router.push('/')} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{profile?.fullName || session?.user?.name}</p>
            <p className="text-[10px] text-gray-500 truncate">@{profile?.username || 'user'}</p>
          </div>
        </div>

        {/* Balance Card */}
        <div className="px-4 py-3 border-b border-gray-800/60">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500 uppercase">Balance</span>
            <button onClick={() => setHideBalance(!hideBalance)} className="text-gray-600 hover:text-gray-400">
              {hideBalance ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
          <p className="text-lg font-bold text-green-400 mb-2">{displayAmount(balance)}</p>
          <div className="flex gap-2">
            <button onClick={() => setShowDeposit(true)} className="flex-1 py-1.5 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
              Deposit
            </button>
            <button onClick={() => setShowWithdraw(true)} className="flex-1 py-1.5 text-xs font-medium bg-[#1c2030] border border-gray-700 text-gray-300 rounded-lg hover:bg-[#252840] transition-colors">
              Withdraw
            </button>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 py-2">
          {sidebarItems.map(item => {
            const Icon = item.icon
            const isActive = tab === item.key
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-green-500/10 text-green-400 border-r-2 border-green-500'
                    : 'text-gray-400 hover:bg-[#1c2030] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge && (
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${isActive ? 'bg-green-500/20' : 'bg-gray-700'}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-gray-800/60 p-3">
          <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 ml-56">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-[#0d1117] border-b border-gray-800/60">
          <div className="flex items-center h-14 px-6 gap-4">
            <h2 className="text-lg font-bold text-white capitalize">{tab === 'overview' ? 'Portfolio Overview' : tab}</h2>
            <div className="flex-1" />
            <button onClick={() => loadData()} className="p-2 text-gray-500 hover:text-white transition-colors" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="px-6 py-6 space-y-6 max-w-[1100px]">

        {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
        {tab === 'overview' && (
          <>
            {/* Hero Balance Card */}
            <div className="bg-gradient-to-br from-[#1a2332] to-[#141c28] border border-gray-800/60 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-400 text-sm font-medium">Total Portfolio Value</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  totalUnrealizedPnl >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {totalUnrealizedPnl >= 0 ? '▲' : '▼'} {hideBalance ? '••' : formatZambianCurrency(Math.abs(totalUnrealizedPnl))}
                </span>
              </div>
              <div className="text-3xl font-bold text-white mb-6">{displayAmount(totalPortfolio)}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Available Cash</p>
                  <p className="text-lg font-semibold text-white">{displayAmount(balance)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">In Positions</p>
                  <p className="text-lg font-semibold text-white">{displayAmount(totalPositionValue)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Total Deposited</p>
                  <p className="text-lg font-semibold text-green-400">{displayAmount(totalDeposits)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Total Withdrawn</p>
                  <p className="text-lg font-semibold text-orange-400">{displayAmount(totalWithdrawals)}</p>
                </div>
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Target className="w-4 h-4 text-blue-400" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-white">{openPositions.length}</p>
                <p className="text-xs text-gray-500">Open Positions</p>
              </div>
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <Trophy className="w-4 h-4 text-green-400" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-white">{winRate}%</p>
                <p className="text-xs text-gray-500">Win Rate ({winCount}/{closedPositions.length})</p>
              </div>
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${totalRealizedPnl >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    {totalRealizedPnl >= 0 ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                  </div>
                </div>
                <p className={`text-2xl font-bold ${totalRealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {displayAmount(totalRealizedPnl)}
                </p>
                <p className="text-xs text-gray-500">Realized P&L</p>
              </div>
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-purple-400" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-white">{profile?._count?.orders || 0}</p>
                <p className="text-xs text-gray-500">Total Trades</p>
              </div>
            </div>

            {/* Quick Actions + Recent */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Open Positions Preview */}
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl">
                <div className="flex items-center justify-between p-4 border-b border-gray-800/60">
                  <h3 className="text-sm font-semibold text-white">Open Positions</h3>
                  <button onClick={() => setTab('positions')} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                    View All <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  {openPositions.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">No open positions</p>
                  ) : (
                    openPositions.slice(0, 4).map((pos: any) => (
                      <div key={pos.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pos.outcome === 'YES' ? 'bg-green-400' : 'bg-red-400'}`} />
                          <span className="text-sm text-gray-300 truncate">{pos.market?.title}</span>
                        </div>
                        <span className={`text-sm font-medium ml-2 ${(pos.unrealizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(pos.unrealizedPnl || 0) >= 0 ? '+' : ''}{formatZambianCurrency(pos.unrealizedPnl || 0)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Recent Transactions Preview */}
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl">
                <div className="flex items-center justify-between p-4 border-b border-gray-800/60">
                  <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
                  <button onClick={() => setTab('transactions')} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                    View All <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  {transactions.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">No transactions yet</p>
                  ) : (
                    transactions.slice(0, 5).map((tx: any) => (
                      <div key={tx.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                            tx.type === 'DEPOSIT' ? 'bg-green-500/10' :
                            tx.type === 'WITHDRAWAL' ? 'bg-orange-500/10' :
                            tx.type === 'WINNINGS' ? 'bg-yellow-500/10' :
                            'bg-blue-500/10'
                          }`}>
                            {tx.type === 'DEPOSIT' && <ArrowDownRight className="w-3 h-3 text-green-400" />}
                            {tx.type === 'WITHDRAWAL' && <ArrowUpRight className="w-3 h-3 text-orange-400" />}
                            {tx.type === 'WINNINGS' && <Trophy className="w-3 h-3 text-yellow-400" />}
                            {!['DEPOSIT', 'WITHDRAWAL', 'WINNINGS'].includes(tx.type) && <TrendingUp className="w-3 h-3 text-blue-400" />}
                          </div>
                          <span className="text-sm text-gray-400 truncate">{tx.description}</span>
                        </div>
                        <span className={`text-sm font-medium ml-2 tabular-nums ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.amount >= 0 ? '+' : ''}{formatZambianCurrency(Math.abs(tx.amount))}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Notifications */}
            {notifications.length > 0 && (
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl">
                <div className="p-4 border-b border-gray-800/60">
                  <h3 className="text-sm font-semibold text-white">Notifications</h3>
                </div>
                <div className="divide-y divide-gray-800/40">
                  {notifications.slice(0, 5).map((n: any) => (
                    <div key={n.id} className={`p-4 ${!n.isRead ? 'bg-green-500/5' : ''}`}>
                      <p className="text-sm text-white">{n.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════ POSITIONS TAB ═══════════════ */}
        {tab === 'positions' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {(['open', 'closed', 'all'] as PositionFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setPosFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      posFilter === f ? 'bg-green-500 text-white' : 'bg-[#161b22] text-gray-400 hover:text-white border border-gray-800/60'
                    }`}
                  >
                    {f === 'open' ? `Open (${openPositions.length})` : f === 'closed' ? `Closed (${closedPositions.length})` : `All (${positions.length})`}
                  </button>
                ))}
              </div>
            </div>

            {filteredPositions.length === 0 ? (
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl p-12 text-center">
                <Target className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No {posFilter === 'all' ? '' : posFilter} positions.</p>
                <p className="text-gray-600 text-xs mt-1">Trade on a market to get started.</p>
                <button onClick={() => router.push('/')} className="mt-4 px-4 py-2 bg-green-500 text-white text-sm font-semibold rounded-lg hover:bg-green-600 transition-colors">
                  Browse Markets
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPositions.map((pos: any) => {
                  const pnl = pos.isClosed ? (pos.realizedPnl || 0) : (pos.unrealizedPnl || 0)
                  const pnlLabel = pos.isClosed ? 'Realized' : 'Unrealized'
                  return (
                    <div key={pos.id} className="bg-[#161b22] border border-gray-800/60 rounded-xl p-4 hover:border-gray-700 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{pos.market?.title || pos.market?.question}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pos.outcome === 'YES' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                            }`}>
                              {pos.outcome}
                            </span>
                            <span className="text-[10px] text-gray-600">{pos.market?.category}</span>
                            {pos.isClosed && <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">CLOSED</span>}
                          </div>
                        </div>
                        <div className="text-right ml-3">
                          <p className={`text-sm font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnl >= 0 ? '+' : ''}{formatZambianCurrency(pnl)}
                          </p>
                          <p className="text-[10px] text-gray-600">{pnlLabel} P&L</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'Shares', value: pos.size?.toFixed(2) },
                          { label: 'Avg Price', value: `${(pos.averagePrice * 100).toFixed(1)}¢` },
                          { label: 'Current', value: pos.isClosed ? '—' : `${(pos.currentPrice * 100).toFixed(1)}¢` },
                          { label: 'Value', value: pos.isClosed ? formatZambianCurrency(pos.realizedPnl || 0) : formatZambianCurrency(pos.currentValue || 0) },
                        ].map(item => (
                          <div key={item.label}>
                            <p className="text-[10px] text-gray-600">{item.label}</p>
                            <p className="text-xs font-medium text-gray-300">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ TRANSACTIONS TAB ═══════════════ */}
        {tab === 'transactions' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {(['ALL', 'DEPOSIT', 'WITHDRAWAL', 'TRADE', 'WINNINGS'] as TxFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setTxFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                      txFilter === f ? 'bg-green-500 text-white' : 'bg-[#161b22] text-gray-400 hover:text-white border border-gray-800/60'
                    }`}
                  >
                    {f === 'ALL' ? 'All' : f === 'WINNINGS' ? 'Payouts' : f.charAt(0) + f.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              <button onClick={handleExportCSV} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 flex-shrink-0 ml-2">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>

            {filteredTx.length === 0 ? (
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl p-12 text-center">
                <History className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No transactions found.</p>
              </div>
            ) : (
              <div className="bg-[#161b22] border border-gray-800/60 rounded-xl divide-y divide-gray-800/40">
                {filteredTx.map((tx: any) => (
                  <div key={tx.id} className="p-4 flex items-center gap-3 hover:bg-[#1c2030] transition-colors">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      tx.type === 'DEPOSIT' ? 'bg-green-500/10' :
                      tx.type === 'WITHDRAWAL' ? 'bg-orange-500/10' :
                      tx.type === 'WINNINGS' ? 'bg-yellow-500/10' :
                      tx.type === 'MARKET_CREATION_FEE' ? 'bg-purple-500/10' :
                      'bg-blue-500/10'
                    }`}>
                      {tx.type === 'DEPOSIT' && <ArrowDownRight className="w-5 h-5 text-green-400" />}
                      {tx.type === 'WITHDRAWAL' && <ArrowUpRight className="w-5 h-5 text-orange-400" />}
                      {tx.type === 'WINNINGS' && <Trophy className="w-5 h-5 text-yellow-400" />}
                      {tx.type === 'MARKET_CREATION_FEE' && <DollarSign className="w-5 h-5 text-purple-400" />}
                      {tx.type === 'TRADE' && <TrendingUp className="w-5 h-5 text-blue-400" />}
                      {!['DEPOSIT', 'WITHDRAWAL', 'WINNINGS', 'MARKET_CREATION_FEE', 'TRADE'].includes(tx.type) && <DollarSign className="w-5 h-5 text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{tx.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-gray-600">
                          {new Date(tx.createdAt).toLocaleDateString('en-ZM', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {tx.feeAmount > 0 && <span className="text-[10px] text-gray-600">Fee: {formatZambianCurrency(tx.feeAmount)}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold tabular-nums ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {tx.amount >= 0 ? '+' : ''}{formatZambianCurrency(Math.abs(tx.amount))}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        {tx.status === 'COMPLETED' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                        {tx.status === 'PROCESSING' && <Clock className="w-3 h-3 text-yellow-500" />}
                        {tx.status === 'FAILED' && <AlertCircle className="w-3 h-3 text-red-500" />}
                        <span className={`text-[10px] font-medium ${
                          tx.status === 'COMPLETED' ? 'text-green-600' : tx.status === 'FAILED' ? 'text-red-500' : 'text-yellow-500'
                        }`}>
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ SETTINGS TAB ═══════════════ */}
        {tab === 'settings' && profile && (
          <div className="space-y-6">
            {/* Profile Card */}
            <div className="bg-[#161b22] border border-gray-800/60 rounded-xl overflow-hidden">
              <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 p-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 border-2 border-green-500/30 flex items-center justify-center text-green-400 text-2xl font-bold">
                    {(profile.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-xl font-bold text-white">{profile.fullName}</p>
                    <p className="text-sm text-gray-400">@{profile.username}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {profile.isVerified ? (
                        <span className="flex items-center gap-1 text-xs text-green-400"><Shield className="w-3 h-3" /> Verified</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-yellow-400"><AlertCircle className="w-3 h-3" /> Unverified</span>
                      )}
                      <span className="text-xs text-gray-600">•</span>
                      <span className="text-xs text-gray-500">Joined {new Date(profile.createdAt).toLocaleDateString('en-ZM', { month: 'long', year: 'numeric' })}</span>
                    </div>
                  </div>
                  {!editingProfile ? (
                    <button onClick={() => setEditingProfile(true)} className="px-3 py-1.5 bg-[#1c2030] border border-gray-700 text-gray-300 text-sm rounded-lg hover:bg-[#252840] transition-colors flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5" /> Edit
                    </button>
                  ) : (
                    <div className="flex gap-1.5">
                      <button onClick={handleSaveProfile} disabled={profileSaving} className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 transition-colors flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" /> Save
                      </button>
                      <button onClick={() => { setEditingProfile(false); setProfileError('') }} className="px-3 py-1.5 bg-[#1c2030] border border-gray-700 text-gray-300 text-sm rounded-lg hover:bg-[#252840] transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {editingProfile ? (
                <div className="p-6 space-y-4">
                  {profileError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" /> {profileError}
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-gray-400 mb-1.5 block font-medium">Username</label>
                    <input type="text" value={editUsername} onChange={e => setEditUsername(e.target.value)}
                      className="w-full bg-[#0d1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1.5 block font-medium">Full Name</label>
                    <input type="text" value={editFullName} onChange={e => setEditFullName(e.target.value)}
                      className="w-full bg-[#0d1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors" />
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Email</p>
                      <p className="text-sm text-white">{profile.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Total Trades</p>
                      <p className="text-sm text-white">{profile._count?.orders || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Win Rate</p>
                      <p className="text-sm text-white">{winRate}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Member Since</p>
                      <p className="text-sm text-white">{new Date(profile.createdAt).toLocaleDateString('en-ZM', { month: 'short', year: 'numeric' })}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Account Actions */}
            <div className="bg-[#161b22] border border-gray-800/60 rounded-xl divide-y divide-gray-800/40">
              <button onClick={handleExportCSV} className="w-full flex items-center justify-between p-4 hover:bg-[#1c2030] transition-colors">
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 text-gray-400" />
                  <div className="text-left">
                    <p className="text-sm text-white">Export Transaction History</p>
                    <p className="text-xs text-gray-600">Download CSV of all transactions</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
              <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full flex items-center justify-between p-4 hover:bg-red-500/5 transition-colors">
                <div className="flex items-center gap-3">
                  <LogOut className="w-5 h-5 text-red-400" />
                  <div className="text-left">
                    <p className="text-sm text-red-400">Sign Out</p>
                    <p className="text-xs text-gray-600">Log out of your account</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          </div>
        )}
        </main>
      </div>

      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} onDeposit={handleDeposit} currentBalance={balance} />
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} onWithdraw={handleWithdraw} currentBalance={balance} />
    </div>
  )
}
