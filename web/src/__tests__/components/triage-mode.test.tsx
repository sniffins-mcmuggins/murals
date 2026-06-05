import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TriageMode } from '@/components/TriageMode'

import type { components } from '@render/api-client'
type Application = components['schemas']['Application']

const apps = [
  { id: 'a1', shortlisted: false, answers: { q1: 'I paint big walls' }, artist: { display_name: 'Rosa Vane' } },
  { id: 'a2', shortlisted: false, answers: { q1: 'Portraits' }, artist: { display_name: 'Amara Diallo' } },
] as unknown as Application[]
const formFields = [{ id: 'q1', type: 'text' as const, label: 'About your work', required: false }]

function setup(overrides: Record<string, unknown> = {}) {
  const onShortlist = vi.fn()
  const onOpenDetail = vi.fn()
  const onClose = vi.fn()
  render(React.createElement(TriageMode, {
    apps, formFields, detailOpen: false, onShortlist, onOpenDetail, onClose, ...overrides,
  }))
  return { onShortlist, onOpenDetail, onClose }
}

describe('TriageMode', () => {
  it('shows the first card and progress', () => {
    setup()
    expect(screen.getByText('Rosa Vane')).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument()
  })

  it('ArrowRight shortlists current and advances', () => {
    const { onShortlist } = setup()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onShortlist).toHaveBeenCalledWith('a1', true)
    expect(screen.getByText('Amara Diallo')).toBeInTheDocument()
  })

  it('ArrowLeft un-shortlists current and advances', () => {
    const { onShortlist } = setup()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onShortlist).toHaveBeenCalledWith('a1', false)
  })

  it('Enter opens detail for the current app', () => {
    const { onOpenDetail } = setup()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  })

  it('Escape closes', () => {
    const { onClose } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores keys while detailOpen is true', () => {
    const { onShortlist } = setup({ detailOpen: true })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onShortlist).not.toHaveBeenCalled()
  })

  it('Shortlist button mirrors the key', () => {
    const { onShortlist } = setup()
    fireEvent.click(screen.getByRole('button', { name: /shortlist/i }))
    expect(onShortlist).toHaveBeenCalledWith('a1', true)
  })
})
