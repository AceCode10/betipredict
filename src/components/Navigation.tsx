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
      <header className="bg-[var(--surface)] border-b border-slate-200/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo and Navigation */}
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-teal-500/10 text-teal-700 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-semibold">BetiPredict</h1>
              </div>
              
              {/* Desktop Navigation */}
              <nav className="hidden md:flex items-center gap-6">
                <button
                  onClick={() => onViewChange('markets')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === 'markets' 
                      ? 'bg-slate-900 text-white' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Markets
                </button>
                {isConnected && (
                  <button
                    onClick={() => onViewChange('dashboard')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      currentView === 'dashboard' 
                        ? 'bg-slate-900 text-white' 
                        : 'text-slate-600 hover:text-slate-900'
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
                    className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-slate-900"
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
          <div className="md:hidden border-t border-slate-200 bg-white">
            <div className="px-4 py-3 space-y-3">
              <button
                onClick={() => {
                  onViewChange('markets')
                  setMobileMenuOpen(false)
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${
                  currentView === 'markets' 
                    ? 'bg-slate-900 text-white' 
                    : 'text-slate-600'
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
                      ? 'bg-slate-900 text-white' 
                      : 'text-slate-600'
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
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600"
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
        <div className="bg-teal-500/5 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <span className="text-slate-700">
                  Connected: {formatAddress(account!)}
                </span>
                <span className="text-teal-700">
                  • Test Network
                </span>
              </div>
              {session && (
                <span className="text-slate-600">
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
