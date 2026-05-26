import Link from 'next/link'

export default function FestivalNotFound() {
  return (
    <main className="min-h-screen bg-offwhite flex items-center justify-center">
      <div className="text-center px-6">
        <h1 className="font-serif text-4xl text-ink mb-4">Festival not found</h1>
        <p className="font-sans text-mid mb-8">
          This festival does not exist or may have been removed.
        </p>
        <Link
          href="/"
          className="inline-block font-sans text-amber hover:underline"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
