import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth-server'

// The root path has no landing page of its own: logged-in visitors go straight
// to their dashboard, everyone else to login. getSessionUser() validates the
// session cookie via GET /me, so an expired/invalid cookie falls through to login.
export default async function Home() {
  const user = await getSessionUser()
  redirect(user ? '/dashboard' : '/login')
}
