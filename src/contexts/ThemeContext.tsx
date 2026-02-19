'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface ThemeContextType {
  isDarkMode: boolean
  toggleDarkMode: () => void
  setDarkMode: (value: boolean) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDarkMode, setIsDarkMode] = useState(true) // Default to dark mode
  const [mounted, setMounted] = useState(false)

  // Load preference from localStorage on mount
  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('betipredict-dark-mode')
    if (stored !== null) {
      setIsDarkMode(stored === 'true')
    }
  }, [])

  // Apply theme class to document
  useEffect(() => {
    if (!mounted) return
    
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.add('light')
      document.documentElement.classList.remove('dark')
    }
    
    localStorage.setItem('betipredict-dark-mode', String(isDarkMode))
  }, [isDarkMode, mounted])

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev)
  }

  const setDarkMode = (value: boolean) => {
    setIsDarkMode(value)
  }

  // Prevent flash of wrong theme
  if (!mounted) {
    return <>{children}</>
  }

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode, setDarkMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  // Return defaults for SSG/SSR when ThemeProvider isn't available
  if (context === undefined) {
    return {
      isDarkMode: true,
      toggleDarkMode: () => {},
      setDarkMode: () => {},
    }
  }
  return context
}
