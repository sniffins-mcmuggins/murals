'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { FormField } from '@/components/DynamicForm'
import { QUESTION_LIBRARY, STARTER_TEMPLATE } from '@/lib/questionLibrary'

type BuilderField = FormField & { id: string }

const FIELD_TYPES: { value: BuilderField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'select', label: 'Dropdown' },
  { value: 'embed', label: 'Media embed' },
]

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random()}`
}

function withId(f: Omit<FormField, 'id'>): BuilderField {
  return { ...f, id: newId() }
}

export default function FormBuilderClient({ festivalId }: { festivalId: string }) {
  const [fields, setFields] = useState<BuilderField[]>([])
  const [showLibrary, setShowLibrary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      return res.data ?? { fields: [] }
    },
  })

  useEffect(() => {
    if (!formQuery.data) return
    const loaded = ((formQuery.data as { fields?: FormField[] }).fields ?? []).map(f => ({
      ...f,
      id: (f as BuilderField).id ?? newId(),
    })) as BuilderField[]
    setFields(loaded)
  }, [formQuery.data])

  function update(id: string, patch: Partial<BuilderField>) {
    setFields(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) {
    setFields(prev => prev.filter(f => f.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    setFields(prev => {
      const i = prev.findIndex(f => f.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    // Client-side guard mirrors the server: labels required, selects need options.
    for (const f of fields) {
      if (!f.label.trim()) { setSaveError('Every field needs a label.'); setSaving(false); return }
      if (f.type === 'select' && (f.options ?? []).filter(o => o.trim()).length === 0) {
        setSaveError(`"${f.label}" is a dropdown but has no options.`); setSaving(false); return
      }
    }
    const res = await apiClient.PUT('/festivals/{festivalID}/form', {
      params: { path: { festivalID: festivalId } },
      body: { fields: fields as unknown as Record<string, never>[] },
    })
    setSaving(false)
    if (res.error) { setSaveError('Could not save the form.'); return }
    setSaved(true)
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">Application form</h1>
      <p className="font-sans text-sm text-mid mb-6">Build the questions artists answer when they apply.</p>

      {fields.length === 0 && (
        <button
          onClick={() => setFields(STARTER_TEMPLATE.map(withId))}
          className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 mb-6"
        >
          Start from a template
        </button>
      )}

      <ul className="space-y-3 max-w-2xl" data-testid="builder-fields">
        {fields.map((f, idx) => (
          <li key={f.id} className="p-4 bg-warm border border-light rounded-lg space-y-2">
            <div className="flex gap-2 items-center">
              <select
                aria-label="Field type"
                value={f.type}
                onChange={e => update(f.id, { type: e.target.value as BuilderField['type'] })}
                className="border border-light rounded-lg px-2 py-1.5 font-sans text-sm bg-offwhite"
              >
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                aria-label="Field label"
                value={f.label}
                onChange={e => update(f.id, { label: e.target.value })}
                placeholder="Question label"
                className="flex-1 border border-light rounded-lg px-3 py-1.5 font-sans text-sm bg-offwhite"
              />
              <label className="font-sans text-xs text-mid flex items-center gap-1">
                <input type="checkbox" className="accent-amber" checked={f.required ?? false}
                  onChange={e => update(f.id, { required: e.target.checked })} />
                Required
              </label>
              <button aria-label="Move up" onClick={() => move(f.id, -1)} disabled={idx === 0}
                className="text-mid hover:text-ink disabled:opacity-30">▲</button>
              <button aria-label="Move down" onClick={() => move(f.id, 1)} disabled={idx === fields.length - 1}
                className="text-mid hover:text-ink disabled:opacity-30">▼</button>
              <button aria-label="Delete field" onClick={() => remove(f.id)}
                className="text-clay hover:opacity-80">✕</button>
            </div>

            {f.type === 'select' && (
              <input
                aria-label="Dropdown options"
                value={(f.options ?? []).join(', ')}
                onChange={e => update(f.id, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
                placeholder="Comma-separated options (e.g. Small, Medium, Large)"
                className="w-full border border-light rounded-lg px-3 py-1.5 font-sans text-sm bg-offwhite"
              />
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-3 items-center mt-4 max-w-2xl">
        <button onClick={() => setFields(prev => [...prev, withId({ type: 'text', label: '' })])}
          className="font-sans text-sm border border-light rounded-lg px-4 py-2 hover:border-amber">
          + Add field
        </button>
        <button onClick={() => setShowLibrary(v => !v)}
          className="font-sans text-sm border border-light rounded-lg px-4 py-2 hover:border-amber">
          Add from library
        </button>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving}
          className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save form'}
        </button>
      </div>
      {saveError && <p role="alert" className="font-sans text-sm text-clay mt-2">{saveError}</p>}
      {saved && <p className="font-sans text-sm text-mid mt-2">Saved ✓</p>}

      {showLibrary && (
        <div className="mt-6 p-4 bg-offwhite border border-light rounded-lg max-w-2xl" data-testid="library-panel">
          <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-3">Question library</h2>
          {Array.from(new Set(QUESTION_LIBRARY.map(p => p.group))).map(group => (
            <div key={group} className="mb-3">
              <p className="font-sans text-xs text-mid mb-1">{group}</p>
              <div className="flex flex-wrap gap-2">
                {QUESTION_LIBRARY.filter(p => p.group === group).map(p => (
                  <button key={p.label}
                    onClick={() => setFields(prev => [...prev, withId({ type: p.type, label: p.label, required: p.required, options: p.options })])}
                    className="font-sans text-xs border border-light rounded-full px-3 py-1 hover:border-amber">
                    + {p.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
