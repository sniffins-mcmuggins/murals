import { redirect } from 'next/navigation'

// There is no separate organiser dashboard — everything (your art, your festivals,
// festivals you review) lives on the single /dashboard. This route is kept only so
// old links/bookmarks land in the right place.
export default function OrganiserDashboardRedirect() {
  redirect('/dashboard')
}
