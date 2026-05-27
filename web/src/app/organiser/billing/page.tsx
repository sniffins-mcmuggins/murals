'use client'

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export default function OrgBillingPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<'setup' | 'manage' | null>(null)

  async function handleSetup() {
    setError(null)
    setLoading('setup')
    try {
      const res = await fetch(`${API_URL}/billing/organiser/setup-checkout`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        if (res.status === 409) {
          setError('Setup fee has already been paid for this account.')
        } else if (res.status === 401 || res.status === 403) {
          setError('Please log in with your organiser account to pay the setup fee.')
        } else {
          setError('Could not start checkout. Please try again.')
        }
        return
      }
      const data = (await res.json()) as { checkout_url?: string }
      if (!data.checkout_url) {
        setError('Stripe did not return a checkout URL. Please try again.')
        return
      }
      window.location.href = data.checkout_url
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(null)
    }
  }

  async function handleManage() {
    setError(null)
    setLoading('manage')
    try {
      const res = await fetch(`${API_URL}/billing/portal`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        setError(
          res.status === 404
            ? 'No billing account yet. Pay the setup fee above to get started.'
            : 'Could not open the billing portal. Please try again.',
        )
        return
      }
      const data = (await res.json()) as { portal_url?: string }
      if (!data.portal_url) {
        setError('Stripe did not return a portal URL. Please try again.')
        return
      }
      window.location.href = data.portal_url
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-serif text-4xl text-ink mb-8">Organiser billing</h1>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-clay bg-clay/10 px-4 py-3 text-clay font-medium"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6">
        <div className="border border-light rounded-xl p-8">
          <h2 className="font-semibold mb-2">Setup fee</h2>
          <p className="text-mid mb-4">
            One-time £35 to activate your organiser account and publish your first festival.
          </p>
          <button
            type="button"
            onClick={handleSetup}
            disabled={loading === 'setup'}
            className="bg-amber text-ink font-semibold border-none rounded-md px-6 py-3 cursor-pointer disabled:opacity-50"
          >
            {loading === 'setup' ? 'Loading…' : 'Pay setup fee — £35'}
          </button>
        </div>

        <div className="border border-light rounded-xl p-8">
          <h2 className="font-semibold mb-2">Festival costs</h2>
          <ul className="text-mid list-none p-0 flex flex-col gap-2">
            <li>£99 — Festival activation (one-off, per festival)</li>
            <li>£49/yr — Annual listing fee (keeps festival page live after the event)</li>
          </ul>
          <p className="mt-4 text-sm text-mid">
            Festival activation is paid from the festival&apos;s edit page once your application
            form is ready.
          </p>
        </div>

        <div className="border-t border-light pt-6">
          <button
            type="button"
            onClick={handleManage}
            disabled={loading === 'manage'}
            className="text-amber font-semibold bg-transparent border-none cursor-pointer p-0 disabled:opacity-50"
          >
            {loading === 'manage' ? 'Loading…' : 'Manage billing & payment methods →'}
          </button>
        </div>
      </div>
    </div>
  )
}
