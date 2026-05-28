import Link from 'next/link'

export default function CollectionNotFound() {
  return (
    <main className="min-h-screen bg-offwhite flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="font-serif text-5xl text-ink mb-4">Collection not found</h1>
        <p className="font-sans text-mid mb-8">
          This collection does not exist or may have been removed.
        </p>
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-amber underline underline-offset-2 hover:text-clay transition-colors"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
