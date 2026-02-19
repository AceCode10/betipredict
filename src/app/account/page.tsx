'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, ArrowDownRight, TrendingUp, Clock, DollarSign, Filter } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

type TabType = 'positions' | 'transactions'
type TxFilter = 'ALL' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE'

export default function AccountPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tab, setTab] = useState<TabType>('positions')
  const [positions, setPositions] = useState<any[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [txFilter, setTxFilter] = useState<TxFilter>('ALL')

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [status, router])

  useEffect(() => {
    if (status !== 'authenticated') return

    const loadData = async () => {
      setLoading(true)
      try {
        const [balRes, posRes, txRes] = await Promise.all([
          fetch('/api/user/balance'),
          fetch('/api/user/positions'),
          fetch('/api/user/transactions')
        ])

        if (balRes.ok) {
          const data = await balRes.json()
          setBalance(data.balance || 0)
        }
        if (posRes.ok) {
          const data = await posRes.json()
          setPositions(data.positions || [])
        }
        if (txRes.ok) {
          const data = await txRes.json()
          setTransactions(data.transactions || [])
        }
      } catch (err) {
        console.error('Failed to load account data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [status])

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#131722] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  const totalPositionValue = positions.reduce((sum: number, p: any) => sum + (p.currentValue || 0), 0)
  const totalPnl = positions.reduce((sum: number, p: any) => sum + (p.unrealizedPnl || 0), 0)

  const filteredTx = txFilter === 'ALL'
    ? transactions
    : transactions.filter((tx: any) => tx.type === txFilter)

  return (
    <div className="min-h-screen bg-[#131722]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-[#171924]">
        <div className="max-w-[1000px] mx-auto px-4">
          <div className="flex items-center h-14 gap-4">
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-white">My Account</h1>
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-4 py-6 space-y-6">
        {/* Balance Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <DollarSign className="w-3.5 h-3.5" />
              Cash Balance
            </div>
            <div className="text-xl font-bold text-white">{formatZambianCurrency(balance)}</div>
          </div>
          <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Positions Value
            </div>
            <div className="text-xl font-bold text-white">{formatZambianCurrency(totalPositionValue)}</div>
          </div>
          <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Unrealized P&L
            </div>
            <div className={`text-xl font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{formatZambianCurrency(totalPnl)}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#1c2030] rounded-lg p-1 border border-gray-800">
          <button
            onClick={() => setTab('positions')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'positions' ? 'bg-green-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Positions ({positions.length})
          </button>
          <button
            onClick={() => setTab('transactions')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'transactions' ? 'bg-green-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Transactions ({transactions.length})
          </button>
        </div>

        {/* Positions Tab */}
        {tab === 'positions' && (
          <div className="space-y-3">
            {positions.length === 0 ? (
              <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-8 text-center">
                <TrendingUp className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No open positions yet.</p>
                <p className="text-gray-500 text-xs mt-1">Place a bet on a market to get started.</p>
              </div>
            ) : (
              positions.map((pos: any) => (
                <div key={pos.id} className="bg-[#1c2030] border border-gray-800 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{pos.market?.title || pos.market?.question}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{pos.market?.category}</p>
                    </div>
                    <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${
                      pos.outcome === 'YES' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {pos.outcome}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-gray-500">Shares</span>
                      <p className="text-white font-medium">{pos.size?.toFixed(1)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Avg Price</span>
                      <p className="text-white font-medium">{(pos.averagePrice * 100).toFixed(0)}n</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Current</span>
                      <p className="text-white font-medium">{(pos.currentPrice * 100).toFixed(0)}n</p>
                    </div>
                    <div>
                      <span className="text-gray-500">P&L</span>
                      <p className={`font-medium ${(pos.unrealizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {(pos.unrealizedPnl || 0) >= 0 ? '+' : ''}{formatZambianCurrency(pos.unrealizedPnl || 0)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Transactions Tab */}
        {tab === 'transactions' && (
          <div className="space-y-3">
            {/* Filter */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {(['ALL', 'DEPOSIT', 'WITHDRAWAL', 'TRADE'] as TxFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setTxFilter(f)}
                  className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                    txFilter === f ? 'bg-green-500 text-white' : 'bg-[#232637] text-gray-400 hover:text-white'
                  }`}
                >
                  {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            {filteredTx.length === 0 ? (
              <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-8 text-center">
                <Clock className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No transactions yet.</p>
              </div>
            ) : (
              filteredTx.map((tx: any) => (
                <div key={tx.id} className="bg-[#1c2030] border border-gray-800 rounded-xl p-4 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    tx.type === 'DEPOSIT' ? 'bg-green-500/10' :
                    tx.type === 'WITHDRAWAL' ? 'bg-orange-500/10' :
                    'bg-blue-500/10'
                  }`}>
                    {tx.type === 'DEPOSIT' && <ArrowDownRight className="w-4.5 h-4.5 text-green-400" />}
                    {tx.type === 'WITHDRAWAL' && <ArrowUpRight className="w-4.5 h-4.5 text-orange-400" />}
                    {tx.type === 'TRADE' && <TrendingUp className="w-4.5 h-4.5 text-blue-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{tx.description}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(tx.createdAt).toLocaleDateString('en-ZM', {
                        month: 'short', day: 'numeric', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${
                      tx.amount >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {tx.amount >= 0 ? '+' : ''}{formatZambianCurrency(Math.abs(tx.amount))}
                    </p>
                    <p className={`text-[10px] font-medium ${
                      tx.status === 'COMPLETED' ? 'text-green-500' : 'text-yellow-500'
                    }`}>
                      {tx.status}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  )
}
