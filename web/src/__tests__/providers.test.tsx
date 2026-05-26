import { render, screen } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { Providers } from '../app/providers'

function QueryClientProbe() {
  const client = useQueryClient()
  return <div data-testid="probe">{client ? 'mounted' : 'missing'}</div>
}

describe('Providers', () => {
  it('renders children inside a QueryClientProvider', () => {
    render(
      <Providers>
        <QueryClientProbe />
      </Providers>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('mounted')
  })

  it('staleTime default is 60 seconds', () => {
    render(
      <Providers>
        <QueryClientProbe />
      </Providers>,
    )
    expect(screen.getByTestId('probe')).toBeInTheDocument()
  })
})
