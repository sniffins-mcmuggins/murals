'use client'

import { useState, FormEvent } from 'react'
import { apiClient } from '@/lib/api'

interface MfaFormProps {
  /** Short-lived mfa_pending token returned by POST /auth/login. */
  mfaToken: string
  /** Return to the email/password step. */
  onBack: () => void
  /** Called after the code is verified and the session cookie is set. */
  onVerified: () => void
}

/**
 * The second step of an MFA login: collect the 6-digit TOTP code and exchange
 * the mfa_pending token for a real session. Split out of the login page so the
 * branch is independently testable and the page reads as a single state switch.
 */
export function MfaForm({ mfaToken, onBack, onVerified }: MfaFormProps) {
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!/^[0-9]{6}$/.test(totpCode)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }

    setPending(true)

    // The bearer token here is the short-lived mfa_pending token — NOT a
    // session token — so we override the per-request Authorization header
    // rather than relying on the cookie.
    try {
      const { response } = await apiClient.POST('/auth/mfa/verify', {
        headers: { Authorization: `Bearer ${mfaToken}` },
        body: { code: totpCode },
      })

      if (!response.ok) {
        setError('Invalid code. Check your authenticator app.')
        return
      }

      onVerified()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
      <h1 className="font-serif text-3xl text-ink mb-2">
        Two-factor authentication
      </h1>
      <p className="font-sans text-mid text-sm mb-8">
        Enter the 6-digit code from your authenticator app.
      </p>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label htmlFor="totp" className="block font-sans text-sm text-ink mb-1">
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
          onClick={onBack}
          className="text-ink underline underline-offset-2"
        >
          Back to sign in
        </button>
      </p>
    </div>
  )
}
