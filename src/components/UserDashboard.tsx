'use client'

import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@/components/WalletConnect'
import { useContractService } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Activity, 
  Trophy,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  History
} from 'lucide-react'

interface Position {
  marketId: string
  marketTitle: string
  outcome: 'YES' | 'NO'
  amount: string
  averagePrice: number
  currentPrice: number
  pnl: number
  pnlPercentage: number
  status: 'ACTIVE' | 'WON' | 'LOST'
}

interface Transaction {
  id: string
  type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAW'
  marketTitle?: string
  amount: string
  price?: number
  timestamp: Date
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
}

export function UserDashboard() {
  const { account, isConnected } = useWallet()
  const contractService = useContractService()
  const [positions, setPositions] = useState<Position[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [totalPnL, setTotalPnL] = useState(0)
  const [totalValue, setTotalValue] = useState(0)
  const [loading, setLoading] = useState(true)
  const hasFetched = useRef(false)

  useEffect(() => {
    if (isConnected && !hasFetched.current) {
      hasFetched.current = true
      fetchUserData()
    }
  }, [isConnected])

  const fetchUserData = async () => {
    if (!contractService) return

    try {
      setLoading(true)
      
      // Fetch user's positions and transactions
      // This is a simplified version - in production you'd have dedicated contract methods
      const samplePositions: Position[] = [
        {
          marketId: '1',
          marketTitle: 'Man United vs Liverpool',
          outcome: 'YES',
          amount: '100',
          averagePrice: 0.45,
          currentPrice: 0.52,
          pnl: 15.56,
          pnlPercentage: 15.56,
          status: 'ACTIVE'
        },
        {
          marketId: '2', 
          marketTitle: 'Arsenal vs Chelsea',
          outcome: 'NO',
          amount: '50',
          averagePrice: 0.60,
          currentPrice: 0.55,
          pnl: 4.17,
          pnlPercentage: 8.33,
          status: 'ACTIVE'
        },
        {
          marketId: '3',
          marketTitle: 'Real Madrid vs Barcelona',
          outcome: 'YES',
          amount: '75',
          averagePrice: 0.50,
          currentPrice: 0.50,
          pnl: 0,
          pnlPercentage: 0,
          status: 'WON'
        }
      ]

      const sampleTransactions: Transaction[] = [
        {
          id: '1',
          type: 'BUY',
          marketTitle: 'Man United vs Liverpool',
          amount: '100',
          price: 0.45,
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
          status: 'COMPLETED'
        },
        {
          id: '2',
          type: 'SELL',
          marketTitle: 'Arsenal vs Chelsea', 
          amount: '50',
          price: 0.60,
          timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
          status: 'COMPLETED'
        },
        {
          id: '3',
          type: 'DEPOSIT',
          amount: '500',
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
          status: 'COMPLETED'
        }
      ]

      setPositions(samplePositions)
      setTransactions(sampleTransactions)

      // Calculate totals
      const pnl = samplePositions.reduce((sum, pos) => sum + pos.pnl, 0)
      const value = samplePositions.reduce((sum, pos) => sum + parseFloat(pos.amount), 0)
      
      setTotalPnL(pnl)
      setTotalValue(value)
    } catch (error) {
      console.error('Error fetching user data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Wallet className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">Connect your wallet to view your dashboard</p>
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-spin w-6 h-6 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-center mt-4 text-gray-600">Loading dashboard...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Value</p>
                <p className="text-2xl font-bold">{totalValue.toFixed(2)} BPC</p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total P&L</p>
                <p className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)} BPC
                </p>
              </div>
              {totalPnL >= 0 ? (
                <TrendingUp className="w-8 h-8 text-green-600" />
              ) : (
                <TrendingDown className="w-8 h-8 text-red-600" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Positions</p>
                <p className="text-2xl font-bold">{positions.filter(p => p.status === 'ACTIVE').length}</p>
              </div>
              <Activity className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Win Rate</p>
                <p className="text-2xl font-bold">
                  {positions.length > 0 
                    ? Math.round((positions.filter(p => p.status === 'WON').length / positions.length) * 100)
                    : 0}%
                </p>
              </div>
              <Trophy className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Positions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Your Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {positions.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No positions yet</p>
            ) : (
              <div className="space-y-3">
                {positions.map((position) => (
                  <div key={position.marketId} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium text-sm">{position.marketTitle}</p>
                        <p className="text-xs text-gray-600">
                          {position.outcome} • {position.amount} BPC @ {position.averagePrice}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${
                          position.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {position.pnl >= 0 ? '+' : ''}{position.pnl.toFixed(2)} BPC
                        </p>
                        <p className={`text-xs ${
                          position.pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {position.pnlPercentage >= 0 ? '+' : ''}{position.pnlPercentage.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        position.status === 'ACTIVE' ? 'bg-blue-100 text-blue-800' :
                        position.status === 'WON' ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {position.status}
                      </span>
                      <span className="text-xs text-gray-600">
                        Current: {position.currentPrice}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Recent Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No transactions yet</p>
            ) : (
              <div className="space-y-3">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        tx.type === 'BUY' ? 'bg-green-100' :
                        tx.type === 'SELL' ? 'bg-red-100' :
                        tx.type === 'DEPOSIT' ? 'bg-blue-100' :
                        'bg-gray-100'
                      }`}>
                        {tx.type === 'BUY' && <ArrowUpRight className="w-4 h-4 text-green-600" />}
                        {tx.type === 'SELL' && <ArrowDownRight className="w-4 h-4 text-red-600" />}
                        {tx.type === 'DEPOSIT' && <ArrowDownRight className="w-4 h-4 text-blue-600" />}
                        {tx.type === 'WITHDRAW' && <ArrowUpRight className="w-4 h-4 text-gray-600" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{tx.type}</p>
                        {tx.marketTitle && (
                          <p className="text-xs text-gray-600">{tx.marketTitle}</p>
                        )}
                        {tx.price && (
                          <p className="text-xs text-gray-600">@ {tx.price}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{tx.amount} BPC</p>
                      <p className="text-xs text-gray-600">{formatTime(tx.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">Wallet Address</p>
              <p className="font-mono text-sm">{formatAddress(account!)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Network</p>
              <p className="text-sm">Localhost (Test)</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Member Since</p>
              <p className="text-sm">{new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
