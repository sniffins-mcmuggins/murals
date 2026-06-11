'use client'

import { useState } from 'react'
import { PricingCard } from '@/components/PricingCard'
import { apiClient } from '@/lib/api'

const PLANS = {
  basic: {
    name: 'Basic',
    annualPrice: '£15',
    monthlyPrice: '£2',
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_BASIC_ANNUAL ?? '',
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_BASIC_MONTHLY ?? '',
    features: ['1 collection', 'Public artist profile', 'Festival applications'],
    highlight: false,
  },
  pro: {
    name: 'Pro',
    annualPrice: '£25',
    monthlyPrice: '£4',
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_PRO_ANNUAL ?? '',
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_PRO_MONTHLY ?? '',
    features: ['Up to 5 collections', 'Everything in Basic', 'Priority in search results'],
    highlight: true,
  },
} as const

export default function ArtistBillingPage() {
  const [billingInterval, setBillingInterval] = useState<'year' | 'month'>('year')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpgrade(priceId: string) {
    if (!priceId) {
      setError('Plan is not configured. Please contact support.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data, response } = await apiClient.POST('/billing/artist/checkout', {
        body: { price_id: priceId },
      })
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Please log in again to subscribe.'
            : 'Could not start checkout. Please try again.',
        )
        return
      }
      if (!data?.checkout_url) {
        setError('Stripe did not return a checkout URL. Please try again.')
        return
      }
      window.location.href = data.checkout_url
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleManage() {
    setError(null)
    try {
      const { data, response } = await apiClient.POST('/billing/portal', {})
      if (!response.ok) {
        setError(
          response.status === 404
            ? 'No active subscription to manage. Choose a plan above to get started.'
            : 'Could not open the billing portal. Please try again.',
        )
        return
      }
      if (!data?.portal_url) {
        setError('Stripe did not return a portal URL. Please try again.')
        return
      }
      window.location.href = data.portal_url
    } catch {
      setError('Network error. Please check your connection and try again.')
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="font-serif text-4xl text-ink mb-2">Artist plans</h1>
      <p className="font-sans text-mid mb-8">
        All plans include a public profile and festival applications. Upgrade for more collections.
      </p>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-clay bg-clay/10 px-4 py-3 text-clay font-medium"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2 mb-8">
        {(['year', 'month'] as const).map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setBillingInterval(i)}
            className={[
              'px-5 py-2 rounded-md border border-light font-semibold cursor-pointer',
              billingInterval === i ? 'bg-ink text-offwhite' : 'bg-transparent text-ink',
            ].join(' ')}
          >
            {i === 'year' ? 'Annual (save ~17%)' : 'Monthly'}
          </button>
        ))}
      </div>

      <div className="flex gap-6 flex-wrap">
        {Object.entries(PLANS).map(([key, plan]) => (
          <PricingCard
            key={key}
            name={plan.name}
            annualPrice={plan.annualPrice}
            monthlyPrice={plan.monthlyPrice}
            features={[...plan.features]}
            highlight={plan.highlight}
            ctaLabel={loading ? 'Loading…' : `Get ${plan.name}`}
            onCTA={() => handleUpgrade(billingInterval === 'year' ? plan.annualPriceId : plan.monthlyPriceId)}
          />
        ))}
      </div>

      <div className="mt-12 p-6 bg-warm rounded-lg">
        <p className="font-semibold mb-2">Already subscribed?</p>
        <button
          type="button"
          onClick={handleManage}
          className="text-amber font-semibold bg-transparent border-none cursor-pointer p-0"
        >
          Manage billing →
        </button>
      </div>
    </div>
  )
}
