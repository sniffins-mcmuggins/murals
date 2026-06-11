import { describe, it, expect, beforeEach, vi } from 'vitest'
import { type ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { renderWithClient, ok, byPath } from '../helpers/query'

const { mockPush, mockBack, mockGet, mockPost } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockBack: vi.fn(),
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}))

vi.mock('@/lib/api', () => ({
  apiClient: { GET: mockGet, POST: mockPost },
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

import EndorsePage from '@/app/(artist)/endorse/[profileID]/page'

// React 19's `use(promise)` reads a thenable synchronously when it's tagged
// `status: 'fulfilled'` — so the component renders without suspending in jsdom.
function fulfilledParams(profileID: string): Promise<{ profileID: string }> {
  const value = { profileID }
  return Object.assign(Promise.resolve(value), { status: 'fulfilled', value })
}

function renderEndorse(profileID: string) {
  return renderWithClient(<EndorsePage params={fulfilledParams(profileID)} />)
}

describe('EndorsePage self-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The caller's own profile is prof-self.
    mockGet.mockImplementation(byPath({ '/festivals': ok([]), '/profiles/me': ok({ id: 'prof-self' }) }))
  })

  it("blocks endorsing your own profile", async () => {
    renderEndorse('prof-self')
    expect(await screen.findByText(/can.?t endorse yourself/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument()
  })

  it('shows the endorsement form for someone else', async () => {
    renderEndorse('prof-other')
    expect(await screen.findByRole('button', { name: 'Endorse' })).toBeInTheDocument()
    expect(screen.queryByText(/can.?t endorse yourself/i)).not.toBeInTheDocument()
  })
})
