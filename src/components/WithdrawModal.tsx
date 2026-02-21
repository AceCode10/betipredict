'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Smartphone, CheckCircle2, Loader2, AlertCircle, ArrowDownToLine } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

type WithdrawStep = 'input' | 'processing' | 'success' | 'failed'
type MobileProvider = 'airtel_money' | 'mtn_money'

// Fee constants (mirrored from server for display only)
const WITHDRAW_FEE_RATE = 0.015 // 1.5%
const WITHDRAW_FEE_MIN = 5 // K5

const PROVIDERS = [
  { id: 'airtel_money' as MobileProvider, name: 'Airtel Money', color: 'text-red-500', activeBg: 'bg-red-500/20 border-red-500', prefix: '097 / 077', hint: 'Airtel Zambia number (097X, 077X)' },
  { id: 'mtn_money' as MobileProvider, name: 'MTN MoMo', color: 'text-yellow-500', activeBg: 'bg-yellow-500/20 border-yellow-500', prefix: '096 / 076', hint: 'MTN Zambia number (096X, 076X)' },
]

interface WithdrawModalProps {
  isOpen: boolean
  onClose: () => void
  onWithdraw: (amount: number, phoneNumber?: string) => Promise<void>
  currentBalance: number
}

export function WithdrawModal({ isOpen, onClose, onWithdraw, currentBalance }: WithdrawModalProps) {
  const [amount, setAmount] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [provider, setProvider] = useState<MobileProvider>('airtel_money')
  const [step, setStep] = useState<WithdrawStep>('input')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [feeInfo, setFeeInfo] = useState<{ fee: number; net: number } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    setFeeInfo(null)
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  // Calculate fee on amount change
  useEffect(() => {
    const val = parseFloat(amount)
    if (val > 0) {
      const percentFee = val * WITHDRAW_FEE_RATE
      const fee = Math.round(Math.max(percentFee, WITHDRAW_FEE_MIN) * 100) / 100
      setFeeInfo({ fee, net: Math.round((val - fee) * 100) / 100 })
    } else {
      setFeeInfo(null)
    }
  }, [amount])

  if (!isOpen) return null

  const selectedProvider = PROVIDERS.find(p => p.id === provider)!
  const providerLabel = provider === 'airtel_money' ? 'Airtel Money' : 'MTN MoMo'

  const handleClose = () => {
    resetState()
    onClose()
  }

  const pollPaymentStatus = (pId: string) => {
    let attempts = 0
    const maxAttempts = 60

    pollRef.current = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        if (pollRef.current) clearInterval(pollRef.current)
        setStep('failed')
        setError('Withdrawal timed out. Your balance has been refunded. Please try again.')
        return
      }

      try {
        const res = await fetch(`/api/payments/status?paymentId=${pId}`)
        if (!res.ok) return
        const data = await res.json()

        if (data.status === 'COMPLETED') {
          if (pollRef.current) clearInterval(pollRef.current)
          setStep('success')
          setSuccess(`K${(data.netAmount || feeInfo?.net || 0).toFixed(2)} sent to your ${providerLabel}!`)
          // Trigger parent data refresh
          onWithdraw(parseFloat(amount), phoneNumber || undefined).catch(() => {})
        } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
          if (pollRef.current) clearInterval(pollRef.current)
          setStep('failed')
          setError(data.statusMessage || 'Withdrawal failed. Your balance has been refunded.')
          // Trigger parent data refresh (balance was refunded)
          onWithdraw(0).catch(() => {})
        } else {
          setStatusMessage(data.statusMessage || 'Processing withdrawal...')
        }
      } catch {
        // Silently retry
      }
    }, 5000)
  }

  const handleWithdraw = async () => {
    const withdrawAmount = parseFloat(amount)
    if (!withdrawAmount || withdrawAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }
    if (withdrawAmount < 10) {
      setError('Minimum withdrawal is K10')
      return
    }
    if (withdrawAmount > currentBalance) {
      setError('Insufficient balance')
      return
    }
    if (withdrawAmount > 500000) {
      setError('Maximum withdrawal is K500,000')
      return
    }

    if (!phoneNumber) {
      setError('Please enter your mobile money number')
      return
    }

    const digits = phoneNumber.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 13) {
      setError('Please enter a valid Zambian phone number')
      return
    }

    setError('')
    setSuccess('')
    setIsProcessing(true)

    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: withdrawAmount,
          phoneNumber,
          method: provider,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed')

      if (data.paymentId && data.status === 'PROCESSING') {
        setPaymentId(data.paymentId)
        setFeeInfo({ fee: data.fee, net: data.netAmount })
        setStep('processing')
        setStatusMessage(data.message || `Sending to your ${providerLabel}...`)
        pollPaymentStatus(data.paymentId)
      } else {
        setFeeInfo({ fee: data.fee || 0, net: data.netAmount || withdrawAmount })
        setStep('success')
        setSuccess(`Successfully withdrew ${formatZambianCurrency(data.netAmount || withdrawAmount)} (fee: ${formatZambianCurrency(data.fee || 0)})`)
        await onWithdraw(withdrawAmount, phoneNumber)
        setTimeout(handleClose, 2500)
      }
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed. Please try again.')
      setStep('failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const quickAmounts = [50, 100, 500, 1000, 5000]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={step === 'input' ? handleClose : undefined} />
      <div className="relative bg-[#1c2030] border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ArrowDownToLine className="w-5 h-5 text-orange-500" />
            Withdraw via Mobile Money
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
              <div className="text-xs text-gray-400 mb-1">Available Balance</div>
              <div className="text-xl font-bold text-white">{formatZambianCurrency(currentBalance)}</div>
            </div>

            {/* Provider Selection */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Payment Provider</label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setProvider(p.id); setError('') }}
                    className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border text-sm font-semibold transition-all ${
                      provider === p.id
                        ? `${p.activeBg} ${p.color}`
                        : 'border-gray-700 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    <span className={p.color}>{p.name}</span>
                    <span className="text-[10px] text-gray-500 font-normal">{p.prefix}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Phone Number Input */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">{providerLabel} Number</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">+260</span>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => { setPhoneNumber(e.target.value.replace(/[^\d]/g, '').slice(0, 10)); setError('') }}
                  placeholder={provider === 'airtel_money' ? '97XXXXXXX' : '96XXXXXXX'}
                  className="w-full pl-14 pr-3 py-3 text-lg font-medium bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
                  maxLength={10}
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">{selectedProvider.hint}</p>
            </div>

            {/* Amount Input */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Withdrawal Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg font-medium">K</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError('') }}
                  placeholder="0.00"
                  className="w-full pl-8 pr-3 py-3 text-right text-2xl font-bold bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
                  min="10"
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
                  disabled={amt > currentBalance}
                  className="py-2 text-sm font-medium bg-[#232637] border border-gray-700 rounded-lg text-gray-300 hover:border-orange-500/50 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  K{amt.toLocaleString()}
                </button>
              ))}
              <button
                onClick={() => { setAmount(Math.floor(currentBalance).toString()); setError('') }}
                disabled={currentBalance < 10}
                className="py-2 text-sm font-medium bg-[#232637] border border-orange-500/30 rounded-lg text-orange-400 hover:border-orange-500 hover:text-orange-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Max
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Fee Breakdown */}
            {feeInfo && parseFloat(amount) > 0 && parseFloat(amount) <= currentBalance && (
              <div className="bg-[#232637] rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Withdrawal Amount</span>
                  <span className="text-white">{formatZambianCurrency(parseFloat(amount))}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Withdrawal Fee (1.5%)</span>
                  <span className="text-orange-400">-{formatZambianCurrency(feeInfo.fee)}</span>
                </div>
                <div className="flex justify-between items-center text-sm border-t border-gray-700 pt-2">
                  <span className="text-gray-400">You Receive</span>
                  <span className="font-bold text-white">{formatZambianCurrency(feeInfo.net)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Remaining Balance</span>
                  <span className="text-orange-400 font-medium">
                    {formatZambianCurrency(currentBalance - parseFloat(amount))}
                  </span>
                </div>
              </div>
            )}

            {/* Withdraw Button */}
            <button
              onClick={handleWithdraw}
              disabled={isProcessing || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > currentBalance || !phoneNumber}
              className="w-full py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                `Withdraw to ${providerLabel}`
              )}
            </button>

            <p className="text-[10px] text-gray-600 text-center">
              1.5% withdrawal fee (min K5). Funds sent directly to your mobile money wallet.
            </p>
          </div>
        )}

        {/* ─── Processing Step ─── */}
        {step === 'processing' && (
          <div className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
            </div>
            <h3 className="text-lg font-semibold text-white">Sending to {providerLabel}</h3>
            <p className="text-sm text-gray-400">
              {statusMessage || 'Your withdrawal is being processed...'}
            </p>
            <div className="bg-[#232637] rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Sending</span>
                <span className="text-white font-medium">{formatZambianCurrency(feeInfo?.net || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">To</span>
                <span className="text-white font-medium">+260{phoneNumber}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Fee</span>
                <span className="text-orange-400">{formatZambianCurrency(feeInfo?.fee || 0)}</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing withdrawal...
            </div>
          </div>
        )}

        {/* ─── Success Step ─── */}
        {step === 'success' && (
          <div className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-white">Withdrawal Successful!</h3>
            <p className="text-sm text-green-400">{success}</p>
            <button
              onClick={handleClose}
              className="w-full py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors"
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
            <h3 className="text-lg font-semibold text-white">Withdrawal Failed</h3>
            <p className="text-sm text-red-400">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { resetState(); setStep('input') }}
                className="flex-1 py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors"
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
