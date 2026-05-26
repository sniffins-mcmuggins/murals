'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

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

      // HTTP-only session cookie is set by the server automatically.
      router.push(nextPath)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="min-h-screen bg-warm flex items-center justify-center p-4">
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

        <p className="mt-6 font-sans text-sm text-mid text-center">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-ink underline underline-offset-2">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  )
}
