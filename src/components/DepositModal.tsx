'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, CreditCard, Smartphone, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { formatZambianCurrency } from '@/utils/currency'

// Declare the LencoPay global object loaded from external script
declare global {
  interface Window {
    LencoPay?: {
      getPaid: (config: any) => void
    }
  }
}

type DepositStep = 'input' | 'processing' | 'success' | 'failed'
type PaymentMethod = 'mobile-money' | 'card'

interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
  onDeposit: (amount: number, phoneNumber?: string) => Promise<void>
  currentBalance: number
}

export function DepositModal({ isOpen, onClose, onDeposit, currentBalance }: DepositModalProps) {
  const [amount, setAmount] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mobile-money')
  const [step, setStep] = useState<DepositStep>('input')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stepRef = useRef<DepositStep>('input')

  // Keep stepRef in sync
  useEffect(() => { stepRef.current = step }, [step])

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
    setStatusMessage('')
    setPhoneNumber('')
    setPaymentMethod('mobile-money')
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  if (!isOpen) return null

  const handleClose = () => {
    resetState()
    onClose()
  }

  const pollLencoStatus = (reference: string) => {
    let attempts = 0
    const maxAttempts = 120 // 10 minutes at 5s intervals

    pollRef.current = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        if (pollRef.current) clearInterval(pollRef.current)
        setStep('failed')
        setError('Payment timed out. If you were charged, please contact support.')
        return
      }

      try {
        const res = await fetch(`/api/payments/lenco/verify?reference=${reference}`)
        if (!res.ok) return

        const data = await res.json()

        if (data.status === 'COMPLETED') {
          if (pollRef.current) clearInterval(pollRef.current)
          setStep('success')
          setSuccess(`Successfully deposited ${formatZambianCurrency(data.amount || parseFloat(amount))}`)
          onDeposit(data.amount || parseFloat(amount)).catch(() => {})
        } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
          if (pollRef.current) clearInterval(pollRef.current)
          setStep('failed')
          setError(data.message || 'Payment failed. Please try again.')
        } else {
          setStatusMessage(data.message || 'Waiting for confirmation...')
        }
      } catch {
        // Silently retry
      }
    }, 5000)
  }

  const isTestMode = typeof window !== 'undefined' && process.env.NEXT_PUBLIC_TEST_MODE === 'true'

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

    // Validate phone number for mobile money
    if (!isTestMode && paymentMethod === 'mobile-money') {
      if (!phoneNumber) {
        setError('Please enter your mobile money number')
        return
      }
      const digits = phoneNumber.replace(/\D/g, '')
      if (digits.length < 9 || digits.length > 13) {
        setError('Please enter a valid Zambian phone number')
        return
      }
    }

    setError('')
    setSuccess('')
    setIsProcessing(true)

    // ─── TEST MODE: use existing deposit route for instant credit ───
    if (isTestMode) {
      try {
        const res = await fetch('/api/deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: depositAmount, phoneNumber: '0970000000', method: 'airtel_money' })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Deposit failed')

        setStep('success')
        setSuccess(data.message || `Successfully deposited ${formatZambianCurrency(depositAmount)}`)
        await onDeposit(depositAmount)
        setTimeout(handleClose, 2000)
      } catch (err: any) {
        setError(err.message || 'Deposit failed. Please try again.')
        setStep('failed')
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // ─── LIVE MODE: Lenco Payment ────────────────────────────────
    try {
      // Step 1: Initialize payment on server
      const res = await fetch('/api/payments/lenco/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: depositAmount,
          phoneNumber: paymentMethod === 'mobile-money' ? phoneNumber : undefined,
          channel: paymentMethod,
        }),
      })
      const initData = await res.json()
      if (!res.ok) throw new Error(initData.error || 'Failed to initialize payment')

      // Step 2: Try popup widget first, fall back to checkout URL
      const widgetAvailable = typeof window !== 'undefined' && !!window.LencoPay

      if (widgetAvailable) {
        // Use Lenco popup widget
        window.LencoPay!.getPaid({
          key: initData.publicKey,
          reference: initData.reference,
          email: initData.email || '',
          amount: depositAmount,
          currency: 'ZMW',
          channels: [paymentMethod],
          customer: {
            firstName: initData.firstName || '',
            lastName: initData.lastName || '',
          },
          onSuccess: async (response: any) => {
            setStep('processing')
            setStatusMessage('Verifying payment...')
            try {
              const verifyRes = await fetch(`/api/payments/lenco/verify?reference=${response.reference || initData.reference}`)
              const data = await verifyRes.json()
              if (data.status === 'COMPLETED') {
                setStep('success')
                setSuccess(`Successfully deposited ${formatZambianCurrency(depositAmount)}`)
                await onDeposit(depositAmount)
                setTimeout(handleClose, 2500)
              } else {
                pollLencoStatus(initData.reference)
              }
            } catch {
              pollLencoStatus(initData.reference)
            }
          },
          onClose: () => {
            setIsProcessing(false)
            if (stepRef.current === 'input') {
              setStatusMessage('')
            }
          },
          onConfirmationPending: () => {
            setStep('processing')
            setStatusMessage('Payment is being confirmed. Please wait...')
            pollLencoStatus(initData.reference)
          },
        })
      } else if (initData.checkoutUrl) {
        // Fallback: redirect to Lenco checkout page
        setStep('processing')
        setStatusMessage('Redirecting to payment page...')
        window.open(initData.checkoutUrl, '_blank')
        // Start polling for payment confirmation
        pollLencoStatus(initData.reference)
      } else {
        // Last resort: start polling and show instructions
        setStep('processing')
        setStatusMessage('Payment initiated. Complete the payment on your phone.')
        pollLencoStatus(initData.reference)
      }
    } catch (err: any) {
      setError(err.message || 'Deposit failed. Please try again.')
      setStep('failed')
      setIsProcessing(false)
    }
  }

  const quickAmounts = [10, 50, 100, 500, 1000, 5000]

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center px-4 py-4 sm:py-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60" onClick={step === 'input' ? handleClose : undefined} />
      <div className="relative bg-[#1c2030] border border-gray-700 rounded-xl w-full max-w-md shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            {isTestMode ? (
              <Smartphone className="w-5 h-5 text-green-500" />
            ) : (
              <CreditCard className="w-5 h-5 text-green-500" />
            )}
            {isTestMode ? 'Test Deposit' : 'Deposit Funds'}
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

            {/* Payment Method Selection (live mode only) */}
            {!isTestMode && (
              <div>
                <label className="block text-xs text-gray-400 mb-2">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPaymentMethod('mobile-money'); setError('') }}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                      paymentMethod === 'mobile-money'
                        ? 'border-green-500 bg-green-500/10 ring-1 ring-green-500/30'
                        : 'border-gray-700 bg-[#232637] hover:border-gray-500'
                    }`}
                  >
                    <Smartphone className={`w-5 h-5 ${paymentMethod === 'mobile-money' ? 'text-green-400' : 'text-gray-400'}`} />
                    <span className={`text-xs font-semibold ${paymentMethod === 'mobile-money' ? 'text-green-400' : 'text-gray-300'}`}>
                      Mobile Money
                    </span>
                    <div className="flex gap-1">
                      <span className="px-1.5 py-0.5 text-[8px] font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded">MTN</span>
                      <span className="px-1.5 py-0.5 text-[8px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 rounded">Airtel</span>
                    </div>
                    <span className="text-[9px] text-gray-500">1% fee</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPaymentMethod('card'); setError('') }}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                      paymentMethod === 'card'
                        ? 'border-green-500 bg-green-500/10 ring-1 ring-green-500/30'
                        : 'border-gray-700 bg-[#232637] hover:border-gray-500'
                    }`}
                  >
                    <CreditCard className={`w-5 h-5 ${paymentMethod === 'card' ? 'text-green-400' : 'text-gray-400'}`} />
                    <span className={`text-xs font-semibold ${paymentMethod === 'card' ? 'text-green-400' : 'text-gray-300'}`}>
                      Debit/Credit Card
                    </span>
                    <div className="flex gap-1">
                      <span className="px-1.5 py-0.5 text-[8px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">Visa</span>
                      <span className="px-1.5 py-0.5 text-[8px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded">MC</span>
                    </div>
                    <span className="text-[9px] text-gray-500">3.5% fee</span>
                  </button>
                </div>
              </div>
            )}

            {/* Phone Number Input (mobile money only, live mode) */}
            {!isTestMode && paymentMethod === 'mobile-money' && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Mobile Money Number</label>
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
                <p className="text-[10px] text-gray-500 mt-1">MTN (096X, 076X) or Airtel (097X, 077X)</p>
              </div>
            )}

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
                {!isTestMode && (
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-gray-500">Processing fee (paid by you)</span>
                    <span className="text-gray-500">{paymentMethod === 'mobile-money' ? '1%' : '3.5%'}</span>
                  </div>
                )}
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
              disabled={isProcessing || !amount || parseFloat(amount) <= 0 || (!isTestMode && paymentMethod === 'mobile-money' && !phoneNumber)}
              className="w-full py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Initializing payment...
                </>
              ) : (
                isTestMode ? 'Deposit (Test)' : `Deposit via ${paymentMethod === 'mobile-money' ? 'Mobile Money' : 'Card'}`
              )}
            </button>

            <p className="text-[10px] text-gray-600 text-center">
              {isTestMode
                ? 'Test mode: deposits are credited instantly with prop money.'
                : 'No platform fees on deposits. Processing fees are added by payment provider. Powered by Lenco.'}
            </p>
          </div>
        )}

        {/* ─── Processing Step ─── */}
        {step === 'processing' && (
          <div className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
            </div>
            <h3 className="text-lg font-semibold text-white">Confirming Payment</h3>
            <p className="text-sm text-gray-400">
              {statusMessage || 'Your payment is being processed. This may take a moment...'}
            </p>
            <div className="bg-[#232637] rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Amount</span>
                <span className="text-white font-medium">{formatZambianCurrency(parseFloat(amount))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Method</span>
                <span className="text-white font-medium">{paymentMethod === 'mobile-money' ? 'Mobile Money' : 'Card'}</span>
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
