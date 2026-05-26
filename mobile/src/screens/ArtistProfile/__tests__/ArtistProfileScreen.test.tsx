import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { ArtistProfileScreen } from '../ArtistProfileScreen'

const mockProfile = {
  id: 'profile-1',
  user_id: 'user-1',
  display_name: 'Elena Vasquez',
  bio: 'Muralist based in Bristol',
  medium_tags: ['acrylic', 'paste-up'],
  social_links: {},
  avatar_s3_key: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const mockCollections = [
  { id: 'col-1', artist_profile_id: 'profile-1', name: 'Street Series', description: '', status: 'published', display_order: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
]

jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('collections')) {
        return Promise.resolve({ data: mockCollections, error: undefined })
      }
      return Promise.resolve({ data: mockProfile, error: undefined })
    }),
  },
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { profileID: 'profile-1' } }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('ArtistProfileScreen', () => {
  it('renders without crashing', () => {
    render(<ArtistProfileScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('artist-profile-screen')).toBeTruthy()
  })

  it('shows artist name after data loads', async () => {
    render(<ArtistProfileScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Elena Vasquez')).toBeTruthy()
  })
})
