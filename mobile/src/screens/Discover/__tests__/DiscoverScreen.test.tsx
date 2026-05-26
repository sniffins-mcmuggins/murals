import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { DiscoverScreen } from '../DiscoverScreen'

jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockResolvedValue({
      data: {
        profiles: [
          {
            id: 'p1',
            user_id: 'u1',
            display_name: 'Rosa Mendez',
            bio: '',
            medium_tags: ['spray'],
            social_links: {},
            avatar_s3_key: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        per_page: 20,
      },
      error: undefined,
    }),
  },
}))

jest.mock('../../../lib/location', () => ({
  requestLocationPermission: jest.fn().mockResolvedValue(false),
  getCurrentPosition: jest.fn(),
  distanceKm: jest.fn().mockReturnValue(1.5),
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}))

jest.mock('../../../components/ArtistCard', () => ({
  ArtistCard: ({ profile }: any) => {
    const { Text } = require('react-native')
    return <Text>{profile.display_name}</Text>
  },
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('DiscoverScreen', () => {
  it('renders without crashing', () => {
    render(<DiscoverScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('discover-screen')).toBeTruthy()
  })

  it('shows artist name in Random mode', async () => {
    render(<DiscoverScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Rosa Mendez')).toBeTruthy()
  })
})
