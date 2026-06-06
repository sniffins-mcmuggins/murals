'use client'

import { useState, KeyboardEvent } from 'react'
import { MEDIUMS } from '@/lib/mediums'

type Props = {
  value: string[]
  onChange: (next: string[]) => void
}

export function MediumPicker({ value, onChange }: Props) {
  const [custom, setCustom] = useState('')

  function toggle(tag: string) {
    onChange(value.includes(tag) ? value.filter(t => t !== tag) : [...value, tag])
  }

  function addCustom() {
    const t = custom.trim().toLowerCase()
    if (t && !value.includes(t)) onChange([...value, t])
    setCustom('')
  }

  function onCustomKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustom()
    }
  }

  // Custom values the artist already has that aren't in the canonical list.
  const extras = value.filter(t => !MEDIUMS.includes(t as (typeof MEDIUMS)[number]))

  return (
    <div data-testid="medium-picker">
      <div className="flex flex-wrap gap-2">
        {MEDIUMS.map(tag => {
          const on = value.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              className={`font-sans text-sm rounded-full px-3 py-1.5 border transition-colors ${
                on
                  ? 'bg-amber border-amber text-ink'
                  : 'bg-offwhite border-light text-mid hover:border-amber'
              }`}
            >
              {tag}
            </button>
          )
        })}
        {extras.map(tag => (
          <button
            key={tag}
            type="button"
            aria-pressed
            onClick={() => toggle(tag)}
            className="font-sans text-sm rounded-full px-3 py-1.5 border bg-amber border-amber text-ink"
          >
            {tag} ✕
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={onCustomKey}
          placeholder="Add your own…"
          aria-label="Add a custom medium"
          className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
        />
        <button
          type="button"
          onClick={addCustom}
          className="font-sans text-sm rounded-lg px-4 py-2 border border-light text-ink hover:border-amber"
        >
          Add
        </button>
      </div>
    </div>
  )
}
