'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'

type Role = 'artist' | 'organiser'

export default function SignupPage() {
  const searchParams = useSearchParams()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('artist')
  const [inviteCode, setInviteCode] = useState('')
  const [claimToken, setClaimToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [verified, setVerified] = useState(false)
  const [resendPending, setResendPending] = useState(false)
  const [resendDone, setResendDone] = useState(false)

  useEffect(() => {
    const code = searchParams.get('invite')
    if (code) setInviteCode(code)
    const claim = searchParams.get('claim')
    if (claim) setClaimToken(claim)
  }, [searchParams])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    try {
      const body = { 
        email, 
        password, 
        role, 
        ...(inviteCode ? { invite_code: inviteCode } : {}),
        ...(claimToken ? { claim_token: claimToken } : {}),
      }

      const { response } = await apiClient.POST('/auth/signup', {
        body,
      })

      if (response.status === 403) {
        setError('A valid invite code is required to sign up.')
        return
      }

      if (response.status === 409) {
        setError('Email already registered')
        return
      }

      if (response.status === 422) {
        setError('Please check your details and try again.')
        return
      }

      if (!response.ok) {
        setError('Something went wrong. Please try again.')
        return
      }

      setVerified(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function handleResend() {
    setResendPending(true)
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setResendDone(true)
    } finally {
      setResendPending(false)
    }
  }

  if (verified) {
    return (
      <main className="min-h-screen bg-warm flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
          <h1 className="font-serif text-3xl text-ink mb-2">Check your inbox</h1>
          <p className="font-sans text-mid text-sm mb-6">
            We sent a verification link to <strong>{email}</strong>. Click it to activate your account.
          </p>
          {resendDone ? (
            <p className="font-sans text-sm text-mid">Verification email resent.</p>
          ) : (
            <p className="font-sans text-sm text-mid">
              Didn&apos;t get it?{' '}
              <button
                type="button"
                onClick={handleResend}
                disabled={resendPending}
                className="text-ink underline underline-offset-2 disabled:opacity-50"
              >
                {resendPending ? 'Sending…' : 'Resend verification email'}
              </button>
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-warm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
        <h1 className="font-serif text-3xl text-ink mb-2">Create account</h1>
        <p className="font-sans text-mid text-sm mb-8">
          Join the Render platform for paint festival artists and organisers.
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
              <span className="text-mid ml-1 font-mono text-xs">(min 8 chars)</span>
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
              placeholder="••••••••"
            />
          </div>

          <div>
            <label
              htmlFor="role"
              className="block font-sans text-sm text-ink mb-1"
            >
              I am a…
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            >
              <option value="artist">Artist</option>
              <option value="organiser">Festival organiser</option>
            </select>
          </div>

          {inviteCode && (
            <div>
              <label htmlFor="invite" className="block font-sans text-sm text-ink mb-1">
                Invite code
              </label>
              <input
                id="invite"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full border border-light rounded-lg px-3 py-2 font-mono text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
                placeholder="FOUNDING-XXXX"
              />
            </div>
          )}

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
            {pending ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 font-sans text-sm text-mid text-center">
          Already have an account?{' '}
          <Link href="/login" className="text-ink underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
