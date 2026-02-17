'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { CheckCircle, XCircle, AlertCircle, Mail } from 'lucide-react'

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-b-2 border-blue-600 rounded-full" /></div>}>
      <VerifyEmailContent />
    </Suspense>
  )
}

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')

    if (success === 'true') {
      setStatus('success')
      setMessage('Your email has been successfully verified! You can now sign in.')
    } else if (error) {
      setStatus('error')
      switch (error) {
        case 'missing-token':
          setMessage('Verification token is missing.')
          break
        case 'invalid-token':
          setMessage('This verification link is invalid or has expired.')
          break
        case 'server-error':
          setMessage('A server error occurred. Please try again.')
          break
        default:
          setMessage('An error occurred during verification.')
      }
    } else {
      setStatus('error')
      setMessage('Invalid verification request.')
    }
  }, [searchParams])

  const handleResend = async () => {
    const email = prompt('Please enter your email address:')
    if (!email) return

    try {
      const response = await fetch('/api/auth/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      const result = await response.json()

      if (response.ok) {
        alert('Verification email sent! Please check your inbox.')
        if (result.verificationUrl) {
          console.log('Development verification URL:', result.verificationUrl)
        }
      } else {
        alert(result.error || 'Failed to resend verification email.')
      }
    } catch (error) {
      alert('An error occurred. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            {status === 'loading' && (
              <div className="animate-spin w-12 h-12 border-b-2 border-blue-600 rounded-full mx-auto"></div>
            )}
            {status === 'success' && (
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
            )}
            {status === 'error' && (
              <XCircle className="w-12 h-12 text-red-600 mx-auto" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {status === 'success' ? 'Email Verified!' : 'Verification Failed'}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-gray-600">{message}</p>

          {status === 'success' && (
            <Button 
              onClick={() => router.push('/auth/signin')}
              className="w-full"
            >
              Sign In
            </Button>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              <Button 
                onClick={handleResend}
                variant="outline"
                className="w-full"
              >
                <Mail className="w-4 h-4 mr-2" />
                Resend Verification Email
              </Button>
              <Button 
                onClick={() => router.push('/auth/signin')}
                className="w-full"
              >
                Back to Sign In
              </Button>
            </div>
          )}

          <div className="flex items-center justify-center text-sm text-gray-500">
            <AlertCircle className="w-4 h-4 mr-1" />
            If you continue to have issues, please contact support
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
