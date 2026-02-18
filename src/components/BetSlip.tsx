'use client'

import { useState } from 'react'
import { X, Plus, Minus } from 'lucide-react'
import { formatZambianCurrency, formatPriceAsNgwee } from '@/utils/currency'

interface BetItem {
  id: string
  marketId: string
  marketTitle: string
  outcome: 'YES' | 'NO'
  price: number
  amount: number
}

interface BetSlipProps {
  bets: BetItem[]
  onUpdateBet: (id: string, amount: number) => void
  onRemoveBet: (id: string) => void
  onPlaceBets: () => void
  onClearAll: () => void
  isOpen: boolean
  onClose: () => void
}

export function BetSlip({ 
  bets, 
  onUpdateBet, 
  onRemoveBet, 
  onPlaceBets, 
  onClearAll,
  isOpen,
  onClose 
}: BetSlipProps) {
  const [isPlacing, setIsPlacing] = useState(false)

  const totalCost = bets.reduce((sum, bet) => sum + (bet.amount * bet.price), 0)
  const totalPotentialReturn = bets.reduce((sum, bet) => sum + bet.amount, 0)

  const handlePlaceBets = async () => {
    if (bets.length === 0) return
    
    setIsPlacing(true)
    try {
      await new Promise(resolve => setTimeout(resolve, 2000)) // Simulate API call
      onPlaceBets()
    } finally {
      setIsPlacing(false)
    }
  }

  const updateBetAmount = (id: string, newAmount: number) => {
    if (newAmount >= 0) {
      onUpdateBet(id, newAmount)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      
      {/* Sliding panel */}
      <div className="absolute right-0 top-0 h-full w-96 bg-[#1c2030] shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Bet Slip</h2>
          <div className="flex items-center gap-2">
            {bets.length > 0 && (
              <button
                onClick={onClearAll}
                className="text-sm text-gray-400 hover:text-white"
              >
                Clear All
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-700 rounded"
            >
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
                  onUpdateAmount={(amount) => updateBetAmount(bet.id, amount)}
                  onRemove={() => onRemoveBet(bet.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {bets.length > 0 && (
          <div className="border-t border-gray-700 p-4 space-y-3">
            {/* Summary */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Total Cost:</span>
                <span className="font-medium text-white">{formatZambianCurrency(totalCost)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Potential Return:</span>
                <span className="font-medium text-white">{formatZambianCurrency(totalPotentialReturn)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-gray-300">Net Profit:</span>
                <span className={totalPotentialReturn - totalCost >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatZambianCurrency(totalPotentialReturn - totalCost)}
                </span>
              </div>
            </div>

            {/* Place Bets Button */}
            <button
              onClick={handlePlaceBets}
              disabled={isPlacing || totalCost <= 0}
              className="w-full py-3 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {isPlacing ? 'Placing Bets...' : `Place ${bets.length} Bet${bets.length > 1 ? 's' : ''}`}
            </button>

            {/* Disclaimer */}
            <p className="text-xs text-gray-500 text-center">
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
  const [isEditing, setIsEditing] = useState(false)
  const [tempAmount, setTempAmount] = useState(bet.amount.toString())

  const handleSaveAmount = () => {
    const newAmount = parseFloat(tempAmount)
    if (!isNaN(newAmount) && newAmount >= 0) {
      onUpdateAmount(newAmount)
    } else {
      setTempAmount(bet.amount.toString())
    }
    setIsEditing(false)
  }

  const handleQuickAmount = (amount: number) => {
    onUpdateAmount(bet.amount + amount)
  }

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
              {bet.outcome}
            </span>
            <span className="text-sm font-semibold">
              {formatPriceAsNgwee(bet.price)}
            </span>
          </div>
          <p className="text-sm text-gray-300 line-clamp-2">
            {bet.marketTitle}
          </p>
        </div>
        <button
          onClick={onRemove}
          className="p-1 hover:bg-gray-600 rounded ml-2"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Amount Controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-gray-600 rounded-lg bg-[#1c2030]">
          <button
            onClick={() => handleQuickAmount(-1)}
            className="p-1.5 hover:bg-gray-600 rounded-l-lg text-gray-400"
          >
            <Minus className="w-3 h-3" />
          </button>
          
          {isEditing ? (
            <input
              type="number"
              value={tempAmount}
              onChange={(e) => setTempAmount(e.target.value)}
              onBlur={handleSaveAmount}
              onKeyPress={(e) => e.key === 'Enter' && handleSaveAmount()}
              className="w-16 px-2 py-1 text-center text-sm border-0 focus:outline-none bg-transparent text-white"
              autoFocus
            />
          ) : (
            <div
              onClick={() => setIsEditing(true)}
              className="w-16 px-2 py-1 text-center text-sm cursor-pointer text-white"
            >
              {bet.amount}
            </div>
          )}
          
          <button
            onClick={() => handleQuickAmount(1)}
            className="p-1.5 hover:bg-gray-600 rounded-r-lg text-gray-400"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        
        <div className="flex-1 text-right">
          <div className="text-xs text-gray-400">Cost</div>
          <div className="text-sm font-medium text-white">
            {formatZambianCurrency(bet.amount * bet.price)}
          </div>
        </div>
      </div>
    </div>
  )
}
