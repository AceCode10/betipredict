'use client'

import { useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useWallet, WalletConnectButton } from '@/components/WalletConnect'
import { Button } from '@/components/ui/button'
import { 
  TrendingUp, 
  Plus, 
  LogOut,
  Menu,
  X
} from 'lucide-react'

interface NavigationProps {
  currentView: 'markets' | 'dashboard'
  onViewChange: (view: 'markets' | 'dashboard') => void
  onDeposit: () => void
}

export function Navigation({ currentView, onViewChange, onDeposit }: NavigationProps) {
  const { data: session } = useSession()
  const { isConnected, account } = useWallet()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  return (
    <>
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo and Navigation */}
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-8 h-8 text-blue-600" />
                <h1 className="text-xl font-bold">BetiPredict</h1>
              </div>
              
              {/* Desktop Navigation */}
              <nav className="hidden md:flex items-center gap-6">
                <button
                  onClick={() => onViewChange('markets')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === 'markets' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Markets
                </button>
                {isConnected && (
                  <button
                    onClick={() => onViewChange('dashboard')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      currentView === 'dashboard' 
                        ? 'bg-blue-100 text-blue-700' 
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Dashboard
                  </button>
                )}
              </nav>
            </div>

            {/* Right side actions */}
            <div className="flex items-center gap-4">
              {/* Desktop Actions */}
              <div className="hidden md:flex items-center gap-4">
                {isConnected && currentView === 'markets' && (
                  <Button onClick={onDeposit} className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Deposit
                  </Button>
                )}
                <WalletConnectButton />
                {session && (
                  <button
                    onClick={() => signOut()}
                    className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-800"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                )}
              </div>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-white">
            <div className="px-4 py-3 space-y-3">
              <button
                onClick={() => {
                  onViewChange('markets')
                  setMobileMenuOpen(false)
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${
                  currentView === 'markets' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'text-gray-600'
                }`}
              >
                Markets
              </button>
              {isConnected && (
                <button
                  onClick={() => {
                    onViewChange('dashboard')
                    setMobileMenuOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${
                    currentView === 'dashboard' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'text-gray-600'
                  }`}
                >
                  Dashboard
                </button>
              )}
              {isConnected && currentView === 'markets' && (
                <Button 
                  onClick={() => {
                    onDeposit()
                    setMobileMenuOpen(false)
                  }} 
                  className="w-full"
                >
                  Deposit
                </Button>
              )}
              {session && (
                <button
                  onClick={() => {
                    signOut()
                    setMobileMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-gray-600"
                >
                  Sign Out
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* User Info Bar (when connected) */}
      {isConnected && (
        <div className="bg-blue-50 border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <span className="text-blue-800">
                  Connected: {formatAddress(account!)}
                </span>
                <span className="text-blue-600">
                  • Test Network
                </span>
              </div>
              {session && (
                <span className="text-blue-600">
                  Signed in as {session.user?.username || session.user?.email}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
