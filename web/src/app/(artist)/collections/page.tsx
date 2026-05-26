'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Collection = components['schemas']['Collection']

export default function CollectionsPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await apiClient.GET('/profiles/me', {})
      if (res.error) return null
      return res.data ?? null
    },
  })

  const collectionsQuery = useQuery({
    queryKey: ['collections', profileQuery.data?.id],
    queryFn: async () => {
      const profileId = profileQuery.data?.id
      if (!profileId) return []
      const res = await apiClient.GET('/profiles/{profileID}/collections', {
        params: { path: { profileID: profileId } },
      })
      return res.data ?? []
    },
    enabled: !!profileQuery.data?.id,
  })

  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await apiClient.POST('/collections', { body: { name, description } })
      if (res.error) throw new Error('Failed to create collection')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      setCreating(false)
      setNewName('')
      setNewDesc('')
    },
    onError: (err: Error) => setCreateError(err.message),
  })

  const archiveMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      const res = await apiClient.PATCH('/collections/{collectionID}', {
        params: { path: { collectionID: collectionId } },
        body: { status: 'archived' },
      })
      if (res.error) throw new Error('Failed to archive collection')
      return res.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
  })

  const collections: Collection[] = (collectionsQuery.data ?? []) as Collection[]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-4xl text-ink">Collections</h1>
        <button
          onClick={() => setCreating(true)}
          className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          New collection
        </button>
      </div>

      {creating && (
        <div className="mb-6 p-5 bg-warm border border-light rounded-lg">
          <h2 className="font-serif text-xl text-ink mb-4">New collection</h2>
          <div className="space-y-3 max-w-sm">
            <input
              type="text"
              placeholder="Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            />
            <textarea
              placeholder="Description"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              rows={2}
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none"
            />
            {createError && <p role="alert" className="font-sans text-sm text-clay">{createError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate({ name: newName, description: newDesc })}
                disabled={!newName.trim() || createMutation.isPending}
                className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setCreating(false)} className="font-sans text-sm text-mid hover:text-ink px-4 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {collectionsQuery.isLoading && <p className="font-sans text-mid text-sm">Loading…</p>}

      {collections.length === 0 && !collectionsQuery.isLoading && (
        <p className="font-sans text-mid">No collections yet. Create one to get started.</p>
      )}

      <ul className="space-y-3">
        {collections.map((c) => (
          <li key={c.id} className="flex items-center justify-between p-4 bg-warm border border-light rounded-lg">
            <div>
              <Link href={`/collections/${c.id}`} className="font-serif text-xl text-ink hover:text-amber transition-colors">
                {c.name}
              </Link>
              {c.description && <p className="font-sans text-sm text-mid mt-0.5">{c.description}</p>}
              <span className="font-mono text-xs text-mid uppercase tracking-wider mt-1 inline-block">{c.status}</span>
            </div>
            {c.status !== 'archived' && (
              <button
                onClick={() => archiveMutation.mutate(c.id)}
                disabled={archiveMutation.isPending}
                className="font-sans text-xs text-mid hover:text-clay transition-colors ml-4"
              >
                Archive
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
