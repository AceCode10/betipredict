'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { 
  Bell, 
  ChevronDown, 
  Settings, 
  Moon, 
  Sun, 
  Trophy, 
  Gift, 
  Code, 
  HelpCircle, 
  FileText, 
  LogOut,
  User,
  Wallet,
  Search,
  X
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { formatZambianCurrency } from '@/utils/currency'
import { DepositModal } from './DepositModal'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
}

export function Header() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isDarkMode, toggleDarkMode } = useTheme()
  
  const [balance, setBalance] = useState(0)
  const [portfolioValue, setPortfolioValue] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [showDeposit, setShowDeposit] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  const notifRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  // Fetch user data
  useEffect(() => {
    if (session?.user?.id) {
      fetchUserData()
      fetchNotifications()
    }
  }, [session?.user?.id])

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchUserData = async () => {
    try {
      const [balanceRes, positionsRes] = await Promise.all([
        fetch('/api/user/balance'),
        fetch('/api/user/positions')
      ])
      
      if (balanceRes.ok) {
        const data = await balanceRes.json()
        setBalance(data.balance || 0)
      }
      
      if (positionsRes.ok) {
        const data = await positionsRes.json()
        // Calculate portfolio value from positions
        const totalValue = (data.positions || []).reduce((sum: number, pos: any) => {
          return sum + (pos.size * (pos.outcome === 'YES' ? pos.market?.yesPrice : pos.market?.noPrice) || 0)
        }, 0)
        setPortfolioValue(totalValue)
      }
    } catch (error) {
      console.error('Error fetching user data:', error)
    }
  }

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications?limit=10')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch (error) {
      console.error('Error fetching notifications:', error)
    }
  }

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true })
      })
      setUnreadCount(0)
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    } catch (error) {
      console.error('Error marking notifications as read:', error)
    }
  }

  const handleDeposit = async (amount: number) => {
    try {
      const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      })
      if (res.ok) {
        fetchUserData()
      }
    } catch (error) {
      console.error('Error depositing:', error)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/?search=${encodeURIComponent(searchQuery.trim())}`)
      setShowMobileSearch(false)
    }
  }

  const bgColor = isDarkMode ? 'bg-[#131722]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-800' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const hoverBg = isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-100'

  return (
    <>
      <header className={`sticky top-0 z-50 ${bgColor} border-b ${borderColor}`}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <button 
                onClick={() => router.push('/')}
                className={`text-xl font-bold ${textColor} flex items-center gap-2`}
              >
                <span className="text-green-500">B</span>etiPredict
              </button>

              {/* Desktop Search */}
              <form onSubmit={handleSearch} className="hidden md:flex items-center">
                <div className={`flex items-center ${isDarkMode ? 'bg-[#1e2130]' : 'bg-gray-100'} rounded-lg px-3 py-1.5`}>
                  <Search className={`w-4 h-4 ${textMuted}`} />
                  <input
                    type="text"
                    placeholder="Search markets..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`bg-transparent border-none outline-none text-sm ${textColor} placeholder:${textMuted} ml-2 w-48`}
                  />
                </div>
              </form>
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-2 md:gap-4">
              {/* Mobile Search Toggle */}
              <button
                onClick={() => setShowMobileSearch(!showMobileSearch)}
                className={`md:hidden p-2 rounded-lg ${hoverBg} ${textMuted}`}
              >
                {showMobileSearch ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
              </button>

              {status === 'authenticated' && session?.user ? (
                <>
                  {/* Portfolio & Cash - Desktop */}
                  <div className="hidden md:flex items-center gap-4 mr-2">
                    <div className="text-right">
                      <div className={`text-[10px] uppercase ${textMuted}`}>Portfolio</div>
                      <div className={`text-sm font-medium ${textColor}`}>
                        {formatZambianCurrency(portfolioValue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[10px] uppercase ${textMuted}`}>Cash</div>
                      <div className={`text-sm font-medium text-green-500`}>
                        {formatZambianCurrency(balance)}
                      </div>
                    </div>
                  </div>

                  {/* Deposit Button */}
                  <button
                    onClick={() => setShowDeposit(true)}
                    className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Deposit
                  </button>

                  {/* Notifications */}
                  <div ref={notifRef} className="relative">
                    <button
                      onClick={() => setShowNotifications(!showNotifications)}
                      className={`p-2 rounded-lg ${hoverBg} ${textMuted} relative`}
                    >
                      <Bell className="w-5 h-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </button>

                    {/* Notifications Dropdown */}
                    {showNotifications && (
                      <div className={`absolute right-0 mt-2 w-80 ${bgColor} border ${borderColor} rounded-lg shadow-xl overflow-hidden`}>
                        <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
                          <span className={`font-medium ${textColor}`}>Notifications</span>
                          {unreadCount > 0 && (
                            <button 
                              onClick={markAllRead}
                              className="text-xs text-green-500 hover:underline"
                            >
                              Mark all read
                            </button>
                          )}
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                          {notifications.length === 0 ? (
                            <div className={`px-4 py-8 text-center ${textMuted}`}>
                              No notifications yet
                            </div>
                          ) : (
                            notifications.map(notif => (
                              <div 
                                key={notif.id}
                                className={`px-4 py-3 ${hoverBg} cursor-pointer ${!notif.isRead ? (isDarkMode ? 'bg-[#1e2130]' : 'bg-blue-50') : ''}`}
                              >
                                <div className={`text-sm font-medium ${textColor}`}>{notif.title}</div>
                                <div className={`text-xs ${textMuted} mt-0.5`}>{notif.message}</div>
                                <div className={`text-[10px] ${textMuted} mt-1`}>
                                  {new Date(notif.createdAt).toLocaleDateString()}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Account Menu */}
                  <div ref={accountRef} className="relative">
                    <button
                      onClick={() => setShowAccountMenu(!showAccountMenu)}
                      className={`flex items-center gap-1 p-1.5 rounded-lg ${hoverBg}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white text-sm font-medium">
                        {session.user.name?.[0]?.toUpperCase() || 'U'}
                      </div>
                      <ChevronDown className={`w-4 h-4 ${textMuted} hidden md:block`} />
                    </button>

                    {/* Account Dropdown */}
                    {showAccountMenu && (
                      <div className={`absolute right-0 mt-2 w-56 ${bgColor} border ${borderColor} rounded-lg shadow-xl overflow-hidden`}>
                        {/* User Info */}
                        <div className={`px-4 py-3 border-b ${borderColor}`}>
                          <div className={`font-medium ${textColor} truncate`}>
                            {session.user.name || session.user.email}
                          </div>
                          <div className={`text-xs ${textMuted} truncate`}>
                            {session.user.email}
                          </div>
                          {/* Mobile only: Portfolio & Cash */}
                          <div className="md:hidden flex gap-4 mt-2 pt-2 border-t border-gray-700">
                            <div>
                              <div className={`text-[10px] ${textMuted}`}>Portfolio</div>
                              <div className={`text-sm ${textColor}`}>{formatZambianCurrency(portfolioValue)}</div>
                            </div>
                            <div>
                              <div className={`text-[10px] ${textMuted}`}>Cash</div>
                              <div className="text-sm text-green-500">{formatZambianCurrency(balance)}</div>
                            </div>
                          </div>
                        </div>

                        {/* Menu Items */}
                        <div className="py-1">
                          <button
                            onClick={() => { router.push('/account'); setShowAccountMenu(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} ${textColor}`}
                          >
                            <Wallet className="w-4 h-4" />
                            <span className="text-sm">Account</span>
                          </button>
                          <button
                            onClick={() => { router.push('/account'); setShowAccountMenu(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} ${textColor}`}
                          >
                            <Trophy className="w-4 h-4" />
                            <span className="text-sm">Leaderboard</span>
                          </button>
                          <button
                            onClick={() => { router.push('/account'); setShowAccountMenu(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} ${textColor}`}
                          >
                            <Gift className="w-4 h-4" />
                            <span className="text-sm">Rewards</span>
                          </button>
                          <button
                            onClick={() => { setShowAccountMenu(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} ${textColor}`}
                          >
                            <Code className="w-4 h-4" />
                            <span className="text-sm">APIs</span>
                          </button>
                        </div>

                        {/* Dark Mode Toggle */}
                        <div className={`border-t ${borderColor}`}>
                          <button
                            onClick={toggleDarkMode}
                            className={`w-full flex items-center justify-between px-4 py-2 ${hoverBg} ${textColor}`}
                          >
                            <div className="flex items-center gap-3">
                              {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                              <span className="text-sm">Dark mode</span>
                            </div>
                            <div className={`w-10 h-5 rounded-full ${isDarkMode ? 'bg-green-500' : 'bg-gray-300'} relative transition-colors`}>
                              <div className={`absolute top-0.5 ${isDarkMode ? 'right-0.5' : 'left-0.5'} w-4 h-4 bg-white rounded-full shadow transition-all`} />
                            </div>
                          </button>
                        </div>

                        {/* More Options */}
                        <div className={`border-t ${borderColor} py-1`}>
                          <button
                            onClick={() => { setShowAccountMenu(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} ${textMuted}`}
                          >
                            <Settings className="w-4 h-4" />
                            <span className="text-sm">Settings</span>
                          </button>
                          <button
                            onClick={() => { setShowAccountMenu(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} ${textMuted}`}
                          >
                            <HelpCircle className="w-4 h-4" />
                            <span className="text-sm">Help Center</span>
                          </button>
                          <button
                            onClick={() => { setShowAccountMenu(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} ${textMuted}`}
                          >
                            <FileText className="w-4 h-4" />
                            <span className="text-sm">Terms of Use</span>
                          </button>
                        </div>

                        {/* Logout */}
                        <div className={`border-t ${borderColor}`}>
                          <button
                            onClick={() => signOut()}
                            className={`w-full flex items-center gap-3 px-4 py-2 ${hoverBg} text-red-500`}
                          >
                            <LogOut className="w-4 h-4" />
                            <span className="text-sm">Logout</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={() => router.push('/auth/signin')}
                    className={`px-4 py-1.5 ${hoverBg} ${textColor} text-sm font-medium rounded-lg transition-colors`}
                  >
                    Log In
                  </button>
                  <button
                    onClick={() => router.push('/auth/signin')}
                    className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Sign Up
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Search Bar */}
        {showMobileSearch && (
          <div className={`md:hidden border-t ${borderColor} px-4 py-2`}>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                placeholder="Search markets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`flex-1 px-3 py-2 ${isDarkMode ? 'bg-[#1e2130]' : 'bg-gray-100'} border-none rounded-lg text-sm ${textColor} outline-none`}
                autoFocus
              />
              <button
                type="submit"
                className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg"
              >
                Search
              </button>
            </form>
          </div>
        )}
      </header>

      {/* Deposit Modal */}
      <DepositModal
        isOpen={showDeposit}
        onClose={() => setShowDeposit(false)}
        onDeposit={handleDeposit}
        currentBalance={balance}
      />
    </>
  )
}
