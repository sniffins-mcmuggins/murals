import { requireAuth } from '@/lib/auth-server'
import { cookies } from 'next/headers'
import { createApiClient } from '@render/api-client'
import ProfileWizard from './ProfileWizard'

export default async function ProfileSetupPage() {
  await requireAuth()

  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  const authedClient = createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })
  if (sessionCookie?.value) {
    const sv = sessionCookie.value
    authedClient.use({ onRequest({ request }) { request.headers.set('Cookie', `session=${sv}`); return request } })
  }

  const profileRes = await authedClient.GET('/profiles/me', {})
  const profile = profileRes.data ?? null

  return (
    <div>
      <ProfileWizard initialProfile={profile} />
    </div>
  )
}
