'use client'

import { useState } from 'react'

export type FormField = {
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
    Object.fromEntries(fields.map((f) => [f.label, ''])),
  )

  function handleChange(label: string, value: string) {
    setValues((prev) => ({ ...prev, [label]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(values)
  }

  return (
    <form aria-label="Application form" onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => {
        const id = `field-${field.label.replace(/\s+/g, '-').toLowerCase()}`
        return (
          <div key={field.label} className="flex flex-col gap-1">
            <label htmlFor={id} className="font-sans text-sm text-ink font-medium">
              {field.label}
              {field.required && <span className="text-clay ml-1" aria-hidden="true">*</span>}
            </label>

            {field.type === 'textarea' ? (
              <textarea
                id={id}
                name={field.label}
                required={field.required}
                value={values[field.label] ?? ''}
                onChange={(e) => handleChange(field.label, e.target.value)}
                rows={4}
                className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none"
              />
            ) : field.type === 'select' ? (
              <select
                id={id}
                name={field.label}
                required={field.required}
                value={values[field.label] ?? ''}
                onChange={(e) => handleChange(field.label, e.target.value)}
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
              /* text + unknown types fall back to text input */
              <input
                id={id}
                type="text"
                name={field.label}
                required={field.required}
                value={values[field.label] ?? ''}
                onChange={(e) => handleChange(field.label, e.target.value)}
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
