'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      const result = await response.json()
      if (response.ok) {
        setSuccess(true)
      } else {
        setError(result.error || 'Failed to send reset email')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#131722] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">Check Your Email</h1>
            <p className="text-gray-400 text-sm">
              We&apos;ve sent a password reset link to your email. Check your inbox and follow the instructions.
            </p>
          </div>
          <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-6 space-y-3">
            <p className="text-xs text-gray-500">- The link will expire in 1 hour</p>
            <p className="text-xs text-gray-500">- Check your spam folder if you don&apos;t see it</p>
            <button
              onClick={() => router.push('/auth/signin')}
              className="w-full mt-4 py-2.5 border border-gray-700 text-gray-300 rounded-lg hover:border-gray-500 hover:text-white transition-colors text-sm font-medium flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#131722] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-lg bg-green-500 flex items-center justify-center text-white text-sm font-bold">B</div>
            <span className="text-xl font-bold text-white">BetiPredict</span>
          </div>
          <p className="text-gray-400 text-sm">Reset your password</p>
        </div>

        <div className="bg-[#1c2030] border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-center mb-4">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-green-400" />
            </div>
          </div>

          <p className="text-gray-400 text-sm text-center mb-4">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 mb-4 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError('') }}
                className="w-full px-3 py-2.5 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                placeholder="you@example.com"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-800 text-center">
            <button
              onClick={() => router.push('/auth/signin')}
              className="text-sm text-green-400 hover:text-green-300 flex items-center justify-center gap-1 mx-auto"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
