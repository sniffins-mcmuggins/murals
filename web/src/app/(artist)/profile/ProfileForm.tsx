'use client'

import { useState, FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'
import { SocialIcon, SOCIAL_PLATFORMS } from '@/components/SocialIcon'

type ArtistProfile = components['schemas']['ArtistProfile']

type Props = {
  profile: ArtistProfile | null
  userId: string
}

function initSocialLinks(profile: ArtistProfile | null): Record<string, string> {
  const links: Record<string, string> = {}
  for (const { key } of SOCIAL_PLATFORMS) {
    links[key] = profile?.social_links?.[key] ?? ''
  }
  return links
}

export default function ProfileForm({ profile, userId }: Props) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [location, setLocation] = useState(profile?.location_label ?? '')
  const [mediumTags, setMediumTags] = useState((profile?.medium_tags ?? []).join(', '))
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>(() => initSocialLinks(profile))
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (data: {
      displayName: string
      bio: string
      locationLabel: string
      mediumTags: string[]
      socialLinks: Record<string, string>
    }) => {
      const filteredLinks = Object.fromEntries(
        Object.entries(data.socialLinks).filter(([, v]) => v.trim() !== '')
      )
      if (!profile) {
        const res = await apiClient.POST('/profiles', { body: { displayName: data.displayName } })
        if (res.error) throw new Error('Failed to create profile')
        await apiClient.PATCH('/profiles/me', {
          body: {
            bio: data.bio,
            locationLabel: data.locationLabel,
            mediumTags: data.mediumTags,
            socialLinks: filteredLinks,
          },
        })
        return res.data
      } else {
        const res = await apiClient.PATCH('/profiles/me', {
          body: {
            displayName: data.displayName,
            bio: data.bio,
            locationLabel: data.locationLabel,
            mediumTags: data.mediumTags,
            socialLinks: filteredLinks,
          },
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
      socialLinks,
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
          name="displayName"
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

      <fieldset>
        <legend className="block font-sans text-sm text-ink mb-3">Social links</legend>
        <div className="space-y-2">
          {SOCIAL_PLATFORMS.map(({ key, label, placeholder }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-mid shrink-0" aria-label={label}>
                <SocialIcon platform={key} />
              </span>
              <input
                type="url"
                aria-label={label}
                value={socialLinks[key] ?? ''}
                onChange={e => setSocialLinks(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
              />
            </div>
          ))}
        </div>
      </fieldset>

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
