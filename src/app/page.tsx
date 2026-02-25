'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession, signIn } from 'next-auth/react'
import { useWallet, WalletConnectButton } from '@/components/WalletConnect'
import { useContractService } from '@/lib/contracts'
import { useOnChainTrade } from '@/hooks/useOnChainTrade'
import { PriceChart } from '@/components/PriceChart'
// BetSlip removed — replaced by trading panel in market detail overlay
import { Header } from '@/components/Header'
import { Logo } from '@/components/Logo'
import { CreateMarketModal } from '@/components/CreateMarketModal'
import { HowItWorksModal } from '@/components/HowItWorksModal'
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
  outcome: 'YES' | 'NO' | 'HOME' | 'DRAW' | 'AWAY'
  price: number
  amount: number
}

// Categories from shared config
import { getNavCategories } from '@/lib/categories'
const SPORTS_CATEGORIES = getNavCategories()



export default function PolymarketStyleHomePage() {
  const { data: session, status: sessionStatus } = useSession()
  const { isConnected, account, chainId } = useWallet()
  const { isDarkMode } = useTheme()
  const [markets, setMarkets] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState<string>('all')
  const [userBalance, setUserBalance] = useState<number>(0)
  const [sortBy, setSortBy] = useState<string>('volume')
  const [showChart, setShowChart] = useState<{marketId: string, outcome: 'YES' | 'NO' | 'HOME' | 'DRAW' | 'AWAY'} | null>(null)
  const [detailAmount, setDetailAmount] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showMarketCreation, setShowMarketCreation] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [placingBets, setPlacingBets] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveTrades, setLiveTrades] = useState<LiveTradeToast[]>([])
  const [tradeSide, setTradeSide] = useState<'BUY' | 'SELL'>('BUY')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('LIMIT')
  const [limitPrice, setLimitPrice] = useState<string>('')
  const [orderBookData, setOrderBookData] = useState<any>(null)
  const [detailTab, setDetailTab] = useState<'comments' | 'top-holders' | 'positions' | 'activity'>('comments')
  const [holders, setHolders] = useState<{ yesHolders: any[]; noHolders: any[] }>({ yesHolders: [], noHolders: [] })
  const [positions, setPositions] = useState<any[]>([])
  const [positionFilter, setPositionFilter] = useState<string>('All')
  const [loadingHolders, setLoadingHolders] = useState(false)
  const [activityFeed, setActivityFeed] = useState<any[]>([])
  const [liveMarketIds, setLiveMarketIds] = useState<Set<string>>(new Set())
  
  const contractService = useContractService()
  const { isOnChain, tokenBalance, tokenSymbol, buyOnChain, sellOnChain, claimOnChain, getPosition: getOnChainPosition, estimateBuy, refreshBalance: refreshOnChainBalance, loading: onChainLoading } = useOnChainTrade()
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
            drawPrice: u.drawPrice ?? m.drawPrice,
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

  // Abbreviate long team names to fit on buttons (max ~14 chars)
  const abbreviateTeam = (name: string, maxLen: number = 14): string => {
    if (!name || name.length <= maxLen) return name
    // Common prefixes/suffixes to strip
    const strips = [
      /\bFC\b/i, /\bCF\b/i, /\bSC\b/i, /\bAC\b/i, /\bAS\b/i,
      /\bRCD\b/i, /\bRCD\b/i, /\bSSC\b/i, /\bRC\b/i,
      /\bde\s+\w+$/i,    // "de Barcelona" → strip
      /\bUnited\b/i,     // replace with Utd
      /\bCity\b/i,
    ]
    let short = name
    // Try removing "de <City>" suffix first
    short = short.replace(/\s+de\s+\w+$/i, '').trim()
    if (short.length <= maxLen) return short
    // Try removing common prefixes
    short = short.replace(/^(RCD|SSC|RC|AS|AC|SC|FC|CF)\s+/i, '').trim()
    if (short.length <= maxLen) return short
    // Try abbreviating common words
    short = short.replace(/\bUnited\b/gi, 'Utd').replace(/\bCity\b/gi, 'City')
    if (short.length <= maxLen) return short
    // Last resort: truncate with ellipsis
    return short.slice(0, maxLen - 1) + '…'
  }

  // Normalize market data from API to ensure consistent shape
  const normalizeMarket = (m: any) => {
    // Use DB marketType if available; fall back to heuristic detection for legacy markets
    const isTri = m.marketType === 'TRI_OUTCOME'
    const uiType = isTri ? 'match-winner' : detectMarketType(m)
    const titleVs = (m.title || '').match(/^(.+?)\s+vs\.?\s+(.+)$/i)
    const questionVs = (m.question || '').match(/^(.+?)\s+vs\.?\s+(.+)$/i)
    const vsMatch = titleVs || questionVs

    let homeTeam = m.homeTeam || ''
    let awayTeam = m.awayTeam || ''
    let optionA = 'Yes'
    let optionB = 'No'

    if (uiType === 'match-winner') {
      homeTeam = homeTeam || (vsMatch ? vsMatch[1].trim() : m.title || 'Home')
      awayTeam = awayTeam || (vsMatch ? vsMatch[2].trim() : 'Away')
      optionA = homeTeam
      optionB = awayTeam
    } else {
      optionA = 'Yes'
      optionB = 'No'
      if (!homeTeam && vsMatch) homeTeam = vsMatch[1].trim()
      if (!awayTeam && vsMatch) awayTeam = vsMatch[2].trim()
    }

    const rawLeague = m.league || m.subcategory || m.category || ''
    // Apply display name mapping for known leagues
    const LEAGUE_SHORT: Record<string, string> = {
      'Premier League': 'EPL',
      'Serie A': 'Serie A',
      'Ligue 1': 'Ligue 1',
      'Primera Division': 'La Liga',
      'La Liga': 'La Liga',
      'Bundesliga': 'Bundesliga',
      'UEFA Champions League': 'UCL',
      'Champions League': 'UCL',
    }
    const league = LEAGUE_SHORT[rawLeague] || rawLeague
    const rawDate = m.matchDate || m.resolveTime
    const matchDate = rawDate ? new Date(rawDate).toLocaleDateString() : ''
    const trend = m.trend || (m.yesPrice > 0.5 ? 'up' : 'down')
    const change = m.change || ''
    const volume = m.volume || 0
    const homeTeamCrest = m.homeTeamCrest || null
    const awayTeamCrest = m.awayTeamCrest || null
    const gameStatus = m.gameStatus || null
    const liveHomeScore = m.liveHomeScore ?? null
    const liveAwayScore = m.liveAwayScore ?? null
    // For TRI_OUTCOME: yesPrice=homePrice, noPrice=awayPrice, drawPrice=drawPrice
    const homePrice = isTri ? m.yesPrice : null
    const drawPrice = isTri ? (m.drawPrice ?? 0.25) : null
    const awayPrice = isTri ? m.noPrice : null
    return { ...m, marketType: uiType, isTri, homeTeam, awayTeam, optionA, optionB, league, matchDate, trend, change, volume, homeTeamCrest, awayTeamCrest, gameStatus, liveHomeScore, liveAwayScore, homePrice, drawPrice, awayPrice }
  }

  const normalizedMarkets = markets.map(normalizeMarket)

  // Map UI category slugs to match against API subcategory/league values
  const categoryMatchMap: Record<string, string[]> = {
    'football': ['sports', 'football'],
    'premier-league': ['premier league', 'pl', 'championship', 'elc', 'epl'],
    'la-liga': ['la liga', 'primera division', 'pd'],
    'bundesliga': ['bundesliga', 'bl1'],
    'serie-a': ['serie a', 'sa'],
    'ligue-1': ['ligue 1', 'fl1'],
    'zambia-super-league': ['zambia super league', 'zsl'],
    'champions-league': ['champions league', 'cl', 'uefa champions league', 'ucl'],
    'politics': ['politics'],
    'finance': ['finance', 'stocks', 'economics'],
    'entertainment': ['entertainment', 'movies', 'tv', 'music'],
    'social': ['social', 'community', 'trending'],
    'weather': ['weather', 'climate', 'temperature'],
    'other': [],
  }

  const filteredMarkets = normalizedMarkets.filter(market => {
    let matchesCategory = category === 'all'
    if (!matchesCategory) {
      const sub = (market.subcategory || '').toLowerCase()
      const league = (market.league || '').toLowerCase()
      const cat = (market.category || '').toLowerCase()

      if (market.category?.toLowerCase() === category || cat === category) {
        matchesCategory = true
      } else if (category === 'Football') {
        // "Football" = any market with category "Sports" or "Football" or any known league
        const sportLeagues = ['premier league', 'pl', 'la liga', 'pd', 'bundesliga', 'bl1', 'serie a', 'sa', 'ligue 1', 'fl1', 'champions league', 'cl', 'zambia super league', 'zsl']
        matchesCategory = cat === 'sports' || cat === 'football' || sportLeagues.some(t => sub.includes(t) || league.includes(t))
      } else if (category === 'other') {
        // "Other" = anything NOT in the known categories
        const allKnown = Object.values(categoryMatchMap).flat()
        matchesCategory = !allKnown.some(t => t && (sub.includes(t) || league.includes(t) || cat.includes(t)))
      } else {
        // Match against subcategory/league for API markets
        const targets = categoryMatchMap[category.toLowerCase()] || [category.toLowerCase()]
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

  const handleSellFromDetail = async (market: any, outcome: string, shares: number) => {
    if (!isLoggedIn && !isOnChain) { signIn(); return }
    if (!shares || shares <= 0) return

    setPlacingBets(true)
    setError(null)

    try {
      // On-chain selling when wallet is connected
      if (isOnChain && market.onChainId) {
        const sharesBigInt = BigInt(Math.floor(shares * 1e6)) // USDC 6 decimals
        const result = await sellOnChain(market.onChainId, outcome as any, sharesBigInt)
        if (!result.success) throw new Error(result.error || 'On-chain sell failed')
        await refreshOnChainBalance()
        setDetailAmount('')
        fetch(`/api/markets`).then(r => r.json()).then(setMarkets).catch(() => {})
        return
      }

      // Centralized API — CLOB sell with limit/market order support
      const tradeBody: any = {
        marketId: market.id,
        outcome,
        side: 'SELL',
        type: orderType,
        amount: shares,
      }
      if (orderType === 'LIMIT' && limitPrice) {
        tradeBody.price = parseFloat(limitPrice)
      }

      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradeBody)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sell failed')

      // Update order book data if returned
      if (data.orderBook) setOrderBookData(data.orderBook)

      // Update market prices locally (supports both CLOB and legacy CPMM responses)
      setMarkets(prev => prev.map(m => {
        if (m.id !== market.id) return m
        const updates: any = {}
        if (typeof data.newVolume === 'number') updates.volume = data.newVolume
        if (typeof data.newLiquidity === 'number') updates.liquidity = data.newLiquidity
        if (data.yesPrice != null) updates.yesPrice = data.yesPrice
        if (data.noPrice != null) updates.noPrice = data.noPrice
        if (data.drawPrice != null) updates.drawPrice = data.drawPrice
        if (data.newHomePrice != null) {
          updates.yesPrice = data.newHomePrice
          updates.noPrice = data.newAwayPrice
          updates.drawPrice = data.newDrawPrice
        } else if (data.newYesPrice != null) {
          updates.yesPrice = data.newYesPrice
          updates.noPrice = data.newNoPrice
        }
        return { ...m, ...updates }
      }))

      await loadBalance()
      setDetailAmount('')
    } catch (err: any) {
      setError(err.message || 'Failed to sell')
    } finally {
      setPlacingBets(false)
    }
  }

  const handleBuyFromDetail = async (market: any, outcome: string, amount: number) => {
    if (!isLoggedIn && !isOnChain) { signIn(); return }
    if (!amount || amount <= 0) return

    setPlacingBets(true)
    setError(null)

    try {
      // On-chain trading when wallet is connected
      if (isOnChain && market.onChainId) {
        const result = await buyOnChain(market.onChainId, outcome as any, amount)
        if (!result.success) throw new Error(result.error || 'On-chain trade failed')
        await refreshOnChainBalance()
        setDetailAmount('')
        fetch(`/api/markets`).then(r => r.json()).then(setMarkets).catch(() => {})
        return
      }

      // Centralized API trading — CLOB with limit/market order support
      const tradeBody: any = {
        marketId: market.id,
        outcome,
        side: 'BUY',
        type: orderType,
        amount,
      }
      if (orderType === 'LIMIT' && limitPrice) {
        tradeBody.price = parseFloat(limitPrice)
      }

      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradeBody)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Trade failed')

      // Update order book data if returned
      if (data.orderBook) setOrderBookData(data.orderBook)

      // Update market prices locally (supports both CLOB and legacy CPMM responses)
      setMarkets(prev => prev.map(m => {
        if (m.id !== market.id) return m
        const updates: any = {}
        if (typeof data.newVolume === 'number') updates.volume = data.newVolume
        if (typeof data.newLiquidity === 'number') updates.liquidity = data.newLiquidity
        // CLOB response: prices are flat fields (yesPrice, noPrice, drawPrice)
        if (data.yesPrice != null) updates.yesPrice = data.yesPrice
        if (data.noPrice != null) updates.noPrice = data.noPrice
        if (data.drawPrice != null) updates.drawPrice = data.drawPrice
        // Legacy CPMM response
        if (data.newHomePrice != null) {
          updates.yesPrice = data.newHomePrice
          updates.noPrice = data.newAwayPrice
          updates.drawPrice = data.newDrawPrice
        } else if (data.newYesPrice != null) {
          updates.yesPrice = data.newYesPrice
          updates.noPrice = data.newNoPrice
        }
        return { ...m, ...updates }
      }))

      await loadBalance()
      setDetailAmount('')
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
                className={`whitespace-nowrap px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200 flex items-center gap-1 ${
                  category === cat.value
                    ? isDarkMode ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30' : 'bg-green-50 text-green-700 ring-1 ring-green-200'
                    : isDarkMode ? 'text-gray-400 hover:text-white hover:bg-[#232637]' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                {cat.icon && <span className="text-[11px]">{cat.icon}</span>}
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
            setShowChart({ marketId, outcome: (outcome as any) || 'HOME' })
          }}
          onLiveMarketIds={(ids) => setLiveMarketIds(new Set(ids))}
        />

        {/* Markets Grid — exclude markets already shown in the Live banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredMarkets.filter(m => !liveMarketIds.has(m.id)).map((market) => {
            const yesPercent = Math.round(market.yesPrice * 100)
            const noPercent = Math.round(market.noPrice * 100)
            const homePercent = market.isTri ? Math.round((market.homePrice ?? 0.4) * 100) : yesPercent
            const drawPercent = market.isTri ? Math.round((market.drawPrice ?? 0.25) * 100) : 0
            const awayPercent = market.isTri ? Math.round((market.awayPrice ?? 0.35) * 100) : noPercent
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
                  setShowChart({ marketId: market.id, outcome: market.isTri ? 'HOME' : 'YES' })
                }
              }}
            >
              {/* ── Match-style card for sports markets ── */}
              {!isYesNo && market.homeTeam && market.awayTeam ? (
                <div className="space-y-2.5 mb-3">
                  {/* Home team row */}
                  <div className="flex items-center gap-3">
                    {market.homeTeamCrest ? (
                      <img src={market.homeTeamCrest} alt="" className="w-6 h-6 object-contain flex-shrink-0" />
                    ) : (
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {market.homeTeam.charAt(0)}
                      </div>
                    )}
                    {market.isLive && market.liveHomeScore != null && (
                      <span className={`text-lg font-bold tabular-nums w-4 text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {market.liveHomeScore}
                      </span>
                    )}
                    <span className={`text-sm font-medium flex-1 truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {market.homeTeam}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ml-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {homePercent}%
                    </span>
                  </div>
                  {/* Draw row (for TRI_OUTCOME markets) */}
                  {market.isTri && (
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                      }`}>
                        =
                      </div>
                      <span className={`text-sm font-medium flex-1 truncate ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        Draw
                      </span>
                      <span className={`text-sm font-bold tabular-nums ml-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        {drawPercent}%
                      </span>
                    </div>
                  )}
                  {/* Away team row */}
                  <div className="flex items-center gap-3">
                    {market.awayTeamCrest ? (
                      <img src={market.awayTeamCrest} alt="" className="w-6 h-6 object-contain flex-shrink-0" />
                    ) : (
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {market.awayTeam.charAt(0)}
                      </div>
                    )}
                    {market.isLive && market.liveAwayScore != null && (
                      <span className={`text-lg font-bold tabular-nums w-4 text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {market.liveAwayScore}
                      </span>
                    )}
                    <span className={`text-sm font-medium flex-1 truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {market.awayTeam}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ml-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {awayPercent}%
                    </span>
                  </div>
                </div>
              ) : !isYesNo ? (
                /* Fallback match-winner without crest data */
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
              ) : (
                /* ── Yes/No card header ── */
                <>
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
                    {(() => {
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
                </>
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
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: market.isTri ? 'HOME' : 'YES' }) }}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20 hover:border-green-500/50 transition-all duration-200 truncate`}
                    >
                      {abbreviateTeam(market.optionA)} <span className="opacity-70">{formatPriceAsNgwee(market.homePrice ?? market.yesPrice)}</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: market.isTri ? 'DRAW' : 'YES' }) }}
                      className={`px-3 py-2.5 text-xs font-semibold rounded-lg ${subtleBg} ${textMuted} border ${cardBorder} hover:border-gray-400 transition-all duration-200`}
                      title={market.isTri ? 'Trade Draw outcome' : 'Draw results in market void — all traders are refunded'}
                    >
                      Draw {market.isTri ? formatPriceAsNgwee(market.drawPrice ?? 0.25) : ''}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChart({ marketId: market.id, outcome: market.isTri ? 'AWAY' : 'NO' }) }}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20 hover:border-green-500/50 transition-all duration-200 truncate`}
                    >
                      {abbreviateTeam(market.optionB)} <span className="opacity-70">{formatPriceAsNgwee(market.awayPrice ?? market.noPrice)}</span>
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
        {filteredMarkets.filter(m => !liveMarketIds.has(m.id)).length === 0 && !loading && (
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
        const price = (() => {
          if (market.isTri) {
            if (showChart.outcome === 'HOME') return market.homePrice ?? market.yesPrice
            if (showChart.outcome === 'DRAW') return market.drawPrice ?? 0.25
            if (showChart.outcome === 'AWAY') return market.awayPrice ?? market.noPrice
          }
          return showChart.outcome === 'YES' ? market.yesPrice : market.noPrice
        })()
        const amt = parseFloat(detailAmount) || 0
        const shares = tradeSide === 'BUY' ? (price > 0 ? (amt * 0.98) / price : 0) : amt
        const potentialReturn = tradeSide === 'BUY' ? (price > 0 ? amt * 0.98 / price : 0) : shares * price * 0.98
        const avgPriceDisplay = price
        // Abbreviate team name for moneyline buttons
        const abbrev = (name: string) => name.length > 10 ? name.substring(0, 8) + '…' : name
        // Ngwee price display (like Polymarket's cents)
        const ngweePrice = (p: number) => `${Math.round(p * 100)}n`
        // Match time display
        const matchTimeStr = market.resolveTime ? new Date(market.resolveTime).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : ''
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center sm:pt-6 px-0 sm:px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowChart(null)} />
            <div className={`relative ${modalBg} border ${modalBorder} rounded-t-2xl sm:rounded-xl w-full max-w-5xl max-h-[94vh] sm:max-h-[88vh] overflow-y-auto shadow-2xl`}>
              {/* Polymarket-style header: league tag + title + close */}
              <div className={`flex items-start gap-3 px-5 pt-4 pb-3 border-b ${modalBorder}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{market.league || market.category || 'Sports'}</span>
                    {market.status === 'ACTIVE' && <span className={`text-[11px] ${textMuted}`}>• Active</span>}
                  </div>
                  <h2 className={`text-lg font-bold ${textColor} leading-snug`}>{market.title || market.question}</h2>
                </div>
                <button onClick={() => setShowChart(null)} className={`${textMuted} hover:${textColor} p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-[#252840]' : 'hover:bg-gray-100'} transition-colors flex-shrink-0`}>
                  <span className="text-xl leading-none">×</span>
                </button>
              </div>

              <div className="flex flex-col lg:flex-row">
                {/* Left: Team header + Chart + Moneyline + Tabs */}
                <div className="flex-1 min-w-0">
                  {/* Polymarket-style team header with logos and match time */}
                  {market.isTri && market.homeTeam && market.awayTeam && (
                    <div className={`flex items-center justify-center gap-6 py-5 border-b ${modalBorder}`}>
                      {/* Home team */}
                      <div className="flex flex-col items-center gap-1.5">
                        {market.homeTeamCrest ? (
                          <img src={market.homeTeamCrest} alt="" className="w-12 h-12 object-contain" />
                        ) : (
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                            {market.homeTeam.charAt(0)}
                          </div>
                        )}
                        <span className={`text-sm font-semibold ${textColor}`}>{abbrev(market.homeTeam)}</span>
                      </div>
                      {/* Match time center */}
                      <div className="flex flex-col items-center">
                        <span className={`text-xs font-medium ${textColor}`}>{matchTimeStr.split(',')[0]}</span>
                        <span className={`text-[11px] ${textMuted}`}>{matchTimeStr.split(',')[1]?.trim() || ''}</span>
                      </div>
                      {/* Away team */}
                      <div className="flex flex-col items-center gap-1.5">
                        {market.awayTeamCrest ? (
                          <img src={market.awayTeamCrest} alt="" className="w-12 h-12 object-contain" />
                        ) : (
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                            {market.awayTeam.charAt(0)}
                          </div>
                        )}
                        <span className={`text-sm font-semibold ${textColor}`}>{abbrev(market.awayTeam)}</span>
                      </div>
                    </div>
                  )}

                  {/* Volume bar */}
                  <div className={`flex items-center gap-3 px-5 py-2 text-xs ${textMuted}`}>
                    <span>{formatVolume(market.volume)} Vol.</span>
                  </div>

                  {/* Chart area */}
                  <div className="px-5 pb-2">
                    {/* Price labels above chart for binary */}
                    {!market.isTri && (
                      <div className="flex items-center gap-4 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          <span className={`text-sm font-semibold ${textColor}`}>{market.optionA} {Math.round(market.yesPrice * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-400" />
                          <span className={`text-sm font-semibold ${textColor}`}>{market.optionB} {Math.round(market.noPrice * 100)}%</span>
                        </div>
                      </div>
                    )}
                    <PriceChart
                      marketId={market.id}
                      outcome={showChart.outcome}
                      currentPrice={price}
                      onClose={() => setShowChart(null)}
                      onBuy={(amount) => handleBuyFromDetail(market, showChart.outcome, amount)}
                      isTri={market.isTri}
                      homeTeam={market.homeTeam}
                      awayTeam={market.awayTeam}
                      homePrice={market.homePrice ?? market.yesPrice}
                      drawPrice={market.drawPrice ?? 0.28}
                      awayPrice={market.awayPrice ?? market.noPrice}
                    />
                  </div>

                  {/* Moneyline bar — Polymarket style (below chart) */}
                  {market.isTri && (
                    <div className={`mx-5 mb-4 p-3 rounded-xl border ${modalBorder} ${isDarkMode ? 'bg-[#171924]' : 'bg-gray-50'}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`text-sm font-bold ${textColor}`}>Moneyline</span>
                        <span className={`text-xs ${textMuted}`}>{formatVolume(market.volume)} Vol.</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowChart({ marketId: market.id, outcome: 'HOME' })}
                          className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            showChart.outcome === 'HOME'
                              ? 'bg-green-500 text-white shadow-md'
                              : `${inputBg} ${textColor} border ${modalBorder} hover:border-green-500/50`
                          }`}
                        >
                          {abbrev(market.homeTeam)} {ngweePrice(market.homePrice ?? market.yesPrice)}
                        </button>
                        <button
                          onClick={() => setShowChart({ marketId: market.id, outcome: 'DRAW' })}
                          className={`px-4 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            showChart.outcome === 'DRAW'
                              ? `${isDarkMode ? 'bg-gray-500' : 'bg-gray-600'} text-white shadow-md`
                              : `${inputBg} ${textColor} border ${modalBorder} hover:border-gray-400`
                          }`}
                        >
                          DRAW {ngweePrice(market.drawPrice ?? 0.25)}
                        </button>
                        <button
                          onClick={() => setShowChart({ marketId: market.id, outcome: 'AWAY' })}
                          className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            showChart.outcome === 'AWAY'
                              ? 'bg-blue-500 text-white shadow-md'
                              : `${inputBg} ${textColor} border ${modalBorder} hover:border-blue-500/50`
                          }`}
                        >
                          {abbrev(market.awayTeam)} {ngweePrice(market.awayPrice ?? market.noPrice)}
                        </button>
                      </div>
                    </div>
                  )}

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
                                          <span className={`text-[10px] ${textMuted}`}>avg {formatPriceAsNgwee(p.avgPrice)}</span>
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
                                          <span className={`text-[10px] ${textMuted}`}>avg {formatPriceAsNgwee(p.avgPrice)}</span>
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
                <div className={`w-full lg:w-[300px] border-t lg:border-t-0 lg:border-l ${modalBorder} flex-shrink-0`}>
                  {/* Outcome header tabs — like Polymarket "ATM 1 vs BRU" with Draw */}
                  {market.isTri ? (
                    <div className={`flex items-center border-b ${modalBorder}`}>
                      {[
                        { key: 'HOME', label: abbrev(market.homeTeam) },
                        { key: 'DRAW', label: 'Draw' },
                        { key: 'AWAY', label: abbrev(market.awayTeam) },
                      ].map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setShowChart({ ...showChart, outcome: tab.key as any })}
                          className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 ${
                            showChart.outcome === tab.key
                              ? isDarkMode ? 'border-white text-white' : 'border-gray-900 text-gray-900'
                              : `border-transparent ${textMuted} hover:${textColor}`
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={`flex items-center border-b ${modalBorder}`}>
                      {[
                        { key: 'YES', label: isYesNo ? 'Yes' : market.optionA },
                        { key: 'NO', label: isYesNo ? 'No' : market.optionB },
                      ].map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setShowChart({ ...showChart, outcome: tab.key as any })}
                          className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 ${
                            showChart.outcome === tab.key
                              ? isDarkMode ? 'border-white text-white' : 'border-gray-900 text-gray-900'
                              : `border-transparent ${textMuted} hover:${textColor}`
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="p-4">
                    {/* Buy / Sell toggle */}
                    <div className="flex items-center gap-2 mb-4">
                      <button
                        onClick={() => { setTradeSide('BUY'); setDetailAmount('') }}
                        className={`text-sm font-semibold pb-1 transition-colors ${
                          tradeSide === 'BUY'
                            ? `${textColor} border-b-2 ${isDarkMode ? 'border-white' : 'border-gray-900'}`
                            : `${textMuted} border-b-2 border-transparent hover:${textColor}`
                        }`}
                      >
                        Buy
                      </button>
                      <button
                        onClick={() => { setTradeSide('SELL'); setDetailAmount('') }}
                        className={`text-sm font-semibold pb-1 transition-colors ${
                          tradeSide === 'SELL'
                            ? `${textColor} border-b-2 ${isDarkMode ? 'border-white' : 'border-gray-900'}`
                            : `${textMuted} border-b-2 border-transparent hover:${textColor}`
                        }`}
                      >
                        Sell
                      </button>
                      <div className="ml-auto flex gap-1">
                        <button
                          onClick={() => setOrderType('LIMIT')}
                          className={`text-xs px-2 py-1 rounded transition-colors ${
                            orderType === 'LIMIT'
                              ? 'bg-blue-600 text-white'
                              : `${inputBg} ${textMuted} border ${modalBorder}`
                          }`}
                        >
                          Limit
                        </button>
                        <button
                          onClick={() => setOrderType('MARKET')}
                          className={`text-xs px-2 py-1 rounded transition-colors ${
                            orderType === 'MARKET'
                              ? 'bg-blue-600 text-white'
                              : `${inputBg} ${textMuted} border ${modalBorder}`
                          }`}
                        >
                          Market
                        </button>
                      </div>
                    </div>

                    {/* Limit price input (only for LIMIT orders) */}
                    {orderType === 'LIMIT' && (
                      <div className="mb-3">
                        <label className={`text-xs ${textMuted} mb-1 block`}>Price (1n–99n)</label>
                        <div className={`flex items-center rounded-lg border ${modalBorder} ${inputBg} px-3 py-2`}>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="0.99"
                            value={limitPrice}
                            onChange={(e) => setLimitPrice(e.target.value)}
                            placeholder={`${(price * 100).toFixed(0)}n`}
                            className={`flex-1 bg-transparent outline-none text-sm ${textColor}`}
                          />
                          <span className={`text-xs ${textMuted} ml-1`}>n per share</span>
                        </div>
                      </div>
                    )}

                    {/* Outcome price buttons */}
                    {market.isTri ? (
                      /* 3-outcome: show selected outcome price as the Buy target */
                      <div className={`flex items-center justify-between mb-4 p-3 rounded-lg ${inputBg} border ${modalBorder}`}>
                        <span className={`text-sm font-semibold ${textColor}`}>
                          {showChart.outcome === 'HOME' ? market.homeTeam : showChart.outcome === 'AWAY' ? market.awayTeam : 'Draw'}
                        </span>
                        <span className={`text-lg font-bold ${textColor}`}>
                          {ngweePrice(price)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={() => setShowChart({ ...showChart, outcome: 'YES' })}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                            showChart.outcome === 'YES'
                              ? 'bg-green-500 text-white'
                              : `${inputBg} ${textMuted} border ${modalBorder}`
                          }`}
                        >
                          Yes {ngweePrice(market.yesPrice)}
                        </button>
                        <button
                          onClick={() => setShowChart({ ...showChart, outcome: 'NO' })}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                            showChart.outcome === 'NO'
                              ? 'bg-red-500 text-white'
                              : `${inputBg} ${textMuted} border ${modalBorder}`
                          }`}
                        >
                          No {ngweePrice(market.noPrice)}
                        </button>
                      </div>
                    )}

                    {/* Amount input */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-sm font-medium ${textColor}`}>{tradeSide === 'BUY' ? 'Amount' : 'Shares'}</span>
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          value={detailAmount}
                          onChange={(e) => setDetailAmount(e.target.value)}
                          placeholder="K0"
                          className={`w-full pl-3 pr-3 py-3 text-right text-2xl font-bold ${inputBg} border ${modalBorder} rounded-lg ${textColor} focus:outline-none focus:border-green-500`}
                        />
                      </div>
                    </div>

                    {/* Quick-add buttons */}
                    <div className="flex gap-1.5 mb-4">
                      {(tradeSide === 'BUY' ? [1, 5, 10, 100] : [10, 50, 100, 500]).map(val => (
                        <button
                          key={val}
                          onClick={() => setDetailAmount(prev => String((parseFloat(prev) || 0) + val))}
                          className={`flex-1 py-1.5 text-xs font-medium ${inputBg} border ${modalBorder} rounded-md ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} hover:border-green-500/50 transition-colors`}
                        >
                          +K{val}
                        </button>
                      ))}
                      <button
                        onClick={() => setDetailAmount(tradeSide === 'BUY' ? String(Math.floor(userBalance)) : 'Max')}
                        className={`px-2 py-1.5 text-xs font-medium ${inputBg} border ${modalBorder} rounded-md ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} hover:border-green-500/50 transition-colors`}
                      >
                        Max
                      </button>
                    </div>

                    {/* Trade button */}
                    <button
                      onClick={() => {
                        if (!isLoggedIn && !isOnChain) { signIn(); return }
                        if (amt <= 0) return
                        if (tradeSide === 'BUY') {
                          handleBuyFromDetail(market, showChart.outcome, amt)
                        } else {
                          handleSellFromDetail(market, showChart.outcome, amt)
                        }
                      }}
                      disabled={placingBets || onChainLoading || amt <= 0 || (tradeSide === 'BUY' && !isOnChain && amt > userBalance) || (tradeSide === 'BUY' && isOnChain && amt > tokenBalance)}
                      className={`w-full py-3.5 text-base font-bold rounded-xl transition-colors disabled:opacity-50 ${
                        tradeSide === 'SELL'
                          ? 'bg-red-500 hover:bg-red-600 text-white'
                          : 'bg-green-500 hover:bg-green-600 text-white'
                      }`}
                    >
                      {placingBets || onChainLoading ? 'Processing...' : !isLoggedIn && !isOnChain ? 'Sign In to Trade' : `${tradeSide === 'BUY' ? 'Buy' : 'Sell'} ${orderType === 'LIMIT' ? '(Limit)' : '(Market)'}`}
                    </button>

                    {/* To Win / Proceeds */}
                    {amt > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {tradeSide === 'BUY' ? (
                          <>
                            <div className="flex items-center justify-between text-xs">
                              <span className={textMuted}>Avg. Price</span>
                              <span className={textColor}>{ngweePrice(avgPriceDisplay)}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className={textMuted}>Shares</span>
                              <span className={textColor}>{shares.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className={textMuted}>Potential return</span>
                              <span className="text-green-500 font-semibold">{formatZambianCurrency(potentialReturn)} ({((potentialReturn / (amt || 1) - 1) * 100).toFixed(0)}%)</span>
                            </div>
                            {amt > userBalance && !isOnChain && (
                              <div className="text-xs text-red-500 mt-1">Insufficient balance ({formatZambianCurrency(userBalance)})</div>
                            )}
                          </>
                        ) : (
                          <div className="flex items-center justify-between text-xs">
                            <span className={textMuted}>Est. proceeds</span>
                            <span className="text-green-500 font-semibold">{formatZambianCurrency(potentialReturn)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {error && (
                      <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                        {error}
                      </div>
                    )}

                    <p className={`text-[10px] ${textMuted} text-center mt-3`}>
                      By trading, you agree to the <a href="/terms" className="underline hover:text-green-500 transition-colors">Terms of Use</a>.
                    </p>
                  </div>
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
              <button onClick={() => setShowHowItWorks(true)} className={`hover:${textColor} transition-colors font-medium`}>How it Works</button>
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

      {/* How It Works Modal */}
      <HowItWorksModal
        isOpen={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
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
