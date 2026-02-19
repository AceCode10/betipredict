'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession, signIn } from 'next-auth/react'
import { useWallet, WalletConnectButton } from '@/components/WalletConnect'
import { useContractService } from '@/lib/contracts'
import { PriceChart } from '@/components/PriceChart'
import { BetSlip } from '@/components/BetSlip'
import { Header } from '@/components/Header'
import { CreateMarketModal } from '@/components/CreateMarketModal'
import { WithdrawModal } from '@/components/WithdrawModal'
import { LiveBetToast, type LiveTradeToast } from '@/components/LiveBetToast'
import { useMarketStream, type LiveTrade, type MarketPriceUpdate } from '@/lib/useMarketStream'
import { useTheme } from '@/contexts/ThemeContext'
import { 
  TrendingUp, 
  Users,
  BarChart3,
  Trophy,
  RefreshCw,
  Bookmark,
  Calendar,
  Droplets,
  Wifi,
  WifiOff
} from 'lucide-react'
import { 
  formatZambianCurrency, 
  formatPriceAsNgwee, 
  formatVolume, 
  formatTotalCost 
} from '@/utils/currency'

// Bet item interface
interface BetItem {
  id: string
  marketId: string
  marketTitle: string
  outcome: 'YES' | 'NO'
  price: number
  amount: number
}

// Sports-focused categories with Zambian leagues
const SPORTS_CATEGORIES = [
  { value: 'all', label: 'All Sports' },
  { value: 'premier-league', label: 'Premier League' },
  { value: 'la-liga', label: 'La Liga' },
  { value: 'bundesliga', label: 'Bundesliga' },
  { value: 'serie-a', label: 'Serie A' },
  { value: 'ligue-1', label: 'Ligue 1' },
  { value: 'zambia-super-league', label: 'Zambia Super League' },
  { value: 'champions-league', label: 'Champions League' },
  { value: 'other-sports', label: 'Other Sports' },
]

// Sports betting markets with Zambian currency (Kwacha K and Ngwee n)
const SPORTS_MARKETS = [
  {
    id: '1',
    title: 'Will Manchester United beat Liverpool?',
    description: 'Premier League - Old Trafford',
    category: 'premier-league',
    question: 'Manchester United vs Liverpool',
    resolveTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.45,
    noPrice: 0.55,
    volume: 25000000, // K25M volume
    liquidity: 5000000, // K5M liquidity
    status: 'ACTIVE',
    trend: 'up',
    change: '+2.3%',
    image: '/images/premier-league.jpg',
    subtitle: 'Premier League',
    league: 'Premier League',
    matchDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    homeTeam: 'Manchester United',
    awayTeam: 'Liverpool'
  },
  {
    id: '2',
    title: 'Will Real Madrid beat Barcelona?',
    description: 'La Liga - El Clásico',
    category: 'la-liga',
    question: 'Real Madrid vs Barcelona',
    resolveTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.62,
    noPrice: 0.38,
    volume: 45000000, // K45M volume
    liquidity: 8000000, // K8M liquidity
    status: 'ACTIVE',
    trend: 'down',
    change: '-1.8%',
    image: '/images/laliga.jpg',
    subtitle: 'La Liga',
    league: 'La Liga',
    matchDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    homeTeam: 'Real Madrid',
    awayTeam: 'Barcelona'
  },
  {
    id: '3',
    title: 'Will ZESCO United win?',
    description: 'Zambia Super League - Home match',
    category: 'zambia-super-league',
    question: 'ZESCO United vs Power Dynamos',
    resolveTime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.68,
    noPrice: 0.32,
    volume: 8500000, // K8.5M volume
    liquidity: 2000000, // K2M liquidity
    status: 'ACTIVE',
    trend: 'up',
    change: '+4.2%',
    image: '/images/zambia-league.jpg',
    subtitle: 'Zambia Super League',
    league: 'Zambia Super League',
    matchDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    homeTeam: 'ZESCO United',
    awayTeam: 'Power Dynamos'
  },
  {
    id: '4',
    title: 'Will Bayern Munich win?',
    description: 'Bundesliga - Allianz Arena',
    category: 'bundesliga',
    question: 'Bayern Munich vs Borussia Dortmund',
    resolveTime: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.71,
    noPrice: 0.29,
    volume: 32000000, // K32M volume
    liquidity: 6500000, // K6.5M liquidity
    status: 'ACTIVE',
    trend: 'up',
    change: '+1.5%',
    image: '/images/bundesliga.jpg',
    subtitle: 'Bundesliga',
    league: 'Bundesliga',
    matchDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    homeTeam: 'Bayern Munich',
    awayTeam: 'Borussia Dortmund'
  },
  {
    id: '5',
    title: 'Will AC Milan beat Inter?',
    description: 'Serie A - San Siro Derby',
    category: 'serie-a',
    question: 'AC Milan vs Inter Milan',
    resolveTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.48,
    noPrice: 0.52,
    volume: 28000000, // K28M volume
    liquidity: 4500000, // K4.5M liquidity
    status: 'ACTIVE',
    trend: 'down',
    change: '-2.1%',
    image: '/images/seriea.jpg',
    subtitle: 'Serie A',
    league: 'Serie A',
    matchDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    homeTeam: 'AC Milan',
    awayTeam: 'Inter Milan'
  },
  {
    id: '6',
    title: 'Will PSG win?',
    description: 'Ligue 1 - Parc des Princes',
    category: 'ligue-1',
    question: 'PSG vs Marseille',
    resolveTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    yesPrice: 0.78,
    noPrice: 0.22,
    volume: 18000000, // K18M volume
    liquidity: 3200000, // K3.2M liquidity
    status: 'ACTIVE',
    trend: 'up',
    change: '+3.6%',
    image: '/images/ligue1.jpg',
    subtitle: 'Ligue 1',
    league: 'Ligue 1',
    matchDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    homeTeam: 'PSG',
    awayTeam: 'Marseille'
  },
]

const STATS = [
  { label: '24h Volume', value: 'K156.8M', change: '+18%', icon: BarChart3 },
  { label: 'Active Markets', value: '24', change: '+3', icon: TrendingUp },
  { label: 'Active Traders', value: '2,847', change: '+156', icon: Users },
]

export default function PolymarketStyleHomePage() {
  const { data: session, status: sessionStatus } = useSession()
  const { isConnected, account, chainId } = useWallet()
  const { isDarkMode } = useTheme()
  const [markets, setMarkets] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState<string>('all')
  const [userBalance, setUserBalance] = useState<number>(0)
  const [sortBy, setSortBy] = useState<string>('volume')
  const [showChart, setShowChart] = useState<{marketId: string, outcome: 'YES' | 'NO'} | null>(null)
  const [detailAmount, setDetailAmount] = useState<string>('')
  const [betSlip, setBetSlip] = useState<BetItem[]>([])
  const [showBetSlip, setShowBetSlip] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showMarketCreation, setShowMarketCreation] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [placingBets, setPlacingBets] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveTrades, setLiveTrades] = useState<LiveTradeToast[]>([])
  
  const contractService = useContractService()
  const isLoggedIn = sessionStatus === 'authenticated' && !!session?.user

  // SSE: Real-time market data stream
  const { isConnected: isStreamConnected } = useMarketStream({
    onPriceUpdate: (updates: MarketPriceUpdate[]) => {
      setMarkets(prev => {
        const updateMap = new Map(updates.map(u => [u.id, u]))
        return prev.map(m => {
          const u = updateMap.get(m.id)
          if (!u) return m
          return {
            ...m,
            yesPrice: u.yesPrice,
            noPrice: u.noPrice,
            volume: u.volume,
            liquidity: u.liquidity,
          }
        })
      })
    },
    onNewTrades: (trades: LiveTrade[]) => {
      const toasts: LiveTradeToast[] = trades.map(t => ({
        id: t.id,
        username: t.username,
        side: t.side,
        outcome: t.outcome,
        price: t.price,
        amount: t.amount,
        marketTitle: t.marketTitle,
        marketId: t.marketId,
        createdAt: t.createdAt,
      }))
      setLiveTrades(prev => [...toasts, ...prev].slice(0, 30))
    },
  })

  // Load user balance from API
  const loadBalance = useCallback(async () => {
    if (!isLoggedIn) { setUserBalance(0); return }
    try {
      const res = await fetch('/api/user/balance')
      if (res.ok) {
        const data = await res.json()
        setUserBalance(data.balance || 0)
      }
    } catch (err) {
      console.error('Failed to load balance:', err)
    }
  }, [isLoggedIn])

  useEffect(() => { loadBalance() }, [loadBalance])

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Load markets from API, merge with fallback data
  const loadMarkets = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const response = await fetch('/api/markets')
      if (!response.ok) throw new Error('Failed to load markets')
      const apiMarkets = await response.json()
      
      if (apiMarkets.length > 0) {
        // Merge: API markets first, then fill with fallback if needed
        const apiIds = new Set(apiMarkets.map((m: any) => m.id))
        const fallback = SPORTS_MARKETS.filter(m => !apiIds.has(m.id))
        setMarkets([...apiMarkets, ...fallback])
      } else {
        setMarkets(SPORTS_MARKETS)
      }
    } catch (loadError) {
      console.error('Failed to load markets, using fallback data.', loadError)
      if (markets.length === 0) setMarkets(SPORTS_MARKETS)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { loadMarkets() }, [loadMarkets])

  // Auto-refresh every 30s for live data
  useEffect(() => {
    const interval = setInterval(() => loadMarkets(false), 30000)
    return () => clearInterval(interval)
  }, [loadMarkets])

  // Normalize market data from API or fallback to ensure consistent shape
  const normalizeMarket = (m: any) => {
    // Try title first, then question for "Team A vs Team B" pattern
    const titleVs = (m.title || '').match(/^(.+?)\s+vs\.?\s+(.+)$/i)
    const questionVs = (m.question || '').match(/^(.+?)\s+vs\.?\s+(.+)$/i)
    const vsMatch = titleVs || questionVs
    const homeTeam = m.homeTeam || (vsMatch ? vsMatch[1].trim() : m.title || 'Home')
    const awayTeam = m.awayTeam || (vsMatch ? vsMatch[2].trim() : '')
    const league = m.league || m.subcategory || m.category || ''
    const matchDate = m.matchDate || (m.resolveTime ? new Date(m.resolveTime).toLocaleDateString() : '')
    const trend = m.trend || (m.yesPrice > 0.5 ? 'up' : 'down')
    const change = m.change || ''
    const volume = m.volume || 0
    return { ...m, homeTeam, awayTeam, league, matchDate, trend, change, volume }
  }

  const normalizedMarkets = markets.map(normalizeMarket)

  // Map UI category slugs to match against API subcategory/league values
  const categoryMatchMap: Record<string, string[]> = {
    'premier-league': ['premier league', 'pl'],
    'la-liga': ['la liga', 'primera division', 'pd'],
    'bundesliga': ['bundesliga', 'bl1'],
    'serie-a': ['serie a', 'sa'],
    'ligue-1': ['ligue 1', 'fl1'],
    'zambia-super-league': ['zambia super league', 'zsl'],
    'champions-league': ['champions league', 'cl', 'uefa champions league'],
    'other-sports': ['other sports', 'other'],
  }

  const filteredMarkets = normalizedMarkets.filter(market => {
    let matchesCategory = category === 'all'
    if (!matchesCategory) {
      // Direct slug match (for hardcoded fallback markets)
      if (market.category === category) {
        matchesCategory = true
      } else {
        // Match against subcategory/league for API markets
        const targets = categoryMatchMap[category] || [category]
        const sub = (market.subcategory || '').toLowerCase()
        const league = (market.league || '').toLowerCase()
        const cat = (market.category || '').toLowerCase()
        matchesCategory = targets.some(t => sub.includes(t) || league.includes(t) || cat.includes(t))
      }
    }
    const matchesSearch = !searchQuery || 
      market.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (market.question || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (market.homeTeam || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (market.awayTeam || '').toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  }).sort((a, b) => {
    if (sortBy === 'volume') return b.volume - a.volume
    if (sortBy === 'new') return new Date(b.createdAt || Date.now()).getTime() - new Date(a.createdAt || Date.now()).getTime()
    if (sortBy === 'closing') return new Date(a.resolveTime).getTime() - new Date(b.resolveTime).getTime()
    if (sortBy === 'match-date') return new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime()
    return 0
  })

  // Betting functions
  const addToBetSlip = (market: any, outcome: 'YES' | 'NO') => {
    const existingBetIndex = betSlip.findIndex(
      bet => bet.marketId === market.id && bet.outcome === outcome
    )
    
    if (existingBetIndex >= 0) {
      // Already in bet slip, just open it
      setShowBetSlip(true)
      return
    }

    // Add new bet with K10 default stake
    const newBet: BetItem = {
      id: `${market.id}-${outcome}-${Date.now()}`,
      marketId: market.id,
      marketTitle: market.title,
      outcome,
      price: outcome === 'YES' ? market.yesPrice : market.noPrice,
      amount: 10 // Default K10 stake
    }
    setBetSlip([...betSlip, newBet])
    setShowBetSlip(true)
  }

  const updateBetAmount = (betId: string, amount: number) => {
    setBetSlip(betSlip.map(bet => 
      bet.id === betId ? { ...bet, amount } : bet
    ))
  }

  const removeBet = (betId: string) => {
    setBetSlip(betSlip.filter(bet => bet.id !== betId))
  }

  const clearBetSlip = () => {
    setBetSlip([])
  }

  const placeBets = async () => {
    if (!isLoggedIn) { signIn(); return }
    if (betSlip.length === 0) return

    setPlacingBets(true)
    setError(null)

    try {
      for (const bet of betSlip) {
        const res = await fetch('/api/trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketId: bet.marketId,
            outcome: bet.outcome,
            side: 'BUY',
            type: 'MARKET',
            amount: bet.amount,
          })
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Trade failed')

        // Update market prices locally from response
        if (data.newYesPrice && data.newNoPrice) {
          setMarkets(prev => prev.map(m =>
            m.id === bet.marketId
              ? { ...m, yesPrice: data.newYesPrice, noPrice: data.newNoPrice }
              : m
          ))
        }
      }

      await loadBalance()
      setBetSlip([])
      setShowBetSlip(false)
    } catch (err: any) {
      setError(err.message || 'Failed to place bets')
    } finally {
      setPlacingBets(false)
    }
  }

  const handleBuyFromDetail = async (market: any, outcome: 'YES' | 'NO', amount: number) => {
    if (!isLoggedIn) { signIn(); return }
    if (!amount || amount <= 0) return

    setPlacingBets(true)
    setError(null)

    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: market.id,
          outcome,
          side: 'BUY',
          type: 'MARKET',
          amount,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Trade failed')

      // Update market prices locally
      if (data.newYesPrice && data.newNoPrice) {
        setMarkets(prev => prev.map(m =>
          m.id === market.id
            ? { ...m, yesPrice: data.newYesPrice, noPrice: data.newNoPrice, volume: (m.volume || 0) + amount * (outcome === 'YES' ? market.yesPrice : market.noPrice) }
            : m
        ))
      }

      await loadBalance()
      setDetailAmount('')
      setShowChart(null)
    } catch (err: any) {
      setError(err.message || 'Failed to place trade')
    } finally {
      setPlacingBets(false)
    }
  }

  const handleCreateMarket = async (newMarket: any) => {
    if (!isLoggedIn) { signIn(); return }

    const res = await fetch('/api/markets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newMarket.title,
        description: newMarket.description,
        category: newMarket.category,
        question: newMarket.question,
        resolveTime: newMarket.resolveTime,
      })
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to create market')

    setMarkets(prev => [data, ...prev])
  }

  const handleWithdraw = async (amount: number) => {
    const res = await fetch('/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method: 'direct' })
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Withdrawal failed')

    setUserBalance(data.newBalance)
  }

  // Theme-aware colors
  const bgColor = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'
  const surfaceColor = isDarkMode ? 'bg-[#171924]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-800' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'

  // Polymarket-style homepage
  return (
    <div className={`min-h-screen ${bgColor}`}>
      {/* Header with search, create, bet slip integrated */}
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onCreateMarket={() => setShowMarketCreation(true)}
        betSlipCount={betSlip.length}
        onOpenBetSlip={() => setShowBetSlip(true)}
      />

      {/* Categories Nav */}
      <nav className={`border-b ${borderColor} ${surfaceColor} sticky top-14 z-30`}>
        <div className="max-w-[1400px] mx-auto px-4">
          <div className="flex items-center gap-1.5 h-11 overflow-x-auto no-scrollbar">
            {SPORTS_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`whitespace-nowrap px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200 flex items-center gap-1.5 ${
                  category === cat.value
                    ? isDarkMode ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30' : 'bg-green-50 text-green-700 ring-1 ring-green-200'
                    : isDarkMode ? 'text-gray-400 hover:text-white hover:bg-[#232637]' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                {cat.value === 'zambia-super-league' && <Trophy className="w-3 h-3 text-yellow-500" />}
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-3 sm:px-4 py-4">
        {/* Sort Tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto no-scrollbar">
          {[
            { value: 'volume', label: 'Top Volume' },
            { value: 'match-date', label: 'Match Date' },
            { value: 'new', label: 'New' },
            { value: 'closing', label: 'Closing Soon' }
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSortBy(tab.value)}
              className={`whitespace-nowrap px-3.5 py-1.5 text-xs font-medium transition-all duration-200 border-b-2 ${
                sortBy === tab.value
                  ? isDarkMode ? 'border-green-500 text-green-400' : 'border-green-500 text-green-700'
                  : isDarkMode ? 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Markets Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredMarkets.map((market) => {
            const yesPercent = Math.round(market.yesPrice * 100)
            const noPercent = Math.round(market.noPrice * 100)
            const cardBg = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
            const cardBorder = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
            const cardHover = isDarkMode ? 'hover:border-gray-600 hover:shadow-lg hover:shadow-black/20' : 'hover:border-gray-300 hover:shadow-lg hover:shadow-gray-200/80'
            const subtleBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-50'
            const barTrack = isDarkMode ? 'bg-gray-700/50' : 'bg-gray-200'
            return (
            <div
              key={market.id}
              className={`${cardBg} border ${cardBorder} rounded-xl p-4 ${cardHover} transition-all duration-200 cursor-pointer group card-hover-lift`}
              onClick={() => {
                if (showChart?.marketId === market.id) {
                  setShowChart(null)
                } else {
                  setShowChart({ marketId: market.id, outcome: 'YES' })
                }
              }}
            >
              {/* Card Header: icon + title */}
              <div className="flex items-start gap-3 mb-4">
                <div className={`w-9 h-9 rounded-full ${subtleBg} flex items-center justify-center flex-shrink-0 text-base ${isDarkMode ? 'border border-gray-700' : 'border border-gray-200'}`}>
                  ⚽
                </div>
                <h3 className={`text-[15px] font-semibold ${textColor} leading-snug line-clamp-2 group-hover:text-green-500 transition-colors flex-1`}>
                  {market.question || market.title}
                </h3>
              </div>

              {/* Team rows with percentages and progress bars */}
              <div className="space-y-2.5 mb-4">
                {/* Home team row */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'} truncate flex-1 font-medium`}>{market.homeTeam}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-sm font-bold ${textColor}`}>{yesPercent}%</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); addToBetSlip(market, 'YES') }}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-green-500/15 text-green-500 hover:bg-green-500/30 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); addToBetSlip(market, 'NO') }}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/30 transition-colors"
                      >
                        No
                      </button>
                    </div>
                  </div>
                  <div className={`h-1 rounded-full ${barTrack} overflow-hidden`}>
                    <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${yesPercent}%` }} />
                  </div>
                </div>
                {/* Away team row */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'} truncate flex-1 font-medium`}>{market.awayTeam}</span>
                    <span className={`text-sm font-bold ${textColor} flex-shrink-0`}>{noPercent}%</span>
                  </div>
                  <div className={`h-1 rounded-full ${barTrack} overflow-hidden`}>
                    <div className="h-full bg-red-400 rounded-full transition-all duration-500" style={{ width: `${noPercent}%` }} />
                  </div>
                </div>
              </div>

              {/* Team action buttons with odds */}
              <div className="flex gap-1.5 mb-3">
                <button
                  onClick={(e) => { e.stopPropagation(); addToBetSlip(market, 'YES') }}
                  className={`flex-1 py-2.5 text-xs font-semibold rounded-lg ${subtleBg} text-green-500 border ${cardBorder} hover:border-green-500/50 hover:bg-green-500/10 transition-all duration-200 truncate`}
                >
                  {market.homeTeam}
                </button>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className={`px-3 py-2.5 text-xs font-semibold rounded-lg ${subtleBg} ${textMuted} border ${cardBorder} hover:border-gray-400 transition-all duration-200`}
                >
                  DRAW
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); addToBetSlip(market, 'NO') }}
                  className={`flex-1 py-2.5 text-xs font-semibold rounded-lg ${subtleBg} text-red-500 border ${cardBorder} hover:border-red-500/50 hover:bg-red-500/10 transition-all duration-200 truncate`}
                >
                  {market.awayTeam}
                </button>
              </div>

              {/* Footer: volume + liquidity + league + date */}
              <div className={`flex items-center justify-between text-[11px] ${textMuted} pt-2.5 border-t ${cardBorder}`}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5" title="Volume">
                    <BarChart3 className="w-3 h-3" />
                    <span>{formatVolume(market.volume)} Vol.</span>
                  </div>
                  {(market.liquidity > 0) && (
                    <div className="flex items-center gap-0.5" title="Liquidity">
                      <Droplets className="w-3 h-3 text-blue-400" />
                      <span>{formatVolume(market.liquidity)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="truncate max-w-[70px]">{market.league}</span>
                  <span>{market.matchDate}</span>
                </div>
              </div>
            </div>
            )
          })}
        </div>

        {/* Empty State */}
        {filteredMarkets.length === 0 && !loading && (
          <div className="text-center py-16">
            <div className={`${textMuted} text-5xl mb-4`}>⚽</div>
            <p className={`${textMuted} text-sm`}>No markets found in this category</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, index) => {
              const skelBg = isDarkMode ? 'bg-gray-700' : 'bg-gray-200'
              const skelCard = isDarkMode ? 'bg-[#1e2130] border-gray-700/50' : 'bg-white border-gray-200'
              return (
              <div key={index} className={`${skelCard} border rounded-xl p-4`}>
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-9 h-9 rounded-full ${skelBg} animate-pulse`} />
                  <div className="flex-1 space-y-1.5">
                    <div className={`h-4 ${skelBg} rounded animate-pulse`} />
                    <div className={`h-4 ${skelBg} rounded animate-pulse w-2/3`} />
                  </div>
                </div>
                <div className="space-y-2.5 mb-4">
                  <div>
                    <div className={`h-5 ${skelBg} rounded animate-pulse mb-1`} />
                    <div className={`h-1 ${skelBg} rounded-full animate-pulse`} />
                  </div>
                  <div>
                    <div className={`h-5 ${skelBg} rounded animate-pulse mb-1`} />
                    <div className={`h-1 ${skelBg} rounded-full animate-pulse`} />
                  </div>
                </div>
                <div className="flex gap-1.5 mb-3">
                  <div className={`flex-1 h-10 ${skelBg} rounded-lg animate-pulse`} />
                  <div className={`w-14 h-10 ${skelBg} rounded-lg animate-pulse`} />
                  <div className={`flex-1 h-10 ${skelBg} rounded-lg animate-pulse`} />
                </div>
                <div className={`h-3 ${skelBg} rounded animate-pulse mt-2`} />
              </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Market Detail Overlay — shown when a card is clicked */}
      {showChart && (() => {
        const market = markets.find(m => m.id === showChart.marketId)
        if (!market) return null
        const modalBg = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
        const modalBorder = isDarkMode ? 'border-gray-700' : 'border-gray-200'
        const inputBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-100'
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center sm:pt-16 px-0 sm:px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowChart(null)} />
            <div className={`relative ${modalBg} border ${modalBorder} rounded-t-2xl sm:rounded-xl w-full max-w-3xl max-h-[90vh] sm:max-h-[80vh] overflow-y-auto shadow-2xl`}>
              {/* Detail Header */}
              <div className={`flex items-start gap-3 p-5 border-b ${modalBorder}`}>
                <div className={`w-11 h-11 rounded-full ${inputBg} flex items-center justify-center text-xl flex-shrink-0 ${isDarkMode ? 'border border-gray-700' : 'border border-gray-200'}`}>⚽</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-green-500/15 text-green-400' : 'bg-green-50 text-green-700'}`}>{market.league}</span>
                    {market.status === 'ACTIVE' && <span className={`text-[11px] ${textMuted}`}>• Active</span>}
                  </div>
                  <h2 className={`text-lg font-bold ${textColor} leading-snug`}>{market.question || market.title}</h2>
                </div>
                <button onClick={() => setShowChart(null)} className={`${textMuted} hover:${textColor} p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-[#252840]' : 'hover:bg-gray-100'} transition-colors`}>
                  <span className="text-xl leading-none">×</span>
                </button>
              </div>

              <div className="flex flex-col md:flex-row">
                {/* Left: Chart */}
                <div className="flex-1 p-5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      <span className={`text-sm font-semibold ${textColor}`}>{market.homeTeam} {Math.round(market.yesPrice * 100)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-400" />
                      <span className={`text-sm font-semibold ${textColor}`}>{market.awayTeam} {Math.round(market.noPrice * 100)}%</span>
                    </div>
                    <span className={`text-xs ${market.trend === 'up' ? 'text-green-500' : 'text-red-500'} ml-auto`}>
                      {market.trend === 'up' ? '▲' : '▼'} {market.change}
                    </span>
                  </div>
                  <PriceChart
                    marketId={market.id}
                    outcome={showChart.outcome}
                    currentPrice={showChart.outcome === 'YES' ? market.yesPrice : market.noPrice}
                    onClose={() => setShowChart(null)}
                    onBuy={(amount) => handleBuyFromDetail(market, showChart.outcome, amount)}
                  />
                  <div className={`flex items-center gap-4 mt-4 text-xs ${textMuted}`}>
                    <div className="flex items-center gap-1">
                      <BarChart3 className="w-3 h-3" />
                      <span>{formatVolume(market.volume)} Vol.</span>
                    </div>
                    {(market.liquidity > 0) && (
                      <div className="flex items-center gap-1">
                        <Droplets className="w-3 h-3 text-blue-400" />
                        <span>{formatVolume(market.liquidity)} Liq.</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>{market.matchDate}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Buy/Sell Panel */}
                <div className={`w-full md:w-72 border-t md:border-t-0 md:border-l ${modalBorder} p-4`}>
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      onClick={() => setShowChart({ ...showChart, outcome: 'YES' })}
                      className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${
                        showChart.outcome === 'YES'
                          ? 'bg-green-500 text-white'
                          : `${inputBg} ${textMuted} hover:${textColor}`
                      }`}
                    >
                      Yes {formatPriceAsNgwee(market.yesPrice)}
                    </button>
                    <button
                      onClick={() => setShowChart({ ...showChart, outcome: 'NO' })}
                      className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${
                        showChart.outcome === 'NO'
                          ? 'bg-red-500 text-white'
                          : `${inputBg} ${textMuted} hover:${textColor}`
                      }`}
                    >
                      No {formatPriceAsNgwee(market.noPrice)}
                    </button>
                  </div>

                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm ${textMuted}`}>Amount</span>
                      <span className={`text-sm ${textMuted}`}>Balance {formatZambianCurrency(userBalance)}</span>
                    </div>
                    <div className="relative">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${textMuted} text-lg`}>K</span>
                      <input
                        type="number"
                        value={detailAmount}
                        onChange={(e) => setDetailAmount(e.target.value)}
                        placeholder="0"
                        className={`w-full pl-8 pr-3 py-3 text-right text-2xl font-bold ${inputBg} border ${modalBorder} rounded-lg ${textColor} focus:outline-none focus:border-green-500`}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 mb-3">
                    {[1, 5, 10, 100].map(amt => (
                      <button key={amt} onClick={() => setDetailAmount(prev => String((parseFloat(prev) || 0) + amt))} className={`flex-1 py-1.5 text-xs font-medium ${inputBg} border ${modalBorder} rounded ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} hover:border-green-500/50 transition-colors`}>
                        +K{amt}
                      </button>
                    ))}
                    <button onClick={() => setDetailAmount(String(userBalance))} className={`px-2 py-1.5 text-xs font-medium ${inputBg} border ${modalBorder} rounded ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} hover:border-green-500/50 transition-colors`}>
                      Max
                    </button>
                  </div>

                  {/* To Win display */}
                  {detailAmount && parseFloat(detailAmount) > 0 && (
                    <div className="space-y-1 mb-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className={textMuted}>Potential return</span>
                        <span className="text-green-500 font-bold text-lg">
                          {formatZambianCurrency(parseFloat(detailAmount) / (showChart.outcome === 'YES' ? market.yesPrice : market.noPrice))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={textMuted}>Profit if {showChart.outcome} wins</span>
                        <span className="text-green-500 font-medium">
                          +{formatZambianCurrency((parseFloat(detailAmount) / (showChart.outcome === 'YES' ? market.yesPrice : market.noPrice)) - parseFloat(detailAmount))}
                        </span>
                      </div>
                      {parseFloat(detailAmount) > userBalance && (
                        <div className="text-xs text-red-500 mt-1">Insufficient balance ({formatZambianCurrency(userBalance)} available)</div>
                      )}
                    </div>
                  )}

                  {error && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      if (!isLoggedIn) { signIn(); return }
                      const amt = parseFloat(detailAmount)
                      if (amt > 0) {
                        handleBuyFromDetail(market, showChart.outcome, amt)
                      } else {
                        addToBetSlip(market, showChart.outcome)
                      }
                    }}
                    disabled={placingBets || (!!detailAmount && parseFloat(detailAmount) > userBalance)}
                    className={`w-full py-3 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                      showChart.outcome === 'YES'
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-red-500 hover:bg-red-600 text-white'
                    }`}
                  >
                    {placingBets ? 'Processing...' : !isLoggedIn ? 'Sign In to Trade' : detailAmount && parseFloat(detailAmount) > 0 ? `Buy ${showChart.outcome}` : 'Add to Bet Slip'}
                  </button>

                  <p className={`text-[10px] ${textMuted} text-center mt-2`}>
                    By trading, you agree to the Terms of Use.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Footer */}
      <footer className={`border-t ${borderColor} ${surfaceColor} mt-8`}>
        <div className="max-w-[1400px] mx-auto px-4 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${textColor}`}><span className="text-green-500">B</span>etiPredict</span>
            </div>
            <div className={`flex items-center gap-4 text-xs ${textMuted}`}>
              {isLoggedIn && (
                <>
                  <button onClick={() => window.location.href = '/account'} className={`hover:${textColor} transition-colors`}>My Account</button>
                  <button onClick={() => window.location.href = '/admin'} className={`hover:${textColor} transition-colors`}>Admin</button>
                </>
              )}
              <span>&copy; {new Date().getFullYear()} BetiPredict. All rights reserved.</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Bet Slip Sidebar */}
      <BetSlip
        bets={betSlip}
        onUpdateBet={updateBetAmount}
        onRemoveBet={removeBet}
        onPlaceBets={placeBets}
        onClearAll={clearBetSlip}
        isOpen={showBetSlip}
        onClose={() => setShowBetSlip(false)}
        isPlacing={placingBets}
        error={error}
        userBalance={userBalance}
      />

      {/* Market Creation Modal - new flow with scheduled games + suggestions */}
      <CreateMarketModal
        isOpen={showMarketCreation}
        onClose={() => setShowMarketCreation(false)}
        onMarketCreated={() => {
          // Reload markets after creation
          fetch('/api/markets').then(r => r.json()).then(setMarkets).catch(console.error)
        }}
      />

      {/* Withdraw Modal */}
      <WithdrawModal
        isOpen={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        onWithdraw={handleWithdraw}
        currentBalance={userBalance}
      />

      {/* Live Bet Toasts — pop-up notifications for incoming bets */}
      <LiveBetToast trades={liveTrades} maxVisible={3} />

      {/* Live Connection Indicator */}
      <div className="fixed bottom-4 right-4 z-30">
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-medium ${
          isStreamConnected
            ? isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-50 text-green-600 border border-green-200'
            : isDarkMode ? 'bg-gray-800 text-gray-500 border border-gray-700' : 'bg-gray-100 text-gray-400 border border-gray-200'
        }`}>
          {isStreamConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isStreamConnected ? 'Live' : 'Connecting...'}
        </div>
      </div>
    </div>
  )
}
