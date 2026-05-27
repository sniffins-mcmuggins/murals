'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaToken, setMfaToken] = useState('')
  const [totpCode, setTotpCode] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    try {
      const { response } = await apiClient.POST('/auth/login', {
        body: { email, password },
      })

      if (response.status === 401) {
        setError('Invalid email or password')
        return
      }

      if (!response.ok) {
        setError('Something went wrong. Please try again.')
        return
      }

      const json = await response
        .clone()
        .json()
        .catch(() => null)
      if (
        json &&
        typeof json === 'object' &&
        'mfa_required' in json &&
        (json as { mfa_required?: unknown }).mfa_required === true
      ) {
        const token = (json as { mfa_token?: unknown }).mfa_token
        if (typeof token === 'string') {
          setMfaToken(token)
          setMfaRequired(true)
          return
        }
      }

      // HTTP-only session cookie is set by the server automatically.
      router.push(nextPath)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function handleMfaSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!/^[0-9]{6}$/.test(totpCode)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }

    setPending(true)

    try {
      const res = await fetch(`${apiUrl}/auth/mfa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mfaToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({ code: totpCode }),
      })

      if (!res.ok) {
        setError('Invalid code. Check your authenticator app.')
        return
      }

      router.push(nextPath)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  function backToLogin() {
    setMfaRequired(false)
    setMfaToken('')
    setTotpCode('')
    setError(null)
  }

  if (mfaRequired) {
    return (
      <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
        <h1 className="font-serif text-3xl text-ink mb-2">
          Two-factor authentication
        </h1>
        <p className="font-sans text-mid text-sm mb-8">
          Enter the 6-digit code from your authenticator app.
        </p>

        <form onSubmit={handleMfaSubmit} noValidate className="space-y-5">
          <div>
            <label
              htmlFor="totp"
              className="block font-sans text-sm text-ink mb-1"
            >
              Authentication code
            </label>
            <input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              pattern="[0-9]{6}"
              value={totpCode}
              onChange={(e) =>
                setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber tracking-widest text-center"
              placeholder="000000"
              autoFocus
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
            {pending ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <p className="mt-6 font-sans text-sm text-mid text-center">
          <button
            type="button"
            onClick={backToLogin}
            className="text-ink underline underline-offset-2"
          >
            Back to sign in
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
      <h1 className="font-serif text-3xl text-ink mb-2">Sign in</h1>
      <p className="font-sans text-mid text-sm mb-8">
        Welcome back to Render.
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

        <div>
          <label
            htmlFor="password"
            className="block font-sans text-sm text-ink mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
            placeholder="••••••••"
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
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 font-sans text-sm text-mid text-center">
        <Link
          href="/forgot-password"
          className="text-ink underline underline-offset-2"
        >
          Forgot your password?
        </Link>
      </p>

      <div className="flex items-center gap-4 my-6">
        <div className="flex-1 border-t border-light" />
        <span className="font-sans text-xs text-mid uppercase tracking-wider">
          or
        </span>
        <div className="flex-1 border-t border-light" />
      </div>

      <div className="space-y-3">
        <a
          href={`${apiUrl}/auth/oauth/google`}
          className="flex items-center justify-center gap-3 border border-light rounded-lg py-2.5 font-sans text-sm text-ink hover:bg-warm transition-colors"
        >
          Continue with Google
        </a>
        <a
          href={`${apiUrl}/auth/oauth/apple`}
          className="flex items-center justify-center gap-3 bg-ink text-offwhite rounded-lg py-2.5 font-sans text-sm hover:opacity-90 transition-opacity"
        >
          Continue with Apple
        </a>
      </div>

      <p className="mt-6 font-sans text-sm text-mid text-center">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-ink underline underline-offset-2">
          Sign up
        </Link>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-warm flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
            <p className="font-sans text-sm text-mid">Loading…</p>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  )
}
