'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { apiClient } from '@/lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    try {
      const { response } = await apiClient.POST('/auth/forgot-password', {
        body: { email },
      })

      if (response.status === 202) {
        setSent(true)
        return
      }

      setError('Something went wrong. Please try again.')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="min-h-screen bg-warm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
        <h1 className="font-serif text-3xl text-ink mb-2">Forgot password</h1>

        {sent ? (
          <>
            <p className="font-sans text-mid text-sm mb-6">
              Check your email. If an account exists for{' '}
              <span className="text-ink">{email}</span>, we&apos;ve sent a link
              to reset your password. The link expires in 1 hour.
            </p>
            <p className="font-sans text-sm text-mid text-center">
              <Link
                href="/login"
                className="text-ink underline underline-offset-2"
              >
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="font-sans text-mid text-sm mb-8">
              Enter your email and we&apos;ll send you a link to reset your
              password.
            </p>

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block font-sans text-sm text-ink mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
                  placeholder="you@example.com"
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
                {pending ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className="mt-6 font-sans text-sm text-mid text-center">
              Remembered it?{' '}
              <Link
                href="/login"
                className="text-ink underline underline-offset-2"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
