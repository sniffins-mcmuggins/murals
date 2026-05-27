import Link from 'next/link'

export default function OrganiserDashboardPage() {
  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Organiser Dashboard</h1>
      <p className="font-sans text-mid mb-8">Manage your festivals and applications.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/organiser/festivals"
          className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors"
        >
          <h2 className="font-serif text-xl text-ink mb-1">Festivals</h2>
          <p className="font-sans text-sm text-mid">Create and manage your paint festivals.</p>
        </Link>
      </div>
    </div>
  )
}
