'use client'

type Props = {
  value: string
  onChange: (next: string) => void
}

export function SupportLinkField({ value, onChange }: Props) {
  return (
    <div>
      <input
        type="url"
        inputMode="url"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="https://buymeacoffee.com/yourname"
        aria-label="Support link"
        data-testid="support-link-input"
        className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
      />
      <p className="mt-1 font-sans text-xs text-mid">
        Buy Me a Coffee, Ko-fi, Patreon, or any link where people can support you. Optional.
      </p>
    </div>
  )
}
