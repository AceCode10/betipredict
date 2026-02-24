'use client'

import { useState } from 'react'
import { X, TrendingUp, Wallet, Trophy } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface HowItWorksModalProps {
  isOpen: boolean
  onClose: () => void
}

const STEPS = [
  {
    icon: TrendingUp,
    title: 'Pick a Market',
    description: 'Browse sports matches and prediction markets. Each outcome has a price between K0.01 and K0.99 — the lower the price, the higher the potential payout.',
    color: 'text-green-500',
    bg: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
  },
  {
    icon: Wallet,
    title: 'Buy Shares',
    description: 'Deposit Kwacha and buy shares in the outcome you believe in. For sports markets, you can trade Home, Draw, or Away — each is independently priced.',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
  },
  {
    icon: Trophy,
    title: 'Win or Sell',
    description: 'If your outcome wins, each share pays out K1.00. You can also sell your shares anytime before resolution to lock in profit or cut losses.',
    color: 'text-yellow-500',
    bg: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
  },
]

export function HowItWorksModal({ isOpen, onClose }: HowItWorksModalProps) {
  const { isDarkMode } = useTheme()
  const [step, setStep] = useState(0)

  if (!isOpen) return null

  const bgColor = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className={`relative ${bgColor} rounded-2xl shadow-2xl w-full max-w-md overflow-hidden`}>
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 p-1 rounded-lg ${textMuted} hover:${textColor} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} transition-colors z-10`}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Step content */}
        <div className="px-8 pt-10 pb-6 text-center">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? `w-8 ${i === 0 ? 'bg-green-500' : i === 1 ? 'bg-blue-500' : 'bg-yellow-500'}`
                    : i < step
                      ? `w-4 ${isDarkMode ? 'bg-gray-500' : 'bg-gray-300'}`
                      : `w-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`
                }`}
              />
            ))}
          </div>

          {/* Icon */}
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl ${current.bg} border ${current.borderColor} mb-6`}>
            <Icon className={`w-8 h-8 ${current.color}`} />
          </div>

          {/* Title */}
          <h3 className={`text-xl font-bold ${textColor} mb-3`}>{current.title}</h3>

          {/* Description */}
          <p className={`text-sm leading-relaxed ${textMuted} mb-2`}>{current.description}</p>

          {/* Example for each step */}
          {step === 0 && (
            <div className={`mt-4 p-3 rounded-lg ${isDarkMode ? 'bg-[#252840]' : 'bg-gray-50'} border ${borderColor}`}>
              <p className={`text-xs ${textMuted} mb-2`}>Example:</p>
              <div className="flex items-center justify-between text-sm">
                <span className={textColor}>Arsenal vs Chelsea</span>
                <div className="flex gap-2 text-xs font-semibold">
                  <span className="text-green-500">Home K0.45</span>
                  <span className={textMuted}>Draw K0.28</span>
                  <span className="text-blue-500">Away K0.27</span>
                </div>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className={`mt-4 p-3 rounded-lg ${isDarkMode ? 'bg-[#252840]' : 'bg-gray-50'} border ${borderColor}`}>
              <p className={`text-xs ${textMuted} mb-2`}>Example:</p>
              <div className={`text-sm ${textColor}`}>
                Buy 100 Home shares at K0.45 each = <span className="font-bold text-green-500">K45</span> cost
              </div>
            </div>
          )}
          {step === 2 && (
            <div className={`mt-4 p-3 rounded-lg ${isDarkMode ? 'bg-[#252840]' : 'bg-gray-50'} border ${borderColor}`}>
              <p className={`text-xs ${textMuted} mb-2`}>Example:</p>
              <div className={`text-sm ${textColor}`}>
                100 shares x K1.00 = <span className="font-bold text-green-500">K100 payout</span> (K55 profit!)
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className={`px-8 pb-8 flex items-center gap-3`}>
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className={`flex-1 py-3 text-sm font-semibold rounded-xl border ${borderColor} ${textMuted} hover:${textColor} transition-colors`}
            >
              Back
            </button>
          )}
          <button
            onClick={() => {
              if (isLast) {
                onClose()
                setStep(0)
              } else {
                setStep(s => s + 1)
              }
            }}
            className={`flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-colors ${
              step === 0
                ? 'bg-green-500 hover:bg-green-600'
                : step === 1
                  ? 'bg-blue-500 hover:bg-blue-600'
                  : 'bg-yellow-500 hover:bg-yellow-600'
            }`}
          >
            {isLast ? 'Start Trading' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
