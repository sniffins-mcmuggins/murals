// web/src/__tests__/organiser/form-builder.test.tsx
import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FormBuilderClient from '@/app/organiser/festivals/[id]/form/FormBuilderClient'

// Mock the API client: GET returns an empty form, PUT captures the body.
const putBody: { current: unknown } = { current: null }
vi.mock('@/lib/api', () => ({
  apiClient: {
    GET: vi.fn().mockResolvedValue({ data: { fields: [] }, error: null }),
    PUT: vi.fn().mockImplementation((_path: string, opts: { body: unknown }) => {
      putBody.current = opts.body
      return Promise.resolve({ data: {}, error: null })
    }),
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn().mockReturnValue({ data: { fields: [] }, isLoading: false, isError: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

describe('FormBuilderClient', () => {
  beforeEach(() => { putBody.current = null })

  it('shows the starter-template option when the form is empty', async () => {
    render(React.createElement(FormBuilderClient, { festivalId: 'fest-1' }))
    expect(await screen.findByText(/start from a template/i)).toBeInTheDocument()
  })

  it('adds a field, edits its label, and saves it via PATCH', async () => {
    render(React.createElement(FormBuilderClient, { festivalId: 'fest-1' }))
    fireEvent.click(await screen.findByRole('button', { name: /add field/i }))
    const labelInput = await screen.findByLabelText(/field label/i)
    fireEvent.change(labelInput, { target: { value: 'Why this festival?' } })
    fireEvent.click(screen.getByRole('button', { name: /save form/i }))
    await waitFor(() => expect(putBody.current).not.toBeNull())
    const fields = (putBody.current as { fields: Array<{ label: string; id: string }> }).fields
    expect(fields[0].label).toBe('Why this festival?')
    expect(fields[0].id).toBeTruthy()
  })
})
