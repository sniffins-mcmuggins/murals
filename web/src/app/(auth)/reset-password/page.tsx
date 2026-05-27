'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('This link is invalid or has expired')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setPending(true)

    try {
      const { response } = await apiClient.POST('/auth/reset-password', {
        body: { token, new_password: password },
      })

      if (response.ok) {
        router.push('/login?reset=1')
        return
      }

      setError('This link is invalid or has expired')
    } catch {
      setError('This link is invalid or has expired')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
      <h1 className="font-serif text-3xl text-ink mb-2">Reset password</h1>
      <p className="font-sans text-mid text-sm mb-8">
        Choose a new password for your account.
      </p>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label
            htmlFor="password"
            className="block font-sans text-sm text-ink mb-1"
          >
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
            placeholder="At least 8 characters"
          />
        </div>

        {error && (
          <p role="alert" className="font-sans text-sm text-clay">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-amber text-ink font-sans font-medium text-sm rounded-lg py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {pending ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <p className="mt-6 font-sans text-sm text-mid text-center">
        <Link href="/login" className="text-ink underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-warm flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
            <p className="font-sans text-sm text-mid">Loading…</p>
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  )
}
