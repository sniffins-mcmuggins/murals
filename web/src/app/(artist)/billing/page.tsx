'use client'

import { useState } from 'react'
import { PricingCard } from '@/components/PricingCard'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

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

  async function handleUpgrade(priceId: string) {
    if (!priceId) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/billing/artist/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_id: priceId }),
      })
      if (!res.ok) {
        setLoading(false)
        return
      }
      const data = await res.json() as { checkout_url?: string }
      if (data.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch {
      setLoading(false)
    }
  }

  async function handleManage() {
    try {
      const res = await fetch(`${API_URL}/billing/portal`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) return
      const data = await res.json() as { portal_url?: string }
      if (data.portal_url) {
        window.location.href = data.portal_url
      }
    } catch {
      // noop
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="font-serif text-4xl text-ink mb-2">Artist plans</h1>
      <p className="font-sans text-mid mb-8">
        All plans include a public profile and festival applications. Upgrade for more collections.
      </p>

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
