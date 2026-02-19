'use client'

import { useRouter, usePathname } from 'next/navigation'
import { 
  Home, 
  Search, 
  TrendingUp, 
  Menu,
  Plus
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface BottomNavigationProps {
  onOpenSearch?: () => void
  onCreateMarket?: () => void
  betSlipCount?: number
  onOpenBetSlip?: () => void
}

export function BottomNavigation({ 
  onOpenSearch, 
  onCreateMarket, 
  betSlipCount = 0, 
  onOpenBetSlip 
}: BottomNavigationProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isDarkMode } = useTheme()

  const bgColor = isDarkMode ? 'bg-[#131722] border-gray-800' : 'bg-white border-gray-200'
  const textColor = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const activeColor = 'text-green-500'
  const hoverBg = isDarkMode ? 'hover:bg-[#1e2130]' : 'hover:bg-gray-100'

  const navItems = [
    {
      icon: Home,
      label: 'Home',
      href: '/',
      active: pathname === '/'
    },
    {
      icon: Search,
      label: 'Search',
      onClick: onOpenSearch,
      active: false
    },
    {
      icon: Plus,
      label: 'Create',
      onClick: onCreateMarket,
      active: false
    },
    {
      icon: TrendingUp,
      label: 'Breaking',
      href: '/breaking',
      active: pathname === '/breaking'
    },
    {
      icon: Menu,
      label: 'More',
      href: '/more',
      active: pathname === '/more'
    }
  ]

  return (
    <nav className={`md:hidden fixed bottom-0 left-0 right-0 ${bgColor} border-t z-50`}>
      <div className="flex items-center justify-around h-16">
        {navItems.map((item, index) => {
          const Icon = item.icon
          const isActive = item.active
          
          return (
            <button
              key={index}
              onClick={() => {
                if (item.onClick) {
                  item.onClick()
                } else if (item.href) {
                  router.push(item.href)
                }
              }}
              className={`flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-colors ${
                isActive ? activeColor : textColor
              } ${hoverBg} relative`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{item.label}</span>
              
              {/* Badge for bet slip if needed */}
              {item.label === 'More' && betSlipCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                  {betSlipCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
