import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import DynamicForm from '@/components/DynamicForm'

describe('DynamicForm', () => {
  it('renders a text field', () => {
    const fields = [{ type: 'text' as const, label: 'Your name', required: true }]
    render(React.createElement(DynamicForm, { fields, onSubmit: vi.fn() }))
    expect(screen.getByLabelText(/Your name/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Your name/ })).toHaveAttribute('type', 'text')
  })

  it('renders a textarea field', () => {
    const fields = [{ type: 'textarea' as const, label: 'Artist statement' }]
    render(React.createElement(DynamicForm, { fields, onSubmit: vi.fn() }))
    const el = screen.getByLabelText('Artist statement')
    expect(el.tagName.toLowerCase()).toBe('textarea')
  })

  it('renders a select field with options', () => {
    const fields = [
      { type: 'select' as const, label: 'Style', options: ['Street art', 'Portrait', 'Abstract'] },
    ]
    render(React.createElement(DynamicForm, { fields, onSubmit: vi.fn() }))
    expect(screen.getByLabelText('Style')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Street art' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Portrait' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Abstract' })).toBeInTheDocument()
  })

  it('renders an embed field, validates the URL, and previews when valid', () => {
    const fields = [{ id: 'walkthrough', type: 'embed' as const, label: 'Walkthrough video' }]
    render(React.createElement(DynamicForm, { fields, onSubmit: vi.fn() }))
    const input = screen.getByLabelText('Walkthrough video')
    fireEvent.change(input, { target: { value: 'not a video' } })
    expect(screen.getByText(/paste a youtube, vimeo or sketchfab/i)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    expect(screen.getByText(/youtube/i)).toBeInTheDocument()
  })

  it('calls onSubmit with answers keyed by field label when submitted', () => {
    const onSubmit = vi.fn()
    const fields = [
      { type: 'text' as const, label: 'Your name' },
      { type: 'textarea' as const, label: 'Artist statement' },
    ]
    render(React.createElement(DynamicForm, { fields, onSubmit }))

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Banksy' } })
    fireEvent.change(screen.getByLabelText('Artist statement'), { target: { value: 'I paint walls.' } })
    fireEvent.submit(screen.getByRole('form'))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({
      'Your name': 'Banksy',
      'Artist statement': 'I paint walls.',
    })
  })

  // E28 M2: profile-bound fields pre-fill from initialValues but stay editable.
  it('seeds a bound field from initialValues and submits the edited value', () => {
    const onSubmit = vi.fn()
    const fields = [{ id: 'ig', type: 'text' as const, label: 'Instagram', prefill: 'social.instagram' }]
    render(
      React.createElement(DynamicForm, {
        fields,
        onSubmit,
        initialValues: { ig: 'https://instagram.com/me' },
      }),
    )
    const input = screen.getByLabelText('Instagram') as HTMLInputElement
    expect(input.value).toBe('https://instagram.com/me')
    expect(screen.getByText(/from your profile/i)).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'https://instagram.com/edited' } })
    fireEvent.submit(screen.getByRole('form'))
    expect(onSubmit).toHaveBeenCalledWith({ ig: 'https://instagram.com/edited' })
  })

  it('renders a favicon and a Share checkbox for a pre-filled social field', () => {
    const fields = [{ id: 'ig', type: 'text' as const, label: 'Instagram', prefill: 'social.instagram' }]
    render(React.createElement(DynamicForm, {
      fields, onSubmit: vi.fn(), initialValues: { ig: 'https://instagram.com/me' },
    }))
    expect(screen.getByRole('img', { name: 'Instagram' })).toHaveAttribute('src', '/favicons/instagram.png')
    expect(screen.getByRole('checkbox', { name: 'Share Instagram' })).toBeChecked()
  })

  it('excludes an un-shared link from the submitted answers', () => {
    const onSubmit = vi.fn()
    const fields = [{ id: 'ig', type: 'text' as const, label: 'Instagram', prefill: 'social.instagram' }]
    render(React.createElement(DynamicForm, {
      fields, onSubmit, initialValues: { ig: 'https://instagram.com/me' },
    }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Share Instagram' })) // uncheck
    fireEvent.submit(screen.getByRole('form'))
    expect(onSubmit).toHaveBeenCalledWith({ ig: '' })
  })

  it('defaults an empty social field to un-shared', () => {
    const fields = [{ id: 'tw', type: 'text' as const, label: 'X / Twitter', prefill: 'social.twitter' }]
    render(React.createElement(DynamicForm, { fields, onSubmit: vi.fn() }))
    expect(screen.getByRole('checkbox', { name: 'Share X / Twitter' })).not.toBeChecked()
  })

  it('renders a collection picker for a portfolio_collection field', () => {
    const fields = [{ id: 'pf', type: 'text' as const, label: 'Portfolio', prefill: 'portfolio_collection' }]
    render(
      React.createElement(DynamicForm, {
        fields,
        onSubmit: vi.fn(),
        collections: [
          { id: 'c1', name: 'Murals 2024', url: 'https://x/artists/a/collections/c1' },
          { id: 'c2', name: 'Studio work', url: 'https://x/artists/a/collections/c2' },
        ],
      }),
    )
    expect(screen.getByRole('option', { name: 'Murals 2024' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Studio work' })).toBeInTheDocument()
  })
})
