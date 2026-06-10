'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import DynamicForm, { type FormField, type CollectionOption } from '@/components/DynamicForm'
import { resolvePrefill, isPrefillKey } from '@/lib/prefill'
import type { components } from '@render/api-client'

type ApplicationForm = components['schemas']['ApplicationForm']
type Festival = components['schemas']['Festival']
type ArtistProfile = components['schemas']['ArtistProfile']
type Collection = components['schemas']['Collection']

class ProfileRequiredError extends Error {
  constructor() {
    super('profile_required')
  }
}

export default function ApplyPage() {
  const { id: festivalId } = useParams<{ id: string }>()
  const router = useRouter()
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [profileRequired, setProfileRequired] = useState(false)

  const festivalQuery = useQuery({
    queryKey: ['festival', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load festival')
      return (res.data ?? null) as Festival | null
    },
    enabled: !!festivalId,
  })

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load application form')
      return (res.data ?? null) as ApplicationForm | null
    },
    enabled: !!festivalId,
  })

  // The applicant's own profile — used to pre-fill profile-bound fields (E28 M2).
  const profileQuery = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const res = await apiClient.GET('/profiles/me')
      if (res.response.status === 404) return null
      if (res.error) throw new Error('Failed to load profile')
      return (res.data ?? null) as ArtistProfile | null
    },
  })
  const profile = profileQuery.data ?? null

  // The applicant's collections — options for any `portfolio_collection` field.
  const collectionsQuery = useQuery({
    queryKey: ['my-collections', profile?.id],
    queryFn: async () => {
      const res = await apiClient.GET('/profiles/{profileID}/collections', {
        params: { path: { profileID: profile!.id } },
      })
      if (res.error) throw new Error('Failed to load collections')
      return (res.data ?? []) as Collection[]
    },
    enabled: !!profile?.id,
  })

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const collectionOptions = useMemo<CollectionOption[]>(() => {
    if (!profile?.id) return []
    return (collectionsQuery.data ?? []).map(c => ({
      id: c.id,
      name: c.name,
      url: `${origin}/artists/${profile.id}/collections/${c.id}`,
    }))
  }, [collectionsQuery.data, profile?.id, origin])

  const formFields = useMemo<FormField[]>(
    () => (formQuery.data?.fields ?? []) as unknown as FormField[],
    [formQuery.data],
  )

  // Resolve each bound field's default value from the profile (E28 M2).
  const initialValues = useMemo<Record<string, string>>(() => {
    if (!profile) return {}
    const out: Record<string, string> = {}
    for (const f of formFields) {
      if (!f.prefill || !isPrefillKey(f.prefill)) continue
      const key = f.id ?? f.label
      if (f.prefill === 'portfolio_collection') {
        out[key] = collectionOptions[0]?.url ?? ''
      } else {
        out[key] = resolvePrefill(f.prefill, profile, { profileBaseUrl: origin })
      }
    }
    return out
  }, [formFields, profile, collectionOptions, origin])

  const applyMutation = useMutation({
    mutationFn: async (answers: Record<string, string>) => {
      const res = await apiClient.POST('/festivals/{festivalID}/apply', {
        params: { path: { festivalID: festivalId } },
        body: { answers: answers as unknown as Record<string, never> },
      })
      if (res.error) {
        if (res.response.status === 409) {
          const body = res.error as { error?: string } | undefined
          if (body?.error === 'profile_required') {
            throw new ProfileRequiredError()
          }
        }
        throw new Error('Failed to submit application. Please try again.')
      }
      return res.data
    },
    onSuccess: () => {
      setSubmitted(true)
      setSubmitError(null)
      setProfileRequired(false)
    },
    onError: (err: Error) => {
      if (err instanceof ProfileRequiredError) {
        setProfileRequired(true)
        setSubmitError(null)
        return
      }
      setProfileRequired(false)
      setSubmitError(err.message)
    },
  })

  // One-click "Apply with my profile" (E28 M2 stretch): submit the profile-resolved
  // answers directly when they satisfy every required question; otherwise nudge the
  // artist to the (already pre-filled) form to finish the rest.
  const boundFieldCount = formFields.filter(f => f.prefill && isPrefillKey(f.prefill)).length
  function handleApplyWithProfile() {
    const missing = formFields.filter(
      f => f.required && !(initialValues[f.id ?? f.label] ?? '').trim(),
    )
    if (missing.length > 0) {
      setSubmitError(
        `${missing.length} question${missing.length > 1 ? 's' : ''} still need an answer below — your profile details are already filled in.`,
      )
      return
    }
    setSubmitError(null)
    applyMutation.mutate(initialValues)
  }

  if (profileQuery.isError || collectionsQuery.isError || festivalQuery.isError || formQuery.isError) {
    return (
      <p role="alert" className="font-sans text-clay">
        Couldn&apos;t load your details. Refresh to try again.
      </p>
    )
  }

  if (festivalQuery.isLoading || formQuery.isLoading || profileQuery.isLoading) {
    return (
      <div>
        <p className="font-sans text-mid text-sm">Loading…</p>
      </div>
    )
  }

  if (!formQuery.data) {
    return (
      <div>
        <p className="font-sans text-mid">Application form not found for this festival.</p>
      </div>
    )
  }

  const festival = festivalQuery.data

  if (submitted) {
    return (
      <div>
        <h1 className="font-serif text-4xl text-ink mb-4">Application submitted</h1>
        <p className="font-sans text-mid mb-6">
          Your application to {festival?.name ?? 'this festival'} has been submitted. You can track
          its status in your{' '}
          <a href="/applications" className="text-amber hover:underline">
            applications
          </a>
          .
        </p>
        <button
          onClick={() => router.push('/applications')}
          className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          Back to applications
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <a href="/applications" className="font-sans text-sm text-mid hover:text-ink">
          ← Back to applications
        </a>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">
        Apply to {festival?.name ?? 'festival'}
      </h1>
      {festival?.location_label && (
        <p className="font-sans text-mid mb-6">{festival.location_label}</p>
      )}

      {profileRequired && (
        <div
          role="alert"
          className="border border-amber bg-warm rounded-lg p-4 mb-6"
        >
          <p className="font-sans text-sm text-ink mb-2">
            You need an artist profile to apply.
          </p>
          <Link
            href="/profile"
            className="font-sans text-sm text-ink underline hover:text-amber"
          >
            Set up your artist profile →
          </Link>
        </div>
      )}

      {submitError && (
        <p role="alert" className="font-sans text-sm text-clay mb-4">
          {submitError}
        </p>
      )}

      {formFields.length === 0 ? (
        <p className="font-sans text-mid">This festival has no application questions. Click below to apply.</p>
      ) : null}

      {profile && boundFieldCount > 0 && (
        <div className="bg-warm border border-light rounded-lg p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="font-sans text-sm text-ink">
            We&apos;ve pre-filled {boundFieldCount} question{boundFieldCount > 1 ? 's' : ''} from your profile.
          </p>
          <button
            type="button"
            onClick={handleApplyWithProfile}
            disabled={applyMutation.isPending}
            className="font-sans text-sm font-medium bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
          >
            Apply with my profile
          </button>
        </div>
      )}

      <DynamicForm
        fields={formFields}
        initialValues={initialValues}
        collections={collectionOptions}
        onSubmit={(answers) => applyMutation.mutate(answers)}
        submitting={applyMutation.isPending}
      />
    </div>
  )
}
