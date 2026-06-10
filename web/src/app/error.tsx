'use client'

import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="min-h-screen bg-offwhite flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="font-mono text-xs uppercase tracking-widest text-mid mb-3">Error</p>
        <h1 className="font-serif text-4xl text-ink mb-3">Something went wrong</h1>
        <p className="font-sans text-mid mb-8">
          An unexpected error occurred. It&apos;s been logged — try again, or head back home.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="font-mono text-xs uppercase tracking-widest bg-ink text-offwhite px-6 py-2 rounded hover:bg-amber hover:text-ink transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-widest text-mid border border-light px-6 py-2 rounded hover:text-ink transition-colors"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  )
}
