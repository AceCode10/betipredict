'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Invalid credentials. Try any email and password.')
      } else {
        router.push('/')
        router.refresh()
      }
    } catch {
      setError('An error occurred')
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
          <p className="text-gray-400 text-sm">Sign in to start trading</p>
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
                placeholder="Enter any password"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-sm text-red-400">{error}</div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-800 text-center">
            <p className="text-xs text-gray-500">Use any email and password — accounts are created automatically.</p>
            <p className="text-xs text-gray-500 mt-1">New accounts start with K1,000 balance.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
