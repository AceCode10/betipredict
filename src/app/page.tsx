'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession, signIn } from 'next-auth/react'
import { useWallet, WalletConnectButton } from '@/components/WalletConnect'
import { useContractService } from '@/lib/contracts'
import { PriceChart } from '@/components/PriceChart'
// BetSlip removed — replaced by trading panel in market detail overlay
import { Header } from '@/components/Header'
import { Logo } from '@/components/Logo'
import { CreateMarketModal } from '@/components/CreateMarketModal'
import { WithdrawModal } from '@/components/WithdrawModal'
import { LiveBetToast, type LiveTradeToast } from '@/components/LiveBetToast'
import { LiveMatchBanner } from '@/components/LiveMatchBanner'
import { MarketChat } from '@/components/MarketChat'
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
  WifiOff,
  Search
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
  const [searchQuery, setSearchQuery] = useState('')
  const [showMarketCreation, setShowMarketCreation] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [placingBets, setPlacingBets] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveTrades, setLiveTrades] = useState<LiveTradeToast[]>([])
  const [tradeSide, setTradeSide] = useState<'BUY' | 'SELL'>('BUY')
  const [detailTab, setDetailTab] = useState<'comments' | 'top-holders' | 'positions' | 'activity'>('comments')
  const [holders, setHolders] = useState<{ yesHolders: any[]; noHolders: any[] }>({ yesHolders: [], noHolders: [] })
  const [positions, setPositions] = useState<any[]>([])
  const [positionFilter, setPositionFilter] = useState<string>('All')
  const [loadingHolders, setLoadingHolders] = useState(false)
  const [activityFeed, setActivityFeed] = useState<any[]>([])
  
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

  // Reset trading state when market overlay opens/changes
  useEffect(() => {
    if (showChart) {
      setDetailAmount('')
      setTradeSide('BUY')
      setDetailTab('comments')
      setHolders({ yesHolders: [], noHolders: [] })
      setPositions([])
      setActivityFeed([])
    }
  }, [showChart?.marketId])

  // Fetch holders/positions when tab changes
  useEffect(() => {
    if (!showChart) return
    const marketId = showChart.marketId

    if (detailTab === 'top-holders' && holders.yesHolders.length === 0) {
      setLoadingHolders(true)
      fetch(`/api/markets/${marketId}/holders`)
        .then(r => r.json())
        .then(data => setHolders({ yesHolders: data.yesHolders || [], noHolders: data.noHolders || [] }))
        .catch(console.error)
        .finally(() => setLoadingHolders(false))
    }

    if (detailTab === 'positions' && positions.length === 0) {
      setLoadingHolders(true)
      fetch(`/api/markets/${marketId}/positions`)
        .then(r => r.json())
        .then(data => setPositions(data.positions || []))
        .catch(console.error)
        .finally(() => setLoadingHolders(false))
    }

    if (detailTab === 'activity' && activityFeed.length === 0) {
      setLoadingHolders(true)
      fetch(`/api/markets/activity?marketId=${marketId}&limit=30`)
        .then(r => r.json())
        .then(data => setActivityFeed(data.activity || []))
        .catch(console.error)
        .finally(() => setLoadingHolders(false))
    }
  }, [detailTab, showChart?.marketId])

  // Load markets from API
  const loadMarkets = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    try {
      const response = await fetch('/api/markets')
      if (!response.ok) throw new Error('Failed to load markets')
      const apiMarkets = await response.json()
      setMarkets(apiMarkets)
    } catch (loadError) {
      console.error('Failed to load markets:', loadError)
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

  /**
   * Detect whether a market question is a Yes/No type or a match-winner type.
   * Yes/No patterns: "Will X?", "Is X?", "Can X?", "Does X?", "Are X?",
   *   "over/under", "more than", "less than", "at least", etc.
   * Match-winner: "Team A vs Team B" title with "Who will win" or team-based question.
   */
  const detectMarketType = (m: any): 'yes-no' | 'match-winner' => {
    const q = (m.question || '').toLowerCase()
    const title = (m.title || '').toLowerCase()

    // Explicit yes/no patterns in the question
    const yesNoPatterns = [
      /^will\s/,
      /^is\s/,
      /^can\s/,
      /^does\s/,
      /^do\s/,
      /^are\s/,
      /^has\s/,
      /^have\s/,
      /^should\s/,
      /^would\s/,
      /over\s*\/\s*under/,
      /over\s+\d/,
      /under\s+\d/,
      /more than/,
      /less than/,
      /at least/,
      /\bbtts\b/,
      /both teams/,
      /clean sheet/,
    ]

    // If question matches yes/no patterns AND does NOT look like "Who will win: X vs Y?"
    const isWhoWillWin = /who will win/i.test(q) || /who wins/i.test(q)
    if (isWhoWillWin) return 'match-winner'

    // Check if the title has "vs" AND the question is about the match result (not a yes/no prop)
    const titleHasVs = /\bvs\.?\s/i.test(title)
    const questionIsAboutWinning = /will.*win/i.test(q) && titleHasVs

    // If the question is "Will X win?" and title has "vs", it could be either.
    // But if it's specifically "Will [TeamA] win?" where TeamA is in the title, treat as yes/no
    // because the user is betting Yes/No on that team winning.
    if (yesNoPatterns.some(p => p.test(q))) return 'yes-no'
    if (questionIsAboutWinning) return 'yes-no'

    // If title has "vs" pattern and question doesn't match yes/no, it's match-winner
    if (titleHasVs) return 'match-winner'

    // Default: yes/no (safest for generic questions)
    return 'yes-no'
  }

  // Normalize market data from API to ensure consistent shape
  const normalizeMarket = (m: any) => {
    const marketType = detectMarketType(m)
    const titleVs = (m.title || '').match(/^(.+?)\s+vs\.?\s+(.+)$/i)
    const questionVs = (m.question || '').match(/^(.+?)\s+vs\.?\s+(.+)$/i)
    const vsMatch = titleVs || questionVs

    let homeTeam = m.homeTeam || ''
    let awayTeam = m.awayTeam || ''
    let optionA = 'Yes'
    let optionB = 'No'

    if (marketType === 'match-winner') {
      homeTeam = homeTeam || (vsMatch ? vsMatch[1].trim() : m.title || 'Home')
      awayTeam = awayTeam || (vsMatch ? vsMatch[2].trim() : 'Away')
      optionA = homeTeam
      optionB = awayTeam
    } else {
      // Yes/No market — options are always Yes and No
      optionA = 'Yes'
      optionB = 'No'
      // Still extract team names for context display if available
      if (!homeTeam && vsMatch) homeTeam = vsMatch[1].trim()
      if (!awayTeam && vsMatch) awayTeam = vsMatch[2].trim()
    }

    const league = m.league || m.subcategory || m.category || ''
    const matchDate = m.matchDate || (m.resolveTime ? new Date(m.resolveTime).toLocaleDateString() : '')
    const trend = m.trend || (m.yesPrice > 0.5 ? 'up' : 'down')
    const change = m.change || ''
    const volume = m.volume || 0
    return { ...m, marketType, homeTeam, awayTeam, optionA, optionB, league, matchDate, trend, change, volume }
  }

  const normalizedMarkets = markets.map(normalizeMarket)

  // Map UI category slugs to match against API subcategory/league values
  const categoryMatchMap: Record<string, string[]> = {
    'premier-league': ['premier league', 'pl', 'championship', 'elc'],
    'la-liga': ['la liga', 'primera division', 'pd'],
    'bundesliga': ['bundesliga', 'bl1'],
    'serie-a': ['serie a', 'sa'],
    'ligue-1': ['ligue 1', 'fl1'],
    'zambia-super-league': ['zambia super league', 'zsl'],
    'champions-league': ['champions league', 'cl', 'uefa champions league'],
  }

  const filteredMarkets = normalizedMarkets.filter(market => {
    let matchesCategory = category === 'all'
    if (!matchesCategory) {
      // Direct slug match
      if (market.category === category) {
        matchesCategory = true
      } else if (category === 'other-sports') {
        // "Other Sports" = anything NOT in the known categories
        const sub = (market.subcategory || '').toLowerCase()
        const league = (market.league || '').toLowerCase()
        const cat = (market.category || '').toLowerCase()
        const allKnown = Object.values(categoryMatchMap).flat()
        matchesCategory = !allKnown.some(t => sub.includes(t) || league.includes(t) || cat.includes(t))
      } else {
        // Match against subcategory/league for API markets
        const targets = categoryMatchMap[category] || [category]
        const sub = (market.subcategory || '').toLowerCase()
        const league = (market.league || '').toLowerCase()
        const cat = (market.category || '').toLowerCase()
        matchesCategory = targets.some(t => sub.includes(t) || league.includes(t) || cat.includes(t))
      }
    }
    const q = searchQuery.toLowerCase()
    const matchesSearch = !searchQuery || 
      market.title.toLowerCase().includes(q) ||
      (market.question || '').toLowerCase().includes(q) ||
      (market.homeTeam || '').toLowerCase().includes(q) ||
      (market.awayTeam || '').toLowerCase().includes(q) ||
      (market.league || '').toLowerCase().includes(q) ||
      (market.category || '').toLowerCase().includes(q)
    return matchesCategory && matchesSearch
  }).sort((a, b) => {
    if (sortBy === 'volume') return b.volume - a.volume
    if (sortBy === 'new') return new Date(b.createdAt || Date.now()).getTime() - new Date(a.createdAt || Date.now()).getTime()
    if (sortBy === 'closing') return new Date(a.resolveTime).getTime() - new Date(b.resolveTime).getTime()
    if (sortBy === 'match-date') return new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime()
    return 0
  })

  const handleSellFromDetail = async (market: any, outcome: 'YES' | 'NO', shares: number) => {
    if (!isLoggedIn) { signIn(); return }
    if (!shares || shares <= 0) return

    setPlacingBets(true)
    setError(null)

    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: market.id,
          outcome,
          side: 'SELL',
          type: 'MARKET',
          amount: shares,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sell failed')

      if (data.newYesPrice && data.newNoPrice) {
        setMarkets(prev => prev.map(m =>
          m.id === market.id
            ? { ...m, yesPrice: data.newYesPrice, noPrice: data.newNoPrice }
            : m
        ))
      }

      await loadBalance()
      setDetailAmount('')
    } catch (err: any) {
      setError(err.message || 'Failed to sell')
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

  const handleWithdraw = async (amount: number, phoneNumber?: string) => {
    // WithdrawModal now handles the API call internally.
    // This callback refreshes balance after a direct withdrawal completes.
    await loadBalance()
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
        {/* Mobile Search - Below Categories */}
        <div className="md:hidden px-4 py-2 border-t border-gray-800/50">
          <div className={`flex items-center ${isDarkMode ? 'bg-[#1e2130] border-gray-700' : 'bg-gray-100 border-gray-200'} border rounded-lg px-3 py-2`}>
            <Search className={`w-4 h-4 ${textMuted} flex-shrink-0`} />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`bg-transparent border-none outline-none text-sm ${textColor} placeholder:${textMuted} ml-2 w-full`}
            />
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

        {/* Live Matches Banner */}
        <LiveMatchBanner
          category={category}
          onMarketClick={(marketId, outcome) => {
            setShowChart({ marketId, outcome: outcome || 'YES' })
          }}
        />

        {/* Markets Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredMarkets.map((market) => {
            const yesPercent = Math.round(market.yesPrice * 100)
            const noPercent = Math.round(market.noPrice * 100)
            const cardBg = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
            const cardBorder = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
            const cardHover = isDarkMode ? 'hover:border-gray-600 hover:shadow-lg hover:shadow-black/20' : 'hover:border-gray-300 hover:shadow-lg hover:shadow-gray-200/80'
            const subtleBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-50'
            const isYesNo = market.marketType === 'yes-no'
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
              {/* Card Header: icon + title + circular progress */}
              <div className="flex items-start gap-3 mb-3">
                <div className="relative flex-shrink-0">
                  <div className={`w-9 h-9 rounded-full ${subtleBg} flex items-center justify-center text-base ${isDarkMode ? 'border border-gray-700' : 'border border-gray-200'}`}>
                    ⚽
                  </div>
                  {market.isLive && (
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500 items-center justify-center text-[6px] font-bold text-white">L</span>
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`text-[15px] font-semibold ${textColor} leading-snug line-clamp-2 group-hover:text-green-500 transition-colors`}>
                    {market.question || market.title}
                  </h3>
                </div>
                {isYesNo && (() => {
                  // Smooth color: 0%=deep red → 50%=orange → 100%=deep green
                  const r = yesPercent <= 50 ? 220 : Math.round(220 - (yesPercent - 50) * 4.4)
                  const g = yesPercent <= 50 ? Math.round(50 + yesPercent * 3.1) : Math.round(205 + (yesPercent - 50) * 0.4)
                  const b = yesPercent <= 50 ? Math.round(30 + yesPercent * 0.4) : Math.round(50 - (yesPercent - 50) * 0.6)
                  const strokeColor = `rgb(${r},${g},${b})`
                  const textColorPct = yesPercent >= 50 ? 'text-green-500' : yesPercent >= 30 ? 'text-orange-400' : 'text-red-400'
                  const circumference = 2 * Math.PI * 24
                  return (
                  <div className="flex-shrink-0 relative">
                    <div className="relative w-14 h-14">
                      <svg className="transform -rotate-90 w-14 h-14">
                        <circle cx="28" cy="28" r="24" stroke={isDarkMode ? '#374151' : '#e5e7eb'} strokeWidth="4" fill="none" />
                        <circle
                          cx="28" cy="28" r="24"
                          stroke={strokeColor}
                          strokeWidth="4"
                          fill="none"
                          strokeDasharray={`${circumference}`}
                          strokeDashoffset={`${circumference * (1 - yesPercent / 100)}`}
                          strokeLinecap="round"
                          className="transition-all duration-500"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-sm font-bold ${textColorPct}`}>{yesPercent}%</span>
                      </div>
                    </div>
                  </div>
                  )
                })()}
              </div>

              {/* Yes/No labels below progress */}
              {isYesNo && (
                <div className="flex justify-between mb-3">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-xs font-medium text-green-500">Yes {yesPercent}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="text-xs font-medium text-red-400">No {noPercent}%</span>
                  </div>
                </div>
              )}

              {/* Match-winner option rows */}
              {!isYesNo && (
                <div className="space-y-1.5 mb-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'} truncate flex-1 font-medium`}>{market.optionA}</span>
                    <span className={`text-sm font-bold ${textColor}`}>{yesPercent}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'} truncate flex-1 font-medium`}>{market.optionB}</span>
                    <span className={`text-sm font-bold ${textColor}`}>{noPercent}%</span>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-1.5 mb-3">
                {isYesNo ? (
                  /* Yes/No buttons — open trading interface */
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: 'YES' }) }}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20 hover:border-green-500/50 transition-all duration-200`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: 'NO' }) }}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 transition-all duration-200`}
                    >
                      No
                    </button>
                  </>
                ) : (
                  /* Match-winner buttons: TeamA | DRAW | TeamB — open trading interface */
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: 'YES' }) }}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg ${subtleBg} text-green-500 border ${cardBorder} hover:border-green-500/50 hover:bg-green-500/10 transition-all duration-200 truncate`}
                    >
                      {market.optionA}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: 'YES' }) }}
                      className={`px-3 py-2.5 text-xs font-semibold rounded-lg ${subtleBg} ${textMuted} border ${cardBorder} hover:border-gray-400 transition-all duration-200`}
                    >
                      DRAW
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: 'NO' }) }}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg ${subtleBg} text-red-500 border ${cardBorder} hover:border-red-500/50 hover:bg-red-500/10 transition-all duration-200 truncate`}
                    >
                      {market.optionB}
                    </button>
                  </>
                )}
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
                <div className="space-y-1.5 mb-4">
                  <div className={`h-5 ${skelBg} rounded animate-pulse`} />
                  <div className={`h-5 ${skelBg} rounded animate-pulse`} />
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

      {/* Market Detail Overlay — Polymarket-style trading interface */}
      {showChart && (() => {
        const market = normalizedMarkets.find(m => m.id === showChart.marketId)
        if (!market) return null
        const modalBg = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
        const modalBorder = isDarkMode ? 'border-gray-700' : 'border-gray-200'
        const inputBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-100'
        const isYesNo = market.marketType === 'yes-no'
        const price = showChart.outcome === 'YES' ? market.yesPrice : market.noPrice
        const amt = parseFloat(detailAmount) || 0
        const shares = tradeSide === 'BUY' ? (price > 0 ? (amt * 0.98) / price : 0) : amt
        const potentialReturn = tradeSide === 'BUY' ? (price > 0 ? amt * 0.98 / price : 0) : shares * price * 0.98
        const avgPriceDisplay = price
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center sm:pt-10 px-0 sm:px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowChart(null)} />
            <div className={`relative ${modalBg} border ${modalBorder} rounded-t-2xl sm:rounded-xl w-full max-w-4xl max-h-[92vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl`}>
              {/* Detail Header */}
              <div className={`flex items-start gap-3 p-4 border-b ${modalBorder}`}>
                <div className={`w-10 h-10 rounded-full ${inputBg} flex items-center justify-center text-lg flex-shrink-0 ${isDarkMode ? 'border border-gray-700' : 'border border-gray-200'}`}>⚽</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-green-500/15 text-green-400' : 'bg-green-50 text-green-700'}`}>{market.league}</span>
                    {market.status === 'ACTIVE' && <span className={`text-[11px] ${textMuted}`}>• Active</span>}
                  </div>
                  <h2 className={`text-base sm:text-lg font-bold ${textColor} leading-snug`}>{market.question || market.title}</h2>
                </div>
                <button onClick={() => setShowChart(null)} className={`${textMuted} hover:${textColor} p-1 rounded-lg ${isDarkMode ? 'hover:bg-[#252840]' : 'hover:bg-gray-100'} transition-colors flex-shrink-0`}>
                  <span className="text-xl leading-none">×</span>
                </button>
              </div>

              <div className="flex flex-col lg:flex-row">
                {/* Left: Chart + Tabs */}
                <div className="flex-1 min-w-0">
                  {/* Chart area */}
                  <div className="p-4">
                    <div className="flex items-center gap-4 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className={`text-sm font-semibold ${textColor}`}>{market.optionA} {Math.round(market.yesPrice * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-400" />
                        <span className={`text-sm font-semibold ${textColor}`}>{market.optionB} {Math.round(market.noPrice * 100)}%</span>
                      </div>
                    </div>
                    <PriceChart
                      marketId={market.id}
                      outcome={showChart.outcome}
                      currentPrice={price}
                      onClose={() => setShowChart(null)}
                      onBuy={(amount) => handleBuyFromDetail(market, showChart.outcome, amount)}
                    />
                    <div className={`flex items-center gap-4 mt-3 text-xs ${textMuted}`}>
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

                  {/* Tabbed content: Comments | Top Holders | Positions | Activity */}
                  <div className={`border-t ${modalBorder}`}>
                    <div className="flex items-center gap-0 px-4 pt-3">
                      {(['comments', 'top-holders', 'positions', 'activity'] as const).map(tab => (
                        <button
                          key={tab}
                          onClick={() => setDetailTab(tab)}
                          className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
                            detailTab === tab
                              ? isDarkMode ? 'border-white text-white' : 'border-gray-900 text-gray-900'
                              : `border-transparent ${textMuted} hover:${textColor}`
                          }`}
                        >
                          {tab === 'comments' ? 'Comments' : tab === 'top-holders' ? 'Top Holders' : tab === 'positions' ? 'Positions' : 'Activity'}
                        </button>
                      ))}
                    </div>

                    <div className="p-4 min-h-[200px]">
                      {/* Comments tab */}
                      {detailTab === 'comments' && (
                        <div>
                          {/* Rules section */}
                          <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} space-y-2 mb-4`}>
                            {market.description ? (
                              <p>{market.description}</p>
                            ) : (
                              <>
                                <p>This market resolves to <span className="text-green-500 font-medium">&quot;Yes&quot;</span> if the condition is met by {market.resolveTime ? new Date(market.resolveTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'TBD'}.</p>
                                <p>Otherwise resolves to <span className="text-red-400 font-medium">&quot;No&quot;</span>.</p>
                              </>
                            )}
                            <div className={`text-xs ${textMuted} mt-2 pt-2 border-t ${modalBorder} space-y-1`}>
                              <div className="flex justify-between"><span>Resolution</span><span className={textColor}>{market.resolveTime ? new Date(market.resolveTime).toLocaleDateString() : 'TBD'}</span></div>
                              <div className="flex justify-between"><span>Category</span><span className={textColor}>{market.league || market.category || 'General'}</span></div>
                              <div className="flex justify-between"><span>Created by</span><span className={textColor}>{market.creator?.username || 'System'}</span></div>
                            </div>
                          </div>
                          <MarketChat marketId={market.id} isOpen={true} />
                        </div>
                      )}

                      {/* Top Holders tab */}
                      {detailTab === 'top-holders' && (
                        <div>
                          {loadingHolders ? (
                            <div className={`text-center py-8 ${textMuted} text-sm`}>Loading holders...</div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Yes holders */}
                              <div>
                                <div className="flex items-center justify-between mb-3">
                                  <span className={`text-sm font-semibold ${textColor}`}>{isYesNo ? 'Yes' : market.optionA} holders</span>
                                  <span className={`text-xs ${textMuted} uppercase`}>Shares</span>
                                </div>
                                {holders.yesHolders.length === 0 ? (
                                  <p className={`text-xs ${textMuted}`}>No holders yet</p>
                                ) : (
                                  <div className="space-y-2">
                                    {holders.yesHolders.map((h: any, i: number) => (
                                      <div key={h.userId} className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full ${isDarkMode ? 'bg-green-500/20' : 'bg-green-100'} flex items-center justify-center text-[10px] font-bold text-green-500 flex-shrink-0`}>
                                          {i + 1}
                                        </div>
                                        <span className={`text-sm ${textColor} truncate flex-1`}>{h.username}</span>
                                        <span className={`text-sm font-semibold ${textColor} tabular-nums`}>{h.shares.toLocaleString()}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* No holders */}
                              <div>
                                <div className="flex items-center justify-between mb-3">
                                  <span className={`text-sm font-semibold ${textColor}`}>{isYesNo ? 'No' : market.optionB} holders</span>
                                  <span className={`text-xs ${textMuted} uppercase`}>Shares</span>
                                </div>
                                {holders.noHolders.length === 0 ? (
                                  <p className={`text-xs ${textMuted}`}>No holders yet</p>
                                ) : (
                                  <div className="space-y-2">
                                    {holders.noHolders.map((h: any, i: number) => (
                                      <div key={h.userId} className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full ${isDarkMode ? 'bg-red-500/20' : 'bg-red-100'} flex items-center justify-center text-[10px] font-bold text-red-500 flex-shrink-0`}>
                                          {i + 1}
                                        </div>
                                        <span className={`text-sm ${textColor} truncate flex-1`}>{h.username}</span>
                                        <span className={`text-sm font-semibold ${textColor} tabular-nums`}>{h.shares.toLocaleString()}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Positions tab */}
                      {detailTab === 'positions' && (
                        <div>
                          {/* Filter dropdown */}
                          <div className="flex items-center gap-3 mb-4">
                            <select
                              value={positionFilter}
                              onChange={(e) => setPositionFilter(e.target.value)}
                              className={`px-3 py-1.5 text-sm rounded-lg ${inputBg} border ${modalBorder} ${textColor} focus:outline-none`}
                            >
                              <option value="All">All</option>
                              <option value="YES">{isYesNo ? 'Yes' : market.optionA}</option>
                              <option value="NO">{isYesNo ? 'No' : market.optionB}</option>
                            </select>
                          </div>
                          {loadingHolders ? (
                            <div className={`text-center py-8 ${textMuted} text-sm`}>Loading positions...</div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Yes positions */}
                              <div>
                                <div className="flex items-center justify-between mb-3">
                                  <span className={`text-sm font-semibold ${textColor}`}>{isYesNo ? 'Yes' : market.optionA}</span>
                                  <span className={`text-xs ${textMuted} uppercase`}>PNL</span>
                                </div>
                                {positions.filter(p => positionFilter === 'All' || p.outcome === 'YES').filter(p => p.outcome === 'YES').length === 0 ? (
                                  <p className={`text-xs ${textMuted}`}>No positions</p>
                                ) : (
                                  <div className="space-y-2">
                                    {positions.filter(p => p.outcome === 'YES').filter(p => positionFilter === 'All' || p.outcome === 'YES').map((p: any) => (
                                      <div key={p.id} className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full ${isDarkMode ? 'bg-green-500/20' : 'bg-green-100'} flex items-center justify-center text-[10px] font-bold text-green-500 flex-shrink-0`}>
                                          {p.username?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <span className={`text-sm ${textColor} truncate block`}>{p.username}</span>
                                          <span className={`text-[10px] ${textMuted}`}>avg K{p.avgPrice.toFixed(2)}</span>
                                        </div>
                                        <span className={`text-sm font-semibold tabular-nums ${p.pnl >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                                          {formatZambianCurrency(Math.abs(p.pnl))}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* No positions */}
                              <div>
                                <div className="flex items-center justify-between mb-3">
                                  <span className={`text-sm font-semibold ${textColor}`}>{isYesNo ? 'No' : market.optionB}</span>
                                  <span className={`text-xs ${textMuted} uppercase`}>PNL</span>
                                </div>
                                {positions.filter(p => positionFilter === 'All' || p.outcome === 'NO').filter(p => p.outcome === 'NO').length === 0 ? (
                                  <p className={`text-xs ${textMuted}`}>No positions</p>
                                ) : (
                                  <div className="space-y-2">
                                    {positions.filter(p => p.outcome === 'NO').filter(p => positionFilter === 'All' || p.outcome === 'NO').map((p: any) => (
                                      <div key={p.id} className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full ${isDarkMode ? 'bg-red-500/20' : 'bg-red-100'} flex items-center justify-center text-[10px] font-bold text-red-500 flex-shrink-0`}>
                                          {p.username?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <span className={`text-sm ${textColor} truncate block`}>{p.username}</span>
                                          <span className={`text-[10px] ${textMuted}`}>avg K{p.avgPrice.toFixed(2)}</span>
                                        </div>
                                        <span className={`text-sm font-semibold tabular-nums ${p.pnl >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                                          {formatZambianCurrency(Math.abs(p.pnl))}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Activity tab */}
                      {detailTab === 'activity' && (
                        <div>
                          {loadingHolders ? (
                            <div className={`text-center py-8 ${textMuted} text-sm`}>Loading activity...</div>
                          ) : activityFeed.length === 0 ? (
                            <div className={`text-center py-8 ${textMuted} text-sm`}>No trading activity yet.</div>
                          ) : (
                            <div className="space-y-1">
                              {activityFeed.map((a: any) => {
                                const isBuy = a.side === 'BUY'
                                const timeAgo = (() => {
                                  const diff = Date.now() - new Date(a.createdAt).getTime()
                                  const mins = Math.floor(diff / 60000)
                                  if (mins < 1) return 'just now'
                                  if (mins < 60) return `${mins}m ago`
                                  const hrs = Math.floor(mins / 60)
                                  if (hrs < 24) return `${hrs}h ago`
                                  return `${Math.floor(hrs / 24)}d ago`
                                })()
                                return (
                                  <div key={a.id} className={`flex items-center gap-3 py-2.5 px-2 rounded-lg ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'} transition-colors`}>
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                      isBuy
                                        ? isDarkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600'
                                        : isDarkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-600'
                                    }`}>
                                      {isBuy ? 'B' : 'S'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className={`text-sm ${textColor}`}>
                                        <span className="font-medium">{a.username}</span>
                                        <span className={textMuted}> {isBuy ? 'bought' : 'sold'} </span>
                                        <span className={`font-semibold ${a.outcome === 'YES' ? 'text-green-500' : 'text-red-400'}`}>
                                          {a.amount.toFixed(1)} {a.outcome}
                                        </span>
                                        <span className={textMuted}> @ {(a.price * 100).toFixed(0)}%</span>
                                      </div>
                                    </div>
                                    <span className={`text-[11px] ${textMuted} flex-shrink-0`}>{timeAgo}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Trading Panel — Polymarket style */}
                <div className={`w-full lg:w-[280px] border-t lg:border-t-0 lg:border-l ${modalBorder} p-4 flex-shrink-0`}>
                  {/* Buy / Sell toggle */}
                  <div className="flex items-center gap-1 mb-3">
                    <button
                      onClick={() => { setTradeSide('BUY'); setDetailAmount('') }}
                      className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                        tradeSide === 'BUY'
                          ? isDarkMode ? 'bg-white/10 text-white' : 'bg-gray-900 text-white'
                          : `${textMuted} hover:${textColor}`
                      }`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => { setTradeSide('SELL'); setDetailAmount('') }}
                      className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                        tradeSide === 'SELL'
                          ? isDarkMode ? 'bg-white/10 text-white' : 'bg-gray-900 text-white'
                          : `${textMuted} hover:${textColor}`
                      }`}
                    >
                      Sell
                    </button>
                    <div className={`ml-auto text-xs ${textMuted}`}>Market ▾</div>
                  </div>

                  {/* Outcome selector buttons */}
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => setShowChart({ ...showChart, outcome: 'YES' })}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        showChart.outcome === 'YES'
                          ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                          : `${inputBg} ${textMuted} border ${modalBorder}`
                      }`}
                    >
                      {isYesNo ? 'Yes' : market.optionA} {formatPriceAsNgwee(market.yesPrice)}
                    </button>
                    <button
                      onClick={() => setShowChart({ ...showChart, outcome: 'NO' })}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        showChart.outcome === 'NO'
                          ? 'bg-red-500 text-white shadow-lg shadow-red-500/20'
                          : `${inputBg} ${textMuted} border ${modalBorder}`
                      }`}
                    >
                      {isYesNo ? 'No' : market.optionB} {formatPriceAsNgwee(market.noPrice)}
                    </button>
                  </div>

                  {/* Amount input */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm ${textMuted}`}>{tradeSide === 'BUY' ? 'Amount' : 'Shares'}</span>
                    </div>
                    <div className="relative">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${textMuted} text-lg font-medium`}>{tradeSide === 'BUY' ? 'K' : ''}</span>
                      <input
                        type="number"
                        value={detailAmount}
                        onChange={(e) => setDetailAmount(e.target.value)}
                        placeholder="0"
                        className={`w-full ${tradeSide === 'BUY' ? 'pl-8' : 'pl-3'} pr-3 py-3 text-right text-2xl font-bold ${inputBg} border ${modalBorder} rounded-lg ${textColor} focus:outline-none focus:border-green-500`}
                      />
                    </div>
                  </div>

                  {/* Quick-add buttons */}
                  <div className="flex gap-1.5 mb-3">
                    {(tradeSide === 'BUY' ? [1, 5, 10, 100] : [10, 50, 100, 500]).map(val => (
                      <button
                        key={val}
                        onClick={() => setDetailAmount(prev => String((parseFloat(prev) || 0) + val))}
                        className={`flex-1 py-1.5 text-xs font-medium ${inputBg} border ${modalBorder} rounded ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} hover:border-green-500/50 transition-colors`}
                      >
                        +{tradeSide === 'BUY' ? 'K' : ''}{val}
                      </button>
                    ))}
                    <button
                      onClick={() => setDetailAmount(tradeSide === 'BUY' ? String(userBalance) : 'Max')}
                      className={`px-2 py-1.5 text-xs font-medium ${inputBg} border ${modalBorder} rounded ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} hover:border-green-500/50 transition-colors`}
                    >
                      Max
                    </button>
                  </div>

                  {/* To Win / Proceeds display */}
                  {amt > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {tradeSide === 'BUY' ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className={`text-sm ${textMuted} flex items-center gap-1`}>
                              To win <span className="text-green-500">🍀</span>
                            </span>
                            <span className="text-green-500 font-bold text-xl tabular-nums">
                              {formatZambianCurrency(potentialReturn)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className={textMuted}>Avg. Price</span>
                            <span className={textColor}>{formatPriceAsNgwee(avgPriceDisplay)} ⓘ</span>
                          </div>
                          {amt > userBalance && (
                            <div className="text-xs text-red-500">Insufficient balance ({formatZambianCurrency(userBalance)})</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <span className={`text-sm ${textMuted}`}>Est. proceeds</span>
                            <span className="text-green-500 font-bold text-xl tabular-nums">
                              {formatZambianCurrency(potentialReturn)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {error && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                      {error}
                    </div>
                  )}

                  {/* Trade button */}
                  <button
                    onClick={() => {
                      if (!isLoggedIn) { signIn(); return }
                      if (amt <= 0) return
                      if (tradeSide === 'BUY') {
                        handleBuyFromDetail(market, showChart.outcome, amt)
                      } else {
                        handleSellFromDetail(market, showChart.outcome, amt)
                      }
                    }}
                    disabled={placingBets || amt <= 0 || (tradeSide === 'BUY' && amt > userBalance)}
                    className={`w-full py-3 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                      tradeSide === 'SELL'
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                    }`}
                  >
                    {placingBets ? 'Processing...' : !isLoggedIn ? 'Sign In to Trade' : amt > 0 ? 'Trade' : 'Enter amount'}
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
              <Logo size="sm" />
            </div>
            <div className={`flex items-center gap-4 text-xs ${textMuted}`}>
              <button onClick={() => window.location.href = '/account'} className={`hover:${textColor} transition-colors`}>My Account</button>
              <button onClick={() => window.location.href = '/leaderboard'} className={`hover:${textColor} transition-colors`}>Leaderboard</button>
              <button onClick={() => window.location.href = '/terms'} className={`hover:${textColor} transition-colors`}>Terms</button>
              <button onClick={() => window.location.href = '/privacy'} className={`hover:${textColor} transition-colors`}>Privacy</button>
              <span>&copy; {new Date().getFullYear()} BetiPredict. All rights reserved.</span>
            </div>
          </div>
        </div>
      </footer>

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
