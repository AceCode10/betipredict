'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useWallet, WalletConnectButton } from '@/components/WalletConnect'
import { useContractService } from '@/lib/contracts'
import { Navigation } from '@/components/Navigation'
import { MarketCard } from '@/components/MarketCard'
import { TradeInterface } from '@/components/TradeInterface'
import { UserDashboard } from '@/components/UserDashboard'
import { Button } from '@/components/ui/button'
import { 
  TrendingUp, 
  AlertCircle, 
  Trophy,
  Star,
  Users,
  BarChart3,
  Clock,
  Search,
  ArrowUp,
  ArrowDown,
  Zap,
  CircleDot
} from 'lucide-react'

// Market types
interface BlockchainMarket {
  id: string
  title: string
  description: string
  category: string
  question: string
  resolveTime: bigint
  yesPrice: bigint
  noPrice: bigint
  totalVolume: bigint
  status: bigint
  resolution: bigint
  creator: string
  createdAt: bigint
}

// Enhanced market data with European leagues
const MARKET_CATEGORIES = [
  { value: 'all', label: 'All Sports', icon: CircleDot, color: 'bg-blue-600' },
  { value: 'premier-league', label: 'Premier League', icon: Star, color: 'bg-purple-600' },
  { value: 'la-liga', label: 'La Liga', icon: Star, color: 'bg-orange-600' },
  { value: 'bundesliga', label: 'Bundesliga', icon: Star, color: 'bg-red-600' },
  { value: 'serie-a', label: 'Serie A', icon: Star, color: 'bg-blue-800' },
  { value: 'ligue-1', label: 'Ligue 1', icon: Star, color: 'bg-yellow-600' },
  { value: 'africa-cup-of-nations', label: 'Africa Cup', icon: Trophy, color: 'bg-green-700' },
]

const TRENDING_MARKETS = [
  {
    id: '1',
    title: "Manchester United vs Liverpool",
    description: "Premier League - Old Trafford",
    category: "premier-league",
    question: "Will Manchester United win?",
    resolveTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.45,
    noPrice: 0.55,
    volume: 125000,
    status: 'ACTIVE',
    trend: 'up',
    change: '+12%',
    participants: 1847,
  },
  {
    id: '2',
    title: "Real Madrid vs Barcelona",
    description: "La Liga - El Clásico",
    category: "la-liga",
    question: "Will Real Madrid win?",
    resolveTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.62,
    noPrice: 0.38,
    volume: 289000,
    status: 'ACTIVE',
    trend: 'down',
    change: '-8%',
    participants: 3201,
  },
  {
    id: '3',
    title: "Zambia vs Nigeria",
    description: "Africa Cup of Nations Qualifier",
    category: "africa-cup-of-nations",
    question: "Will Zambia win?",
    resolveTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.38,
    noPrice: 0.62,
    volume: 67000,
    status: 'ACTIVE',
    trend: 'up',
    change: '+24%',
    participants: 892,
  },
  {
    id: '4',
    title: "Arsenal vs Chelsea",
    description: "Premier League - Emirates Stadium",
    category: "premier-league", 
    question: "Will Arsenal win?",
    resolveTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.58,
    noPrice: 0.42,
    volume: 156000,
    status: 'ACTIVE',
    trend: 'up',
    change: '+5%',
    participants: 1434,
  },
  {
    id: '5',
    title: "Bayern Munich vs Borussia Dortmund",
    description: "Bundesliga - Allianz Arena",
    category: "bundesliga",
    question: "Will Bayern Munich win?",
    resolveTime: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.71,
    noPrice: 0.29,
    volume: 198000,
    status: 'ACTIVE',
    trend: 'down',
    change: '-3%',
    participants: 2103,
  },
  {
    id: '6',
    title: "PSG vs Marseille",
    description: "Ligue 1 - Parc des Princes",
    category: "ligue-1",
    question: "Will PSG win?",
    resolveTime: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.81,
    noPrice: 0.19,
    volume: 89000,
    status: 'ACTIVE',
    trend: 'up',
    change: '+2%',
    participants: 987,
  },
]

const STATS = [
  { label: 'Total Volume', value: '$2.4M', change: '+18%', icon: BarChart3 },
  { label: 'Active Markets', value: '156', change: '+12', icon: TrendingUp },
  { label: 'Total Users', value: '12.8K', change: '+892', icon: Users },
  { label: '24h Trades', value: '8,421', change: '+1,247', icon: Zap },
]

export default function PolymarketStyleHomePage() {
  const { data: session } = useSession()
  const { isConnected, account, chainId } = useWallet()
  const [currentView, setCurrentView] = useState<'markets' | 'dashboard'>('markets')
  const [markets, setMarkets] = useState<any[]>([])
  const [selectedMarket, setSelectedMarket] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState<string>('all')
  const [userBalance, setUserBalance] = useState<string>('0')
  const [tokenBalance, setTokenBalance] = useState<string>('0')
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  
  const contractService = useContractService()

  useEffect(() => {
    // Load mock markets for browsing
    setMarkets(TRENDING_MARKETS)
  }, [])

  const filteredMarkets = markets.filter(market => {
    const matchesCategory = category === 'all' || market.category === category
    const matchesSearch = market.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         market.question.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  const formatMarketForUI = (market: BlockchainMarket) => ({
    id: market.id,
    title: market.title,
    description: market.description,
    category: market.category,
    question: market.question,
    resolveTime: new Date(Number(market.resolveTime) * 1000).toISOString(),
    yesPrice: Number(market.yesPrice) / 1e6,
    noPrice: Number(market.noPrice) / 1e6,
    volume: Number(market.totalVolume),
    status: ['PENDING', 'ACTIVE', 'RESOLVED', 'CANCELED'][Number(market.status)] as any,
    winningOutcome: Number(market.resolution) === 0 ? 'YES' : Number(market.resolution) === 1 ? 'NO' : undefined,
    creator: market.creator,
    createdAt: new Date(Number(market.createdAt) * 1000).toISOString()
  })

  // Polymarket-style homepage for non-authenticated users
  if (!isConnected && currentView === 'markets') {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Hero Section */}
        <header className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="text-center">
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center">
                  <TrendingUp className="w-10 h-10 text-white" />
                </div>
              </div>
              <h1 className="text-5xl font-bold mb-4">
                Predict on Sports. <br />Win Real Money.
              </h1>
              <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
                The premier prediction market platform for African and European sports. 
                Trade on your favorite teams with blockchain-powered security.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <WalletConnectButton />
                <button
                  onClick={() => window.scrollTo({ top: 400, behavior: 'smooth' })}
                  className="px-8 py-3 bg-white/20 backdrop-blur text-white rounded-lg hover:bg-white/30 transition-colors font-medium"
                >
                  Browse Markets
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Stats Section */}
        <section className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {STATS.map((stat, index) => {
                const IconComponent = stat.icon
                return (
                  <div key={index} className="text-center">
                    <div className="flex justify-center mb-2">
                      <IconComponent className="w-6 h-6 text-gray-600" />
                    </div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-sm text-gray-600">{stat.label}</p>
                    <p className="text-xs text-green-600">{stat.change}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Search and Filter */}
        <section className="bg-white border-b sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col md:flex-row gap-4 items-center">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search markets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {MARKET_CATEGORIES.slice(0, 5).map((cat) => {
                  const IconComponent = cat.icon
                  return (
                    <button
                      key={cat.value}
                      onClick={() => setCategory(cat.value)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                        category === cat.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <IconComponent className="w-4 h-4" />
                      {cat.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Markets Grid */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-2">🔥 Trending Markets</h2>
            <p className="text-gray-600">Most popular prediction markets right now</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMarkets.map((market) => (
              <div key={market.id} className="bg-white rounded-lg border hover:shadow-lg transition-shadow cursor-pointer">
                <div className="p-6">
                  {/* Header */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full mb-2">
                        {market.category.replace(/-/g, ' ').toUpperCase()}
                      </span>
                      <h3 className="font-semibold text-lg mb-2 line-clamp-2">{market.title}</h3>
                      <p className="text-gray-600 text-sm mb-3">{market.description}</p>
                    </div>
                    {market.trend && (
                      <div className={`flex items-center gap-1 text-sm ${
                        market.trend === 'up' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {market.trend === 'up' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                        {market.change}
                      </div>
                    )}
                  </div>

                  {/* Question */}
                  <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <p className="text-sm font-medium">{market.question}</p>
                  </div>

                  {/* Prices */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="text-center">
                      <p className="text-xs text-gray-600 mb-1">YES</p>
                      <p className="text-lg font-bold text-green-600">{Math.round(market.yesPrice * 100)}%</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600 mb-1">NO</p>
                      <p className="text-lg font-bold text-red-600">{Math.round(market.noPrice * 100)}%</p>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex justify-between items-center text-sm text-gray-600 mb-4">
                    <div className="flex items-center gap-1">
                      <BarChart3 className="w-4 h-4" />
                      <span>${(market.volume / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      <span>{market.participants.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      <span>{Math.ceil((new Date(market.resolveTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24))}d</span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => {
                      alert('Connect your wallet to start trading!')
                    }}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Connect to Trade
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredMarkets.length === 0 && (
            <div className="text-center py-12">
              <Search className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">No markets found matching your search</p>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="bg-gray-900 text-white mt-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-8 h-8 text-blue-400" />
                  <span className="text-xl font-bold">BetiPredict</span>
                </div>
                <p className="text-gray-400">
                  The premier prediction market platform for African and European sports.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Markets</h4>
                <ul className="space-y-2 text-gray-400">
                  <li>Premier League</li>
                  <li>La Liga</li>
                  <li>Bundesliga</li>
                  <li>Africa Cup</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Features</h4>
                <ul className="space-y-2 text-gray-400">
                  <li>Blockchain Security</li>
                  <li>Real-time Trading</li>
                  <li>Instant Payouts</li>
                  <li>Mobile App</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Connect</h4>
                <div className="space-y-2">
                  <WalletConnectButton />
                </div>
              </div>
            </div>
            <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
              <p>&copy; {new Date().getFullYear()} BetiPredict. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </div>
    )
  }

  // Authenticated/Connected view
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation 
        currentView={currentView}
        onViewChange={setCurrentView}
        onDeposit={() => {/* Handle deposit */}}
      />

      {/* Error Display */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* Dashboard View */}
      {currentView === 'dashboard' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <UserDashboard />
        </main>
      )}

      {/* Markets View */}
      {currentView === 'markets' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Featured Markets Banner */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 mb-8 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-2">🏆 Featured European Leagues</h2>
                <p className="text-blue-100">
                  Trade on Premier League, La Liga, Bundesliga, Serie A & Ligue 1 matches
                </p>
              </div>
              <div className="hidden md:block">
                <div className="flex items-center gap-2 text-3xl font-bold">
                  ⚽ 🏆 🇬🇧 🇪🇸 🇩🇪 🇮🇹 🇫🇷
                </div>
              </div>
            </div>
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-6">
            {MARKET_CATEGORIES.map((cat) => {
              const IconComponent = cat.icon
              return (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    category === cat.value
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-white text-gray-700 hover:bg-gray-50 border'
                  }`}
                >
                  <IconComponent className="w-4 h-4" />
                  {cat.label}
                </button>
              )
            })}
          </div>

          {/* Markets Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {filteredMarkets.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                onTrade={setSelectedMarket}
              />
            ))}
          </div>

          {filteredMarkets.length === 0 && (
            <div className="text-center py-12">
              <Search className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">No markets found in this category</p>
            </div>
          )}

          {/* Trade Interface */}
          {selectedMarket && (
            <TradeInterface
              market={selectedMarket}
              onTrade={(trade) => {/* Handle trade */}}
              userBalance={parseFloat(userBalance)}
            />
          )}
        </main>
      )}
    </div>
  )
}
