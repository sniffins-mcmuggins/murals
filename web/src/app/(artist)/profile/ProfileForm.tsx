'use client'

import { useState, FormEvent, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'
import { SocialIcon, SOCIAL_PLATFORMS } from '@/components/SocialIcon'
import { useProfileImageUpload } from '@/hooks/useProfileImageUpload'

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

const MAX_HEADLINE = 3

function ImageSlot({
  url,
  label,
  round,
  onFile,
  isUploading,
}: {
  url: string | null
  label: string
  round?: boolean
  onFile: (file: File) => void
  isUploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const shape = round ? 'rounded-full' : 'rounded-lg'
  const size = round ? 'w-24 h-24' : 'w-full h-40'

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className={`${size} ${shape} border-2 border-dashed border-light bg-warm flex items-center justify-center overflow-hidden hover:border-amber transition-colors disabled:opacity-50 relative`}
        aria-label={`Upload ${label}`}
      >
        {url ? (
          <img src={url} alt={label} className={`${size} ${shape} object-cover`} />
        ) : (
          <span className="font-mono text-xs uppercase tracking-widest text-mid">
            {isUploading ? '…' : '+'}
          </span>
        )}
      </button>
      <span className="font-sans text-xs text-mid">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export default function ProfileForm({ profile, userId }: Props) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [location, setLocation] = useState(profile?.location_label ?? '')
  const [mediumTags, setMediumTags] = useState((profile?.medium_tags ?? []).join(', '))
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>(() => initSocialLinks(profile))
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_s3_key ?? null)
  const [headlineUrls, setHeadlineUrls] = useState<(string | null)[]>(() => {
    const existing = profile?.headline_image_urls ?? []
    return [existing[0] ?? null, existing[1] ?? null, existing[2] ?? null]
  })
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { upload: uploadAvatar, isUploading: avatarUploading } = useProfileImageUpload(
    url => setAvatarUrl(url)
  )
  const { upload: uploadHeadline0, isUploading: headline0Uploading } = useProfileImageUpload(
    url => setHeadlineUrls(prev => { const n = [...prev]; n[0] = url; return n })
  )
  const { upload: uploadHeadline1, isUploading: headline1Uploading } = useProfileImageUpload(
    url => setHeadlineUrls(prev => { const n = [...prev]; n[1] = url; return n })
  )
  const { upload: uploadHeadline2, isUploading: headline2Uploading } = useProfileImageUpload(
    url => setHeadlineUrls(prev => { const n = [...prev]; n[2] = url; return n })
  )
  const headlineSlots = [
    { url: headlineUrls[0], upload: uploadHeadline0, isUploading: headline0Uploading, label: 'Photo 1' },
    { url: headlineUrls[1], upload: uploadHeadline1, isUploading: headline1Uploading, label: 'Photo 2' },
    { url: headlineUrls[2], upload: uploadHeadline2, isUploading: headline2Uploading, label: 'Photo 3' },
  ]

  const mutation = useMutation({
    mutationFn: async (data: {
      displayName: string
      bio: string
      locationLabel: string
      mediumTags: string[]
      socialLinks: Record<string, string>
      avatarS3Key: string | null
      headlineImageUrls: string[]
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
            avatarS3Key: data.avatarS3Key,
            headlineImageUrls: data.headlineImageUrls,
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
            avatarS3Key: data.avatarS3Key,
            headlineImageUrls: data.headlineImageUrls,
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
      avatarS3Key: avatarUrl,
      headlineImageUrls: headlineUrls.filter((u): u is string => u !== null),
    })
  }

  // userId is used by the parent to identify the current user context
  void userId

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-5">

      {/* Profile picture + headline photos */}
      <fieldset>
        <legend className="block font-sans text-sm text-ink mb-3">Profile photos</legend>
        <div className="flex items-end gap-4 flex-wrap">
          <ImageSlot
            url={avatarUrl}
            label="Profile pic"
            round
            onFile={uploadAvatar}
            isUploading={avatarUploading}
          />
          <div className="flex gap-3 flex-1">
            {headlineSlots.map(slot => (
              <div key={slot.label} className="flex-1 min-w-0">
                <ImageSlot
                  url={slot.url}
                  label={slot.label}
                  onFile={slot.upload}
                  isUploading={slot.isUploading}
                />
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 font-sans text-xs text-mid">
          Profile pic appears as your avatar. Up to {MAX_HEADLINE} headline photos appear at the top of your public profile.
        </p>
      </fieldset>

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
