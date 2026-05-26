import { render, screen } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { Providers } from '../app/providers'

function QueryClientProbe() {
  const client = useQueryClient()
  const staleTime = client.getDefaultOptions().queries?.staleTime
  return <div data-testid="stale-time">{String(staleTime)}</div>
}

describe('Providers', () => {
  it('renders children inside a QueryClientProvider without throwing', () => {
    expect(() =>
      render(
        <Providers>
          <QueryClientProbe />
        </Providers>,
      ),
    ).not.toThrow()
  })

  it('sets staleTime default to 60 seconds', () => {
    render(
      <Providers>
        <QueryClientProbe />
      </Providers>,
    )
    expect(screen.getByTestId('stale-time')).toHaveTextContent('60000')
  })
})
