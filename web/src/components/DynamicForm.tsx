'use client'

import { useState } from 'react'
import { parseEmbed } from '@/lib/embeds'
import { linkIconForPrefill } from '@/lib/favicon'
import { Favicon } from './Favicon'
import { SocialIcon } from './SocialIcon'

export type FormField = {
  id?: string
  type: 'text' | 'textarea' | 'select' | 'embed' | string
  label: string
  required?: boolean
  options?: string[]
  /** Optional binding to a profile attribute — pre-fills this field (E28 M2). */
  prefill?: string
}

export type CollectionOption = { id: string; name: string; url: string }

type Props = {
  fields: FormField[]
  onSubmit: (answers: Record<string, string>) => void
  submitting?: boolean
  /** Pre-filled values keyed by field id/label (E28 M2 — from the artist profile). */
  initialValues?: Record<string, string>
  /** Collections for any `portfolio_collection`-bound field's picker. */
  collections?: CollectionOption[]
}

export default function DynamicForm({
  fields,
  onSubmit,
  submitting = false,
  initialValues,
  collections = [],
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.id ?? f.label, initialValues?.[f.id ?? f.label] ?? ''])),
  )
  // Per-link "Share" state (E28 link fields). Default: shared iff the link is pre-filled.
  const [shared, setShared] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      fields
        .filter((f) => linkIconForPrefill(f.prefill) !== null)
        .map((f) => [f.id ?? f.label, !!(initialValues?.[f.id ?? f.label] ?? '').trim()]),
    ),
  )

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // An un-shared link contributes an empty answer (excluded from the application).
    const answers: Record<string, string> = { ...values }
    for (const key of Object.keys(shared)) {
      if (!shared[key]) answers[key] = ''
    }
    onSubmit(answers)
  }

  return (
    <form aria-label="Application form" onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => {
        const key = field.id ?? field.label
        const htmlId = `field-${key.replace(/\s+/g, '-').toLowerCase()}`
        const link = linkIconForPrefill(field.prefill)
        const isPrefilled = !!field.prefill && !!(values[key] ?? '').trim()

        if (link) {
          const isShared = shared[key] ?? false
          return (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={htmlId} className="font-sans text-sm text-ink font-medium">
                {field.label}
              </label>
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0">
                  {link.kind === 'favicon'
                    ? <Favicon platform={link.platform} src={link.src} label={field.label} />
                    : <SocialIcon platform="website" className="w-4 h-4 text-mid" />}
                </span>
                <input
                  id={htmlId}
                  type="url"
                  name={key}
                  value={values[key] ?? ''}
                  disabled={!isShared}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber disabled:opacity-50 disabled:bg-warm"
                />
                <label className="flex items-center gap-1.5 font-sans text-xs text-mid whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="accent-amber"
                    checked={isShared}
                    aria-label={`Share ${field.label}`}
                    onChange={(e) => setShared((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  Share
                </label>
              </div>
              {isPrefilled && isShared && (
                <span className="font-sans text-xs text-mid">From your profile — edit if needed.</span>
              )}
            </div>
          )
        }

        return (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={htmlId} className="font-sans text-sm text-ink font-medium">
              {field.label}
              {field.required && <span className="text-clay ml-1" aria-hidden="true">*</span>}
            </label>

            {field.prefill === 'portfolio_collection' && collections.length > 0 ? (
              <select
                id={htmlId}
                name={key}
                required={field.required}
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
              >
                <option value="">Choose a collection…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.url}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                id={htmlId}
                name={key}
                required={field.required}
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                rows={4}
                className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none"
              />
            ) : field.type === 'select' ? (
              <select
                id={htmlId}
                name={key}
                required={field.required}
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === 'embed' ? (
              <div className="flex flex-col gap-1">
                <input
                  id={htmlId}
                  type="url"
                  name={key}
                  required={field.required}
                  value={values[key] ?? ''}
                  onChange={(e) => handleChange(key, e.target.value)}
                  placeholder="https://youtube.com/… or vimeo.com/… or sketchfab.com/…"
                  className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
                />
                {values[key]
                  ? parseEmbed(values[key])
                    ? <span className="font-mono text-xs text-mid uppercase tracking-widest">{parseEmbed(values[key])!.provider} link ✓</span>
                    : <span role="alert" className="font-sans text-xs text-clay">Paste a YouTube, Vimeo or Sketchfab link.</span>
                  : null}
              </div>
            ) : (
              <input
                id={htmlId}
                type="text"
                name={key}
                required={field.required}
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
              />
            )}

            {isPrefilled && (
              <span className="font-sans text-xs text-mid">From your profile — edit if needed.</span>
            )}
          </div>
        )
      })}

      <button
        type="submit"
        disabled={submitting}
        className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {submitting ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
  )
}
