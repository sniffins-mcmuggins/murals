'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import DynamicForm, { type FormField } from '@/components/DynamicForm'
import type { components } from '@render/api-client'

type ApplicationForm = components['schemas']['ApplicationForm']
type Festival = components['schemas']['Festival']

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
      if (res.error) return null
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
      if (res.error) return null
      return (res.data ?? null) as ApplicationForm | null
    },
    enabled: !!festivalId,
  })

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

  if (festivalQuery.isLoading || formQuery.isLoading) {
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
  const formFields = (formQuery.data.fields ?? []) as unknown as FormField[]

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

      <DynamicForm
        fields={formFields}
        onSubmit={(answers) => applyMutation.mutate(answers)}
        submitting={applyMutation.isPending}
      />
    </div>
  )
}
