'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
  onDeposit: (amount: number) => Promise<void>
  currentBalance: number
}

export function DepositModal({ isOpen, onClose, onDeposit, currentBalance }: DepositModalProps) {
  const [amount, setAmount] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  if (!isOpen) return null

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount)
    if (!depositAmount || depositAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }
    if (depositAmount > 1000000) {
      setError('Maximum deposit is K1,000,000')
      return
    }

    setError('')
    setSuccess('')
    setIsProcessing(true)

    try {
      await onDeposit(depositAmount)
      setSuccess(`Successfully deposited ${formatZambianCurrency(depositAmount)}`)
      setAmount('')
      setTimeout(() => {
        setSuccess('')
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Deposit failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const quickAmounts = [10, 50, 100, 500, 1000, 5000]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#1c2030] border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Deposit Funds</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Current Balance */}
          <div className="bg-[#232637] rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">Current Balance</div>
            <div className="text-xl font-bold text-white">{formatZambianCurrency(currentBalance)}</div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Deposit Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg font-medium">K</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError('') }}
                placeholder="0.00"
                className="w-full pl-8 pr-3 py-3 text-right text-2xl font-bold bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-green-500"
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {/* Quick Amount Buttons */}
          <div className="grid grid-cols-3 gap-2">
            {quickAmounts.map(amt => (
              <button
                key={amt}
                onClick={() => { setAmount(amt.toString()); setError('') }}
                className="py-2 text-sm font-medium bg-[#232637] border border-gray-700 rounded-lg text-gray-300 hover:border-green-500/50 hover:text-white transition-colors"
              >
                K{amt.toLocaleString()}
              </button>
            ))}
          </div>

          {/* Error / Success Messages */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm text-green-400">
              {success}
            </div>
          )}

          {/* New Balance Preview */}
          {amount && parseFloat(amount) > 0 && (
            <div className="bg-[#232637] rounded-lg p-3 flex justify-between items-center">
              <span className="text-xs text-gray-400">New Balance</span>
              <span className="text-sm font-semibold text-green-400">
                {formatZambianCurrency(currentBalance + parseFloat(amount))}
              </span>
            </div>
          )}

          {/* Deposit Button */}
          <button
            onClick={handleDeposit}
            disabled={isProcessing || !amount || parseFloat(amount) <= 0}
            className="w-full py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Deposit'}
          </button>

          <p className="text-[10px] text-gray-600 text-center">
            Deposits are processed instantly. By depositing, you agree to the Terms of Use.
          </p>
        </div>
      </div>
    </div>
  )
}
