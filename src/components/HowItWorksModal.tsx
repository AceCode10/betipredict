'use client'

import { useState, useEffect } from 'react'
import { X, TrendingUp, Wallet, Trophy, ArrowRight, Zap, Shield, ChevronRight } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface HowItWorksModalProps {
  isOpen: boolean
  onClose: () => void
}

const STEPS = [
  {
    icon: TrendingUp,
    step: '01',
    title: 'Pick a Market',
    subtitle: 'Browse & discover',
    description: 'Explore sports matches and prediction markets. Each outcome has a price between K0.01 and K0.99 — the lower the price, the higher the potential payout.',
    gradient: 'from-green-500 to-emerald-600',
    glow: 'shadow-green-500/20',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    ring: 'ring-green-500/30',
    example: {
      label: 'Arsenal vs Chelsea',
      items: [
        { text: 'Home', value: 'K0.45', color: 'text-green-400' },
        { text: 'Draw', value: 'K0.28', color: 'text-gray-400' },
        { text: 'Away', value: 'K0.27', color: 'text-blue-400' },
      ],
    },
  },
  {
    icon: Wallet,
    step: '02',
    title: 'Trade Shares',
    subtitle: 'Deposit & trade',
    description: 'Deposit Kwacha via mobile money and buy shares in the outcome you believe in. Sports markets let you trade Home, Draw, or Away — each independently priced.',
    gradient: 'from-blue-500 to-indigo-600',
    glow: 'shadow-blue-500/20',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    ring: 'ring-blue-500/30',
    example: {
      label: 'Your trade',
      items: [
        { text: '100 shares', value: '×', color: 'text-gray-400' },
        { text: 'K0.45', value: '=', color: 'text-gray-400' },
        { text: 'K45 cost', value: '', color: 'text-green-400' },
      ],
    },
  },
  {
    icon: Trophy,
    step: '03',
    title: 'Win or Sell',
    subtitle: 'Profit & withdraw',
    description: 'If your outcome wins, each share pays K1.00. You can also sell anytime before resolution to lock in profit or cut losses. Withdraw winnings instantly via mobile money.',
    gradient: 'from-yellow-500 to-orange-500',
    glow: 'shadow-yellow-500/20',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    ring: 'ring-yellow-500/30',
    example: {
      label: 'Your payout',
      items: [
        { text: '100 shares', value: '×', color: 'text-gray-400' },
        { text: 'K1.00', value: '=', color: 'text-gray-400' },
        { text: 'K100', value: '(+K55)', color: 'text-green-400' },
      ],
    },
  },
]

const FEATURES = [
  { icon: Zap, text: 'Instant deposits via mobile money' },
  { icon: Shield, text: 'Secure & transparent trading' },
  { icon: Trophy, text: 'Real sports, real predictions' },
]

export function HowItWorksModal({ isOpen, onClose }: HowItWorksModalProps) {
  const { isDarkMode } = useTheme()
  const [step, setStep] = useState(0)
  const [animating, setAnimating] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
      setStep(0)
    }
  }, [isOpen])

  if (!isOpen) return null

  const bgColor = isDarkMode ? 'bg-[#141724]' : 'bg-white'
  const surfaceBg = isDarkMode ? 'bg-[#1c2036]' : 'bg-gray-50'
  const borderColor = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  const goTo = (next: number) => {
    setAnimating(true)
    setTimeout(() => {
      setStep(next)
      setAnimating(false)
    }, 150)
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className={`relative ${bgColor} rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden transition-all duration-500 ${visible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'}`}>
        {/* Gradient top bar */}
        <div className={`h-1 bg-gradient-to-r ${current.gradient} transition-all duration-500`} />

        {/* Close button */}
        <button
          onClick={() => { setVisible(false); setTimeout(onClose, 200) }}
          className={`absolute top-4 right-4 p-1.5 rounded-lg ${textMuted} hover:${textColor} ${isDarkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100'} transition-all z-10`}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="px-8 pt-6 pb-2">
          <p className={`text-xs font-semibold tracking-widest uppercase ${current.color} mb-1`}>How it works</p>
          <p className={`text-[11px] ${textMuted}`}>3 simple steps to start trading</p>
        </div>

        {/* Step indicator — clickable pills */}
        <div className="px-8 py-3">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className="flex-1 group relative"
              >
                <div className={`h-1.5 rounded-full transition-all duration-500 ${
                  i === step
                    ? `bg-gradient-to-r ${s.gradient}`
                    : i < step
                      ? isDarkMode ? 'bg-gray-600' : 'bg-gray-300'
                      : isDarkMode ? 'bg-gray-800' : 'bg-gray-200'
                }`} />
                <p className={`text-[10px] mt-1.5 text-center font-medium transition-colors ${
                  i === step ? s.color : textMuted
                }`}>
                  {s.title}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Step content — animated */}
        <div className={`px-8 pb-4 transition-all duration-150 ${animating ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}>
          {/* Icon + Step number */}
          <div className="flex items-center gap-4 mb-4">
            <div className={`relative w-14 h-14 rounded-xl bg-gradient-to-br ${current.gradient} flex items-center justify-center shadow-lg ${current.glow}`}>
              <Icon className="w-7 h-7 text-white" />
              <span className={`absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full ${isDarkMode ? 'bg-[#141724]' : 'bg-white'} border-2 ${borderColor} flex items-center justify-center text-[10px] font-bold ${current.color}`}>
                {current.step}
              </span>
            </div>
            <div>
              <h3 className={`text-lg font-bold ${textColor}`}>{current.title}</h3>
              <p className={`text-xs ${textMuted}`}>{current.subtitle}</p>
            </div>
          </div>

          {/* Description */}
          <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>{current.description}</p>

          {/* Interactive example card */}
          <div className={`${surfaceBg} rounded-xl border ${borderColor} p-4 ring-1 ${current.ring}`}>
            <p className={`text-[10px] font-semibold tracking-wider uppercase ${textMuted} mb-3`}>{current.example.label}</p>
            <div className="flex items-center justify-between gap-2">
              {current.example.items.map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className={`text-sm font-bold ${item.color}`}>{item.text}</span>
                  {item.value && <span className={`text-xs ${textMuted}`}>{item.value}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Features strip — shown on last step */}
        {step === 2 && !animating && (
          <div className={`mx-8 mb-3 grid grid-cols-3 gap-2`}>
            {FEATURES.map((f, i) => (
              <div key={i} className={`flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-lg ${surfaceBg} border ${borderColor}`}>
                <f.icon className={`w-4 h-4 ${current.color}`} />
                <span className={`text-[10px] text-center leading-tight ${textMuted}`}>{f.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer buttons */}
        <div className={`px-8 pb-6 pt-2 flex items-center gap-3`}>
          {step > 0 && (
            <button
              onClick={() => goTo(step - 1)}
              className={`px-5 py-3 text-sm font-semibold rounded-xl border ${borderColor} ${textMuted} hover:${textColor} transition-all`}
            >
              Back
            </button>
          )}
          <button
            onClick={() => {
              if (isLast) {
                setVisible(false)
                setTimeout(() => { onClose(); setStep(0) }, 200)
              } else {
                goTo(step + 1)
              }
            }}
            className={`flex-1 py-3 text-sm font-bold rounded-xl text-white bg-gradient-to-r ${current.gradient} hover:shadow-lg ${current.glow} transition-all duration-300 flex items-center justify-center gap-2`}
          >
            {isLast ? (
              <>Start Trading <Zap className="w-4 h-4" /></>
            ) : (
              <>Next <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
