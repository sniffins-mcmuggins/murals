import { requireAuth, createAuthedServerClient } from '@/lib/auth-server'
import { redirect } from 'next/navigation'
import ProfileForm from './ProfileForm'
import PublishBar from './PublishBar'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ claimed?: string }>
}) {
  const user = await requireAuth()

  const authedClient = await createAuthedServerClient()
  if (!authedClient) redirect('/login')

  const profileRes = await authedClient.GET('/profiles/me', {})
  const profile = profileRes.data ?? null

  const params = await searchParams
  const justClaimed = params.claimed === '1'

  // First-run artists (setup not completed) go to the guided wizard. Claimed
  // prospects have setup_completed_at stamped at claim time, so they fall through
  // to the editor here (with the celebratory banner).
  if (!profile || profile.setup_completed_at == null) {
    if (!justClaimed) redirect('/profile/setup')
  }

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Profile</h1>
      <p className="font-sans text-mid mb-8">How the world sees you.</p>
      {justClaimed && (
        <div className="mb-6 p-4 bg-amber/20 border border-amber rounded-lg" data-testid="claimed-banner">
          <p className="font-serif text-lg text-ink">Your page is ready — take a look!</p>
          <p className="font-sans text-sm text-mid mt-1">
            We&apos;ve pre-built your profile. Edit it below, then go public when you&apos;re ready.
          </p>
        </div>
      )}
      <PublishBar initialProfile={profile} />
      <ProfileForm profile={profile} userId={user.id} />
    </div>
  )
}
