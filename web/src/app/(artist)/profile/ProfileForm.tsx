'use client'

import { useState, FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type ArtistProfile = components['schemas']['ArtistProfile']

type Props = {
  profile: ArtistProfile | null
  userId: string
}

export default function ProfileForm({ profile, userId }: Props) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [location, setLocation] = useState(profile?.location_label ?? '')
  const [mediumTags, setMediumTags] = useState((profile?.medium_tags ?? []).join(', '))
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (data: { displayName: string; bio: string; locationLabel: string; mediumTags: string[] }) => {
      if (!profile) {
        const res = await apiClient.POST('/profiles', { body: { displayName: data.displayName } })
        if (res.error) throw new Error('Failed to create profile')
        // After create, patch with remaining fields
        await apiClient.PATCH('/profiles/me', {
          body: { bio: data.bio, locationLabel: data.locationLabel, mediumTags: data.mediumTags },
        })
        return res.data
      } else {
        const res = await apiClient.PATCH('/profiles/me', {
          body: { displayName: data.displayName, bio: data.bio, locationLabel: data.locationLabel, mediumTags: data.mediumTags },
        })
        if (res.error) throw new Error('Failed to update profile')
        return res.data
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    mutation.mutate({
      displayName,
      bio,
      locationLabel: location,
      mediumTags: mediumTags.split(',').map(t => t.trim()).filter(Boolean),
    })
  }

  // userId is used by the parent to identify the current user context
  void userId

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-5">
      <div>
        <label className="block font-sans text-sm text-ink mb-1">Display name</label>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          required
          className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
        />
      </div>
      <div>
        <label className="block font-sans text-sm text-ink mb-1">Bio</label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          rows={4}
          className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none"
        />
      </div>
      <div>
        <label className="block font-sans text-sm text-ink mb-1">Location</label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder="e.g. Cheltenham, UK"
          className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
        />
      </div>
      <div>
        <label className="block font-sans text-sm text-ink mb-1">Medium tags</label>
        <input
          type="text"
          value={mediumTags}
          onChange={e => setMediumTags(e.target.value)}
          placeholder="mural, stencil, paste-up"
          className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
        />
        <p className="mt-1 font-sans text-xs text-mid">Comma-separated list of mediums.</p>
      </div>

      {error && <p role="alert" className="font-sans text-sm text-clay">{error}</p>}
      {success && <p role="status" className="font-sans text-sm text-amber">Saved!</p>}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="bg-amber text-ink font-sans font-medium text-sm rounded-lg px-6 py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {mutation.isPending ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  )
}
