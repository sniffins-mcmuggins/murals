import Link from 'next/link'

export default function DashboardPage() {
  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Dashboard</h1>
      <p className="font-sans text-mid mb-8">Welcome to your artist dashboard.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/profile" className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors">
          <h2 className="font-serif text-xl text-ink mb-1">Profile</h2>
          <p className="font-sans text-sm text-mid">Edit your bio, location, and medium tags.</p>
        </Link>
        <Link href="/collections" className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors">
          <h2 className="font-serif text-xl text-ink mb-1">Collections</h2>
          <p className="font-sans text-sm text-mid">Manage your artwork collections.</p>
        </Link>
        <Link href="/applications" className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors">
          <h2 className="font-serif text-xl text-ink mb-1">Applications</h2>
          <p className="font-sans text-sm text-mid">Track your festival applications.</p>
        </Link>
      </div>
    </div>
  )
}
