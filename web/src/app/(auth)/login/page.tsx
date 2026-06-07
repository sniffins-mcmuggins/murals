'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

type LoginSuccessBody = {
  mfa_required?: boolean
  mfa_token?: string
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/dashboard'
  const claimRedirect = searchParams.get('claim')

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
      const { data, response } = await apiClient.POST('/auth/login', {
        body: { email, password },
      })

      if (response.status === 401) {
        setError('Invalid email or password')
        return
      }

      if (response.status === 403) {
        setError('Please verify your email before signing in. Check your inbox.')
        return
      }

      if (!response.ok) {
        setError('Something went wrong. Please try again.')
        return
      }

      // The OpenAPI spec models /auth/login as returning {token, user}, but
      // the runtime also has an MFA branch returning {mfa_required, mfa_token}.
      // Until the spec catches up (followup in PR #103), we cast `data` —
      // which openapi-fetch has already parsed from the response body — to
      // the wider shape and detect the MFA branch by duck-typing.
      const body = data as LoginSuccessBody | undefined
      if (body?.mfa_required && typeof body.mfa_token === 'string') {
        setMfaToken(body.mfa_token)
        setMfaRequired(true)
        return
      }

      // HTTP-only session cookie is set by the server automatically.
      if (claimRedirect) {
        router.push('/profile?claimed=1')
      } else {
        router.push(nextPath)
      }
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

    // /auth/mfa/verify isn't in the OpenAPI spec yet (tracked as a followup),
    // so we hit it with fetch directly. The bearer token here is the short
    // mfa_pending token returned by /auth/login above — not a session token.
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

      if (claimRedirect) {
        router.push('/profile?claimed=1')
      } else {
        router.push(nextPath)
      }
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
        Welcome back to Painttrace.
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
