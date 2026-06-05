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
})
