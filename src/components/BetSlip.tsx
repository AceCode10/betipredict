'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { formatZambianCurrency, formatPriceAsNgwee } from '@/utils/currency'

interface BetItem {
  id: string
  marketId: string
  marketTitle: string
  outcome: 'YES' | 'NO'
  price: number
  amount: number // Kwacha to spend
}

interface BetSlipProps {
  bets: BetItem[]
  onUpdateBet: (id: string, amount: number) => void
  onRemoveBet: (id: string) => void
  onPlaceBets: () => void
  onClearAll: () => void
  isOpen: boolean
  onClose: () => void
  isPlacing?: boolean
  error?: string | null
  userBalance?: number
}

export function BetSlip({ 
  bets, 
  onUpdateBet, 
  onRemoveBet, 
  onPlaceBets, 
  onClearAll,
  isOpen,
  onClose,
  isPlacing = false,
  error = null,
  userBalance = 0
}: BetSlipProps) {
  // Total Kwacha to spend
  const totalSpend = bets.reduce((sum, bet) => sum + bet.amount, 0)
  // Potential return if all bets win: shares = amount / price, each share pays K1
  const totalPotentialReturn = bets.reduce((sum, bet) => {
    const shares = bet.price > 0 ? bet.amount / bet.price : 0
    return sum + shares
  }, 0)
  const totalProfit = totalPotentialReturn - totalSpend
  const insufficientBalance = totalSpend > userBalance

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      
      <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-[#1c2030] shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Bet Slip ({bets.length})</h2>
          <div className="flex items-center gap-2">
            {bets.length > 0 && (
              <button onClick={onClearAll} className="text-sm text-gray-400 hover:text-white">
                Clear All
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Bets List */}
        <div className="flex-1 overflow-y-auto">
          {bets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <div className="text-4xl mb-4">📝</div>
              <p className="text-lg font-medium mb-2 text-gray-300">Your bet slip is empty</p>
              <p className="text-sm text-center px-8">
                Click Yes or No on any market to add a bet
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {bets.map((bet) => (
                <BetItemCard
                  key={bet.id}
                  bet={bet}
                  onUpdateAmount={(amount) => onUpdateBet(bet.id, amount)}
                  onRemove={() => onRemoveBet(bet.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {bets.length > 0 && (
          <div className="border-t border-gray-700 p-4 space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Total Stake:</span>
                <span className="font-medium text-white">{formatZambianCurrency(totalSpend)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Potential Return:</span>
                <span className="font-medium text-green-400">{formatZambianCurrency(totalPotentialReturn)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-gray-300">Potential Profit:</span>
                <span className={totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {totalProfit >= 0 ? '+' : ''}{formatZambianCurrency(totalProfit)}
                </span>
              </div>
            </div>

            {insufficientBalance && (
              <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                Insufficient balance. You have {formatZambianCurrency(userBalance)} but need {formatZambianCurrency(totalSpend)}.
              </div>
            )}

            {error && (
              <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              onClick={onPlaceBets}
              disabled={isPlacing || totalSpend <= 0 || insufficientBalance}
              className="w-full py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {isPlacing ? 'Placing Bets...' : `Place ${bets.length} Bet${bets.length > 1 ? 's' : ''} — ${formatZambianCurrency(totalSpend)}`}
            </button>

            <p className="text-[10px] text-gray-600 text-center">
              By trading, you agree to the Terms of Use.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

interface BetItemCardProps {
  bet: BetItem
  onUpdateAmount: (amount: number) => void
  onRemove: () => void
}

function BetItemCard({ bet, onUpdateAmount, onRemove }: BetItemCardProps) {
  const [inputValue, setInputValue] = useState(bet.amount > 0 ? bet.amount.toString() : '')

  useEffect(() => {
    if (bet.amount > 0) setInputValue(bet.amount.toString())
  }, [bet.amount])

  const handleAmountChange = (value: string) => {
    setInputValue(value)
    const num = parseFloat(value)
    if (!isNaN(num) && num >= 0) {
      onUpdateAmount(num)
    }
  }

  const handleQuickAdd = (addAmount: number) => {
    const newAmount = bet.amount + addAmount
    if (newAmount >= 0) {
      onUpdateAmount(newAmount)
      setInputValue(newAmount.toString())
    }
  }

  // Potential return: shares = kwacha / price, each winning share = K1
  const potentialReturn = bet.price > 0 ? bet.amount / bet.price : 0

  return (
    <div className="bg-[#232637] rounded-lg p-3 border border-gray-700">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
              bet.outcome === 'YES' 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-red-500/20 text-red-400'
            }`}>
              {bet.outcome} {formatPriceAsNgwee(bet.price)}
            </span>
          </div>
          <p className="text-xs text-gray-300 line-clamp-2">{bet.marketTitle}</p>
        </div>
        <button onClick={onRemove} className="p-1 hover:bg-gray-600 rounded ml-2">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Kwacha Amount Input */}
      <div className="mb-2">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">K</span>
          <input
            type="number"
            value={inputValue}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="0"
            min="1"
            step="1"
            className="w-full pl-7 pr-3 py-2 text-right text-sm font-bold bg-[#1c2030] border border-gray-600 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-green-500"
          />
        </div>
      </div>

      {/* Quick Kwacha Amounts */}
      <div className="flex gap-1 mb-2">
        {[10, 50, 100, 500].map(amt => (
          <button
            key={amt}
            onClick={() => handleQuickAdd(amt)}
            className="flex-1 py-1 text-[10px] font-medium bg-[#1c2030] border border-gray-700 rounded text-gray-400 hover:border-gray-500 hover:text-white transition-colors"
          >
            +K{amt}
          </button>
        ))}
      </div>

      {/* Potential Return */}
      {bet.amount > 0 && (
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">To win</span>
          <span className="text-green-400 font-semibold">{formatZambianCurrency(potentialReturn)}</span>
        </div>
      )}
    </div>
  )
}
