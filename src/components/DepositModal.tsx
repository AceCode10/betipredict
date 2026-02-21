'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Smartphone, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

type DepositStep = 'input' | 'processing' | 'success' | 'failed'

interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
  onDeposit: (amount: number, phoneNumber?: string) => Promise<void>
  currentBalance: number
}

export function DepositModal({ isOpen, onClose, onDeposit, currentBalance }: DepositModalProps) {
  const [amount, setAmount] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [step, setStep] = useState<DepositStep>('input')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up polling on unmount or close
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const resetState = useCallback(() => {
    setStep('input')
    setIsProcessing(false)
    setError('')
    setSuccess('')
    setPaymentId(null)
    setStatusMessage('')
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  if (!isOpen) return null

  const handleClose = () => {
    resetState()
    onClose()
  }

  const pollPaymentStatus = (pId: string) => {
    let attempts = 0
    const maxAttempts = 60 // 5 minutes at 5s intervals

    pollRef.current = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        if (pollRef.current) clearInterval(pollRef.current)
        setStep('failed')
        setError('Payment timed out. Please check your Airtel Money and try again.')
        return
      }

      try {
        const res = await fetch(`/api/payments/status?paymentId=${pId}`)
        if (!res.ok) return

        const data = await res.json()

        if (data.status === 'COMPLETED') {
          if (pollRef.current) clearInterval(pollRef.current)
          setStep('success')
          setSuccess(`Successfully deposited ${formatZambianCurrency(data.netAmount || parseFloat(amount))}`)
          // Trigger parent data refresh
          onDeposit(data.netAmount || parseFloat(amount)).catch(() => {})
        } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
          if (pollRef.current) clearInterval(pollRef.current)
          setStep('failed')
          setError(data.statusMessage || 'Payment failed. Please try again.')
        } else {
          setStatusMessage(data.statusMessage || 'Waiting for confirmation...')
        }
      } catch {
        // Silently retry
      }
    }, 5000)
  }

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount)
    if (!depositAmount || depositAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }
    if (depositAmount < 1) {
      setError('Minimum deposit is K1')
      return
    }
    if (depositAmount > 1000000) {
      setError('Maximum deposit is K1,000,000')
      return
    }

    // Validate phone number if provided
    if (phoneNumber) {
      const digits = phoneNumber.replace(/\D/g, '')
      if (digits.length < 9 || digits.length > 13) {
        setError('Please enter a valid Zambian phone number (e.g., 0971234567)')
        return
      }
    }

    setError('')
    setSuccess('')
    setIsProcessing(true)

    try {
      // Call the deposit API
      const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: depositAmount,
          phoneNumber: phoneNumber || undefined,
          method: phoneNumber ? 'airtel_money' : 'direct',
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Deposit failed')

      // If Airtel Money flow (async), start polling
      if (data.paymentId && data.status === 'PROCESSING') {
        setPaymentId(data.paymentId)
        setStep('processing')
        setStatusMessage(data.message || 'Check your phone for the Airtel Money prompt...')
        pollPaymentStatus(data.paymentId)
      } else {
        // Direct deposit (instant)
        setStep('success')
        setSuccess(`Successfully deposited ${formatZambianCurrency(depositAmount)}`)
        await onDeposit(depositAmount, phoneNumber || undefined)
        setTimeout(handleClose, 2000)
      }
    } catch (err: any) {
      setError(err.message || 'Deposit failed. Please try again.')
      setStep('failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const quickAmounts = [10, 50, 100, 500, 1000, 5000]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={step === 'input' ? handleClose : undefined} />
      <div className="relative bg-[#1c2030] border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-green-500" />
            Deposit via Airtel Money
          </h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ─── Input Step ─── */}
        {step === 'input' && (
          <div className="p-4 space-y-4">
            {/* Current Balance */}
            <div className="bg-[#232637] rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Current Balance</div>
              <div className="text-xl font-bold text-white">{formatZambianCurrency(currentBalance)}</div>
            </div>

            {/* Phone Number Input */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Airtel Money Number</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">+260</span>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => { setPhoneNumber(e.target.value.replace(/[^\d]/g, '').slice(0, 10)); setError('') }}
                  placeholder="97XXXXXXX"
                  className="w-full pl-14 pr-3 py-3 text-lg font-medium bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-green-500"
                  maxLength={10}
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Enter your Airtel Money number to receive a payment prompt</p>
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
                  min="1"
                  step="1"
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

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Fee Info + New Balance Preview */}
            {amount && parseFloat(amount) > 0 && (
              <div className="bg-[#232637] rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Deposit Fee</span>
                  <span className="text-green-400 font-medium">FREE</span>
                </div>
                <div className="flex justify-between items-center text-sm border-t border-gray-700 pt-2">
                  <span className="text-gray-400">New Balance</span>
                  <span className="font-semibold text-green-400">
                    {formatZambianCurrency(currentBalance + parseFloat(amount))}
                  </span>
                </div>
              </div>
            )}

            {/* Deposit Button */}
            <button
              onClick={handleDeposit}
              disabled={isProcessing || !amount || parseFloat(amount) <= 0}
              className="w-full py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Initiating...
                </>
              ) : phoneNumber ? (
                'Deposit via Airtel Money'
              ) : (
                'Deposit'
              )}
            </button>

            <p className="text-[10px] text-gray-600 text-center">
              No fees on deposits. A USSD prompt will be sent to your phone. By depositing, you agree to the Terms of Use.
            </p>
          </div>
        )}

        {/* ─── Processing Step ─── */}
        {step === 'processing' && (
          <div className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
            </div>
            <h3 className="text-lg font-semibold text-white">Confirm on Your Phone</h3>
            <p className="text-sm text-gray-400">
              {statusMessage || 'A payment prompt has been sent to your Airtel Money. Enter your PIN to confirm.'}
            </p>
            <div className="bg-[#232637] rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Amount</span>
                <span className="text-white font-medium">{formatZambianCurrency(parseFloat(amount))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Phone</span>
                <span className="text-white font-medium">+260{phoneNumber}</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Waiting for confirmation...
            </div>
            <button
              onClick={handleClose}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel & Close
            </button>
          </div>
        )}

        {/* ─── Success Step ─── */}
        {step === 'success' && (
          <div className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-white">Deposit Successful!</h3>
            <p className="text-sm text-green-400">{success}</p>
            <button
              onClick={handleClose}
              className="w-full py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {/* ─── Failed Step ─── */}
        {step === 'failed' && (
          <div className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-white">Deposit Failed</h3>
            <p className="text-sm text-red-400">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { resetState(); setStep('input') }}
                className="flex-1 py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={handleClose}
                className="flex-1 py-3 bg-[#232637] text-gray-300 font-semibold rounded-lg hover:bg-[#2a2d44] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
