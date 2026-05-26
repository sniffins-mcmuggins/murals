import { requireAuth } from '@/lib/auth-server'
import { cookies } from 'next/headers'
import { createApiClient } from '@render/api-client'
import ProfileForm from './ProfileForm'

export default async function ProfilePage() {
  const user = await requireAuth()

  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  const authedClient = createApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })
  if (sessionCookie?.value) {
    const sv = sessionCookie.value
    authedClient.use({ onRequest({ request }) { request.headers.set('Cookie', `session=${sv}`); return request } })
  }

  const profileRes = await authedClient.GET('/profiles/me', {})
  const profile = profileRes.data ?? null

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Profile</h1>
      <p className="font-sans text-mid mb-8">How the world sees you.</p>
      <ProfileForm profile={profile} userId={user.id} />
    </div>
  )
}
