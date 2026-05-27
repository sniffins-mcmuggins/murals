'use client'

import { useState } from 'react'

export type FormField = {
  id?: string
  type: 'text' | 'textarea' | 'select' | string
  label: string
  required?: boolean
  options?: string[]
}

type Props = {
  fields: FormField[]
  onSubmit: (answers: Record<string, string>) => void
  submitting?: boolean
}

export default function DynamicForm({ fields, onSubmit, submitting = false }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.id ?? f.label, ''])),
  )

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(values)
  }

  return (
    <form aria-label="Application form" onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => {
        const key = field.id ?? field.label
        const htmlId = `field-${key.replace(/\s+/g, '-').toLowerCase()}`
        return (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={htmlId} className="font-sans text-sm text-ink font-medium">
              {field.label}
              {field.required && <span className="text-clay ml-1" aria-hidden="true">*</span>}
            </label>

            {field.type === 'textarea' ? (
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
