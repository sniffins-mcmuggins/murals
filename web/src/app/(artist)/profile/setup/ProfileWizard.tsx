'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'
import { StepShell } from '@/components/wizard/StepShell'
import { ImageSlot } from '@/components/ImageSlot'
import { MediumPicker } from '@/components/MediumPicker'
import { SupportLinkField } from '@/components/SupportLinkField'
import { SocialIcon, SOCIAL_PLATFORMS } from '@/components/SocialIcon'
import { useProfileImageUpload } from '@/hooks/useProfileImageUpload'

type ArtistProfile = components['schemas']['ArtistProfile']

const TOTAL = 9

type WizardState = {
  displayName: string
  bio: string
  locationLabel: string
  showLocation: boolean
  mediumTags: string[]
  socialLinks: Record<string, string>
  supportUrl: string
  avatarUrl: string | null
  headlineUrls: (string | null)[]
}

function initState(p: ArtistProfile | null): WizardState {
  const links: Record<string, string> = {}
  for (const { key } of SOCIAL_PLATFORMS) links[key] = p?.social_links?.[key] ?? ''
  const headlines = p?.headline_image_urls ?? []
  return {
    displayName: p?.display_name ?? '',
    bio: p?.bio ?? '',
    locationLabel: p?.location_label ?? '',
    showLocation: true,
    mediumTags: p?.medium_tags ?? [],
    socialLinks: links,
    supportUrl: p?.support_url ?? '',
    avatarUrl: p?.avatar_s3_key ?? null,
    headlineUrls: [headlines[0] ?? null, headlines[1] ?? null, headlines[2] ?? null],
  }
}

export default function ProfileWizard({ initialProfile }: { initialProfile: ArtistProfile | null }) {
  const router = useRouter()
  const [state, setState] = useState<WizardState>(() => initState(initialProfile))
  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const profileId = useRef<string | null>(initialProfile?.id ?? null)
  const submitting = useRef(false)

  // Resume at the furthest step the artist reached (client-only; data itself is
  // already saved server-side per step).
  const storageKey = 'profile-wizard-step'
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
    if (raw) {
      const n = parseInt(raw, 10)
      if (!Number.isNaN(n) && n >= 0 && n < TOTAL) setStep(n)
    }
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, String(step))
  }, [step])

  function patch<K extends keyof WizardState>(key: K, val: WizardState[K]) {
    setState(s => ({ ...s, [key]: val }))
  }

  // Ensure a profile row exists, then PATCH the given body. Returns false on error.
  async function persist(body: Record<string, unknown>): Promise<boolean> {
    setError(null)
    if (!profileId.current) {
      const created = await apiClient.POST('/profiles', { body: { displayName: state.displayName || 'My profile' } })
      if (created.error || !created.data) {
        setError('Could not create your profile. Try again.')
        return false
      }
      profileId.current = created.data.id
    }
    if (Object.keys(body).length > 0) {
      const res = await apiClient.PATCH('/profiles/me', { body })
      if (res.error) {
        setError('Could not save. Check your details and try again.')
        return false
      }
    }
    setSaved(true)
    return true
  }

  // Save this step's slice, then advance.
  async function next(body: Record<string, unknown>) {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    const ok = await persist(body)
    setBusy(false)
    submitting.current = false
    if (ok) {
      setSaved(false)
      setStep(s => Math.min(s + 1, TOTAL - 1))
    }
  }

  function back() {
    setSaved(false)
    setStep(s => Math.max(s - 1, 0))
  }

  function skip() {
    setSaved(false)
    setStep(s => Math.min(s + 1, TOTAL - 1))
  }

  // Image upload hooks (avatar + 3 headline slots).
  const { upload: uploadAvatar, isUploading: avatarUploading } = useProfileImageUpload(url => patch('avatarUrl', url))
  const setHeadline = (i: number, url: string) =>
    setState(s => { const n = [...s.headlineUrls]; n[i] = url; return { ...s, headlineUrls: n } })
  const h0 = useProfileImageUpload(url => setHeadline(0, url))
  const h1 = useProfileImageUpload(url => setHeadline(1, url))
  const h2 = useProfileImageUpload(url => setHeadline(2, url))
  const headlineHooks = [h0, h1, h2]

  const filteredSocials = () =>
    Object.fromEntries(Object.entries(state.socialLinks).filter(([, v]) => v.trim() !== ''))

  // ── Step bodies ────────────────────────────────────────────────────────────
  const shellBase = { stepIndex: step, total: TOTAL, saved, busy, onBack: step > 0 ? back : undefined }

  if (step === 0) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Let's build your page" lede="Start with the name people will know you by."
          onBack={undefined}
          onContinue={() => state.displayName.trim() && next({ displayName: state.displayName.trim() })}>
          <label className="block font-sans text-sm text-ink mb-1">Display name</label>
          <input autoFocus value={state.displayName} onChange={e => patch('displayName', e.target.value)}
            placeholder="e.g. Lady Gabe"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber" />
        </StepShell>
      </Wrap>
    )
  }

  if (step === 1) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Add some photos" lede="A profile picture and up to three headline shots for the top of your page."
          onSkip={skip}
          onContinue={() => next({ avatarS3Key: state.avatarUrl, headlineImageUrls: state.headlineUrls.filter((u): u is string => u !== null) })}>
          <div className="flex items-end gap-4 flex-wrap">
            <ImageSlot url={state.avatarUrl} label="Profile pic" round onFile={uploadAvatar} isUploading={avatarUploading} />
            <div className="flex gap-3 flex-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex-1 min-w-0">
                  <ImageSlot url={state.headlineUrls[i]} label={`Photo ${i + 1}`} onFile={headlineHooks[i].upload} isUploading={headlineHooks[i].isUploading} />
                </div>
              ))}
            </div>
          </div>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 2) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Tell people who you are"
          lede="Write it like you'd say it. First person, no CV-speak — this is the voice on your public page."
          onSkip={skip} onContinue={() => next({ bio: state.bio })}>
          <div className="flex flex-wrap gap-2 mb-3">
            {['I\'m a … based in …', 'My work is about …', 'I started painting when …'].map(p => (
              <button key={p} type="button" onClick={() => patch('bio', state.bio ? state.bio : p)}
                className="font-sans text-xs text-ink bg-warm border border-light rounded-full px-3 py-1.5 hover:border-amber">
                {p}
              </button>
            ))}
          </div>
          <textarea autoFocus value={state.bio} onChange={e => patch('bio', e.target.value)} rows={5}
            className="w-full border border-light rounded-xl px-4 py-3 font-serif text-lg text-ink bg-white focus:outline-none focus:border-amber resize-none" />
          <p className="mt-2 font-mono text-xs text-mid">{state.bio.length} characters · plenty of room</p>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 3) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Where are you based?" lede="City or region only — never your address."
          onSkip={skip}
          onContinue={() => next({ locationLabel: state.locationLabel, showLocation: state.showLocation })}>
          <input autoFocus value={state.locationLabel} onChange={e => patch('locationLabel', e.target.value)}
            placeholder="e.g. Cheltenham, UK"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber" />
          <label className="mt-3 flex items-center gap-2 font-sans text-sm text-ink">
            <input type="checkbox" checked={state.showLocation} onChange={e => patch('showLocation', e.target.checked)} />
            Show this on my public profile
          </label>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 4) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="What do you make?" lede="Pick the mediums that fit. Add your own if something's missing."
          onSkip={skip} onContinue={() => next({ mediumTags: state.mediumTags })}>
          <MediumPicker value={state.mediumTags} onChange={v => patch('mediumTags', v)} />
        </StepShell>
      </Wrap>
    )
  }

  if (step === 5) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Where can people find you?" lede="Add the links you want on your profile."
          onSkip={skip} onContinue={() => next({ socialLinks: filteredSocials() })}>
          <div className="space-y-2">
            {SOCIAL_PLATFORMS.map(({ key, label, placeholder }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-mid shrink-0" aria-label={label}><SocialIcon platform={key} /></span>
                <input type="url" aria-label={label} value={state.socialLinks[key] ?? ''}
                  onChange={e => setState(s => ({ ...s, socialLinks: { ...s.socialLinks, [key]: e.target.value } }))}
                  placeholder={placeholder}
                  className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber" />
              </div>
            ))}
          </div>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 6) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Let people support you" lede="Add a tip or support link if you have one. You can always add it later."
          onSkip={skip} onContinue={() => next({ supportUrl: state.supportUrl })}>
          <SupportLinkField value={state.supportUrl} onChange={v => patch('supportUrl', v)} />
        </StepShell>
      </Wrap>
    )
  }

  if (step === 7) {
    return <FirstWorkStep shellBase={shellBase} onSkip={skip} onDone={() => setStep(8)} error={error} ensureProfile={persist} />
  }

  // step === 8 : review + publish
  return (
    <Wrap error={error}>
      <StepShell {...shellBase} title="You're ready" lede="Here's your page. Publish it now, or finish and publish later."
        onSkip={undefined}
        continueLabel="Publish my page"
        onContinue={async () => {
          setBusy(true)
          const res = await apiClient.POST('/profiles/me/publish', {})
          setBusy(false)
          if (res.error) { setError('Publishing needs an active membership. You can finish and publish from your profile.'); return }
          await apiClient.POST('/profiles/me/complete-setup', {})
          window.localStorage.removeItem(storageKey)
          router.push('/profile')
        }}>
        <div className="rounded-xl border border-light bg-warm p-5">
          <p className="font-serif text-2xl text-ink">{state.displayName || 'Your name'}</p>
          {state.locationLabel && <p className="font-sans text-sm text-mid">{state.locationLabel}</p>}
          {state.bio && <p className="font-sans text-sm text-ink mt-3 leading-relaxed">{state.bio}</p>}
          {state.mediumTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {state.mediumTags.map(t => (
                <span key={t} className="font-mono text-xs uppercase tracking-widest bg-offwhite border border-light text-ink px-2 py-0.5 rounded">{t}</span>
              ))}
            </div>
          )}
        </div>
        <button type="button"
          onClick={async () => {
            await apiClient.POST('/profiles/me/complete-setup', {})
            window.localStorage.removeItem(storageKey)
            router.push('/profile')
          }}
          className="mt-4 font-sans text-sm text-mid hover:text-ink underline">
          Finish for now (publish later)
        </button>
      </StepShell>
    </Wrap>
  )
}

function Wrap({ children, error }: { children: React.ReactNode; error: string | null }) {
  return (
    <div className="py-10">
      {children}
      {error && <p role="alert" className="max-w-xl mx-auto mt-4 font-sans text-sm text-clay">{error}</p>}
    </div>
  )
}

// Optional "first work" step: create one collection with an optional cover image.
// The step is skippable and harmless when left empty. Artists can add more
// collections and covers via the Collections page after setup.
function FirstWorkStep({
  shellBase, onSkip, onDone, error, ensureProfile,
}: {
  shellBase: { stepIndex: number; total: number; saved: boolean; busy: boolean; onBack?: () => void }
  onSkip: () => void
  onDone: () => void
  error: string | null
  ensureProfile: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverKey, setCoverKey] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const submitting = useRef(false)

  const cover = useProfileImageUpload((url, key) => { setCoverUrl(url); setCoverKey(key) })

  async function continueStep() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setLocalErr(null)
    // Make sure the profile exists (collections hang off the artist).
    const ok = await ensureProfile({})
    if (!ok) { setBusy(false); submitting.current = false; return }
    if (name.trim() || (coverUrl && coverKey)) {
      let cid = collectionId
      if (!cid) {
        const res = await apiClient.POST('/collections', { body: { name: name.trim() || 'My work' } })
        if (res.error || !res.data) {
          setLocalErr('Could not create the collection.')
          setBusy(false)
          submitting.current = false
          return
        }
        cid = res.data.id
        setCollectionId(cid)
      }
      if (coverUrl && coverKey) {
        await apiClient.POST('/collections/{collectionID}/images', {
          params: { path: { collectionID: cid } },
          body: { s3Key: coverKey, cdnUrl: coverUrl },
        })
      }
    }
    setBusy(false)
    submitting.current = false
    onDone()
  }

  return (
    <div className="py-10">
      <StepShell {...shellBase} busy={busy} title="Show your first piece"
        lede="Add a collection so your page isn't empty. Give it a name and an optional cover image — you can add more in Collections later."
        onSkip={onSkip} onContinue={continueStep}>
        <label className="block font-sans text-sm text-ink mb-1">Collection name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cheltenham 2026"
          className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber" />
        <div className="mt-4">
          <ImageSlot url={coverUrl} label="Cover image" onFile={cover.upload} isUploading={cover.isUploading} />
        </div>
      </StepShell>
      {(localErr || error) && <p role="alert" className="max-w-xl mx-auto mt-4 font-sans text-sm text-clay">{localErr || error}</p>}
    </div>
  )
}
