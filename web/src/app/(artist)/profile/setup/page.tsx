import { requireAuth, createAuthedServerClient } from '@/lib/auth-server'
import { redirect } from 'next/navigation'
import ProfileWizard from './ProfileWizard'

export default async function ProfileSetupPage() {
  await requireAuth()

  const authedClient = await createAuthedServerClient()
  if (!authedClient) redirect('/login')

  const profileRes = await authedClient.GET('/profiles/me', {})
  const profile = profileRes.data ?? null

  return (
    <div>
      <ProfileWizard initialProfile={profile} />
    </div>
  )
}
