import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { HomeScreen } from '../HomeScreen'

jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'abc',
          name: 'Summer Walls',
          slug: 'summer-walls-2027',
          status: 'live',
          location_label: 'Bristol',
          start_date: '2027-06-01',
          end_date: '2027-06-07',
          description: '',
          organiser_id: 'org-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      error: undefined,
    }),
  },
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('HomeScreen', () => {
  it('renders without crashing', async () => {
    render(<HomeScreen />, { wrapper: Wrapper })
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })

  it('shows festival name after data loads', async () => {
    render(<HomeScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Summer Walls')).toBeTruthy()
  })
})
