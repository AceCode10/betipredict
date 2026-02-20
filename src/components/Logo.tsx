'use client'

import { useTheme } from '@/contexts/ThemeContext'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showText?: boolean
}

export function Logo({ size = 'md', className = '', showText = true }: LogoProps) {
  const { isDarkMode } = useTheme()

  const sizes = {
    sm: {
      container: 'text-sm',
      letter: 'text-xs',
      gap: 'gap-1'
    },
    md: {
      container: 'text-xl',
      letter: 'text-sm',
      gap: 'gap-1'
    },
    lg: {
      container: 'text-2xl',
      letter: 'text-base',
      gap: 'gap-1.5'
    },
    xl: {
      container: 'text-3xl',
      letter: 'text-lg',
      gap: 'gap-2'
    }
  }

  const currentSize = sizes[size]
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'

  if (!showText) {
    return (
      <div className={`w-9 h-9 rounded-lg bg-green-500 flex items-center justify-center text-white font-bold ${className}`}>
        B
      </div>
    )
  }

  return (
    <div className={`font-bold ${currentSize.container} ${textColor} ${className}`}>
      <span className="text-green-500">B</span><span className={`${currentSize.gap}`}></span>etiPredict
    </div>
  )
}
