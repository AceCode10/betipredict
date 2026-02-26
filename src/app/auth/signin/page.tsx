'use client'

import { useState, useEffect } from 'react'
import { useSession, signIn, getSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/Logo'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [authMethod, setAuthMethod] = useState<'phone' | 'email'>('phone')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const router = useRouter()

  const sendOtp = async () => {
    if (!phone.trim()) { setError('Enter your phone number'); return }
    setOtpLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      setOtpSent(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setOtpLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setIsLoading(false)
      return
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (mode === 'signup' && authMethod === 'phone' && !otp) {
      setError('Please enter the OTP sent to your WhatsApp')
      setIsLoading(false)
      return
    }

    try {
      const result = await signIn('credentials', {
        email: authMethod === 'email' ? email : undefined,
        phone: authMethod === 'phone' ? phone : undefined,
        password,
        mode,
        otp: authMethod === 'phone' && mode === 'signup' ? otp : undefined,
        redirect: false,
      })

      if (result?.error) {
        setError(result.error)
      } else {
        router.push('/')
        router.refresh()
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#131722] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center mb-2">
            <Logo size="lg" />
          </div>
          <p className="text-gray-400 text-sm">
            {mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex mb-4 bg-[#1c2030] rounded-lg p-1 border border-gray-800">
          <button
            type="button"
            onClick={() => { setMode('signin'); setError('') }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'signin' ? 'bg-green-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError('') }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'signup' ? 'bg-green-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-6">
          {/* Auth method toggle */}
          <div className="flex mb-4 bg-[#232637] rounded-lg p-0.5 border border-gray-700">
            <button type="button" onClick={() => { setAuthMethod('phone'); setError(''); setOtpSent(false) }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${authMethod === 'phone' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'text-gray-500 hover:text-gray-300'}`}>
              📱 WhatsApp
            </button>
            <button type="button" onClick={() => { setAuthMethod('email'); setError('') }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${authMethod === 'email' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'text-gray-500 hover:text-gray-300'}`}>
              ✉️ Email
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {authMethod === 'phone' ? (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                  placeholder="+260 97X XXX XXX"
                  required
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                  placeholder="you@example.com"
                  required
                />
              </div>
            )}

            {/* Email field (optional) during phone signup */}
            {authMethod === 'phone' && mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email <span className="text-gray-500">(optional)</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                  placeholder="you@example.com"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                placeholder="Min 6 characters"
                required
                minLength={6}
              />
            </div>

            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                  placeholder="Re-enter password"
                  required
                  minLength={6}
                />
              </div>
            )}

            {/* OTP section for phone signup */}
            {authMethod === 'phone' && mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">WhatsApp OTP</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="flex-1 px-3 py-2.5 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm tracking-widest text-center font-mono"
                    placeholder="------"
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={otpLoading || !phone.trim()}
                    className="px-3 py-2.5 bg-green-500/20 text-green-400 text-xs font-medium rounded-lg border border-green-500/30 hover:bg-green-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {otpLoading ? '...' : otpSent ? 'Resend' : 'Send OTP'}
                  </button>
                </div>
                {otpSent && <p className="text-xs text-green-400 mt-1">OTP sent to your WhatsApp!</p>}
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-sm text-red-400">{error}</div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {isLoading ? 'Processing...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-800 text-center space-y-2">
            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => router.push('/auth/forgot-password')}
                className="text-xs text-gray-500 hover:text-green-400 transition-colors"
              >
                Forgot your password?
              </button>
            )}
            {mode === 'signup' ? (
              <p className="text-xs text-gray-500">Create your account to start trading on prediction markets.</p>
            ) : (
              <p className="text-xs text-gray-500">Don&apos;t have an account? <button onClick={() => setMode('signup')} className="text-green-400 hover:underline">Sign up</button></p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
