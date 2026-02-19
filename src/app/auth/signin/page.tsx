'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const router = useRouter()

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

    try {
      const result = await signIn('credentials', {
        email,
        password,
        mode,
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
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-lg bg-green-500 flex items-center justify-center text-white text-sm font-bold">B</div>
            <span className="text-xl font-bold text-white">BetiPredict</span>
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
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <p className="text-xs text-gray-500">New accounts start with <span className="text-green-400">K1,000</span> balance to get you started.</p>
            ) : (
              <p className="text-xs text-gray-500">Don&apos;t have an account? <button onClick={() => setMode('signup')} className="text-green-400 hover:underline">Sign up</button></p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
