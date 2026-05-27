'use client'

interface PricingCardProps {
  name: string
  annualPrice: string
  monthlyPrice: string
  features: string[]
  highlight?: boolean
  ctaLabel: string
  onCTA: () => void
  current?: boolean
}

export function PricingCard({
  name,
  annualPrice,
  monthlyPrice,
  features,
  highlight,
  ctaLabel,
  onCTA,
  current,
}: PricingCardProps) {
  return (
    <div
      className={[
        'flex flex-col gap-4 rounded-xl bg-offwhite p-8 min-w-[260px]',
        highlight ? 'border-2 border-amber' : 'border border-light',
      ].join(' ')}
    >
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-mid">{name}</p>
        <p className="font-serif text-4xl leading-none text-ink">
          {annualPrice}
          <span className="text-base text-mid">/yr</span>
        </p>
        <p className="text-sm text-mid">or {monthlyPrice}/mo</p>
      </div>
      <ul className="flex flex-col gap-2 list-none p-0 m-0">
        {features.map((f) => (
          <li key={f} className="text-sm text-ink flex gap-2">
            <span className="text-amber">✓</span> {f}
          </li>
        ))}
      </ul>
      {current ? (
        <p className="text-center text-mid font-semibold p-3">Current plan</p>
      ) : (
        <button
          type="button"
          onClick={onCTA}
          className={[
            'rounded-md p-3 font-semibold cursor-pointer',
            highlight
              ? 'bg-amber text-ink border-none'
              : 'bg-transparent text-amber border-2 border-amber',
          ].join(' ')}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
