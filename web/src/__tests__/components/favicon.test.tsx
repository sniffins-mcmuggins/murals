import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Favicon } from '@/components/Favicon'

describe('Favicon', () => {
  it('renders the favicon image by default', () => {
    render(React.createElement(Favicon, { platform: 'instagram', src: '/favicons/instagram.png', label: 'Instagram' }))
    const img = screen.getByRole('img', { name: 'Instagram' })
    expect(img).toHaveAttribute('src', '/favicons/instagram.png')
  })

  it('falls back to the brand glyph when the image fails to load', () => {
    render(React.createElement(Favicon, { platform: 'instagram', src: '/favicons/instagram.png', label: 'Instagram' }))
    fireEvent.error(screen.getByRole('img', { name: 'Instagram' }))
    // SocialIcon renders an aria-hidden <svg>; the <img> is gone after the error.
    expect(screen.queryByRole('img', { name: 'Instagram' })).toBeNull()
  })
})
