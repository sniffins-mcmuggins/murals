'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Missing verification token.')
      return
    }

    apiClient
      .GET('/auth/verify-email', { params: { query: { token } } })
      .then(({ response }) => {
        if (!response.ok) {
          setError('This link is invalid or has expired. Please request a new verification email.')
          return
        }
        setDone(true)
        router.push('/dashboard')
      })
      .catch(() => setError('Something went wrong. Please try again.'))
  }, [token, router])

  if (error) {
    return (
      <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
        <h1 className="font-serif text-3xl text-ink mb-2">Verification failed</h1>
        <p className="font-sans text-mid text-sm mb-6">{error}</p>
        <Link href="/login" className="font-sans text-sm text-ink underline underline-offset-2">
          Back to sign in
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
        <h1 className="font-serif text-3xl text-ink mb-2">Email verified!</h1>
        <p className="font-sans text-mid text-sm">Redirecting you to your dashboard…</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
      <p className="font-sans text-mid text-sm">Verifying your email…</p>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <main className="min-h-screen bg-warm flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
            <p className="font-sans text-sm text-mid">Loading…</p>
          </div>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </main>
  )
}
