import type { Route } from 'next'
import { requireAuth } from '@/lib/auth-server'
import Link from 'next/link'

const NAV_LINKS: { href: Route; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
  { href: '/collections', label: 'Collections' },
  { href: '/applications', label: 'Applications' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/endorsements', label: 'Endorsements' },
]

export default async function ArtistLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  return (
    <div className="min-h-screen bg-offwhite flex">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-56 border-r border-light bg-warm shrink-0 pt-8 pb-6 px-4">
        <span className="font-serif text-xl text-ink mb-8 px-2">Painttrace</span>
        {user.is_beta && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-amber bg-ink px-2 py-0.5 rounded mb-4 mx-2 text-center">
            Founding member
          </span>
        )}
        <nav className="flex flex-col gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="font-sans text-sm text-mid hover:text-ink px-2 py-2 rounded hover:bg-light transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      {/* Mobile top nav */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-offwhite border-b border-light flex gap-4 px-4 py-3 overflow-x-auto">
        {user.is_beta && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-amber bg-ink px-2 py-0.5 rounded self-center whitespace-nowrap">
            Founding member
          </span>
        )}
        {NAV_LINKS.map(({ href, label }) => (
          <Link key={href} href={href} className="font-sans text-sm text-mid hover:text-ink whitespace-nowrap">
            {label}
          </Link>
        ))}
      </div>
      <main className="flex-1 px-6 py-8 md:py-8 mt-12 md:mt-0 max-w-3xl">
        {children}
      </main>
    </div>
  )
}
