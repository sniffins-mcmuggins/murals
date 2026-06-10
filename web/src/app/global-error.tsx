'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ background: '#FAF7F2', color: '#1A1A2E', fontFamily: 'Georgia, serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0 }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <button
            onClick={reset}
            style={{ background: '#1A1A2E', color: '#FAF7F2', border: 0, padding: '0.6rem 1.5rem', borderRadius: 6, cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.7rem' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
