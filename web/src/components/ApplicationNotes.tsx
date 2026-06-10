'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { formatDate } from '@/lib/dates'
import type { components } from '@render/api-client'

type ApplicationNote = components['schemas']['ApplicationNote']

interface Props {
  festivalId: string
  applicationId: string
  notes: ApplicationNote[]
}

export function ApplicationNotes({ festivalId, applicationId, notes }: Props) {
  const [content, setContent] = useState('')
  const queryClient = useQueryClient()

  const addNote = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiClient.POST(
        '/festivals/{festivalID}/applications/{applicationID}/notes',
        {
          params: { path: { festivalID: festivalId, applicationID: applicationId } },
          body: { content: text },
        }
      )
      if (res.error) throw new Error('Failed to add note')
      return res.data
    },
    onSuccess: () => {
      setContent('')
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (content.trim()) addNote.mutate(content.trim())
  }

  return (
    <div>
      <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-3">Internal Notes</h3>

      {notes.length === 0 && (
        <p className="font-sans text-xs text-mid mb-4">No notes yet.</p>
      )}

      {notes.length > 0 && (
        <ul className="space-y-3 mb-4">
          {notes.map(note => (
            <li key={note.id} className="bg-white border border-light rounded-lg p-3">
              <p className="font-sans text-sm text-ink">{note.content}</p>
              <p className="font-sans text-xs text-mid mt-1">{formatDate(note.created_at ?? '')}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          className="font-sans text-sm text-ink bg-white border border-light rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-amber"
        />
        <button
          type="submit"
          disabled={!content.trim() || addNote.isPending}
          className="self-end font-sans text-xs font-semibold bg-amber text-ink px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {addNote.isPending ? 'Adding…' : 'Add note'}
        </button>
      </form>
    </div>
  )
}
