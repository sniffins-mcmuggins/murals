import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { SharedLinks } from '@/components/SharedLinks'

const fields = [
  { id: 'link_instagram', label: 'Instagram', prefill: 'social.instagram' },
  { id: 'link_website', label: 'Website', prefill: 'website' },
  { id: 'f1', label: 'Concept' },
]

describe('SharedLinks', () => {
  it('renders a clickable favicon per shared link, opening in a new tab', () => {
    render(
      React.createElement(SharedLinks, {
        formFields: fields,
        answers: { link_instagram: 'https://instagram.com/me', link_website: 'https://me.art', f1: 'A mural' },
      }),
    )
    const ig = screen.getByRole('link', { name: 'Instagram' })
    expect(ig).toHaveAttribute('href', 'https://instagram.com/me')
    expect(ig).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('img', { name: 'Instagram' })).toHaveAttribute('src', '/favicons/instagram.png')
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://me.art')
  })

  it('skips empty (un-shared) links and non-link fields, rendering nothing', () => {
    const { container } = render(
      React.createElement(SharedLinks, {
        formFields: fields,
        answers: { link_instagram: '', f1: 'A mural' },
      }),
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.querySelector('[data-testid="shared-links"]')).toBeNull()
  })
})
