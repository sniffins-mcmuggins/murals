import type { Route } from 'next'
import Link from 'next/link'

/**
 * Sticky bottom bar shown ONLY to the owner of a public page (artist live page,
 * collection page). The caller gates rendering with isProfileOwner(); this
 * component just presents the label + edit/dashboard links.
 *
 * Pages that render this MUST add bottom padding (e.g. `pb-28`) so the fixed bar
 * does not overlap their last section.
 */
export function OwnerBar({
  label,
  editHref,
  editLabel,
}: {
  label: string
  editHref: Route
  editLabel: string
}) {
  return (
    <div
      data-testid="owner-bar"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-light bg-warm/95 backdrop-blur"
    >
      <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <span className="font-mono text-xs uppercase tracking-wider text-mid">{label}</span>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="font-sans text-sm text-ink underline hover:text-amber transition-colors whitespace-nowrap"
          >
            Dashboard
          </Link>
          <Link
            href={editHref}
            className="px-5 py-2 bg-amber text-ink font-sans font-medium text-sm rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            {editLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}
