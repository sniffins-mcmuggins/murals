import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

// Mock Leaflet and react-leaflet — they're client-only and won't run in jsdom
vi.mock('leaflet', () => ({
  default: {
    icon: vi.fn(() => ({})),
    Marker: { prototype: { options: {} } },
  },
  icon: vi.fn(() => ({})),
}))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'map-container' }, children),
  TileLayer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'map-marker' }, children),
  Popup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'map-popup' }, children),
  useMapEvents: vi.fn(),
}))
vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('leaflet/dist/images/marker-icon.png', () => ({ default: { src: '/marker-icon.png' } }))
vi.mock('leaflet/dist/images/marker-shadow.png', () => ({ default: { src: '/marker-shadow.png' } }))

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), PATCH: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => React.createElement('a', { href, className }, children),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

import { useQuery } from '@tanstack/react-query'
import OrgFestivalMapPage from '@/app/organiser/festivals/[id]/map/page'

const mockUseQuery = vi.mocked(useQuery)
const mockParams = Promise.resolve({ id: 'fest-abc123' })

describe('OrgFestivalMapPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows initial loading state before params resolve', () => {
    // params not yet resolved — component should show the shell loading state
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))

    // The outer shell shows "Loading…" immediately
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders map and accepted artists list after data loads', async () => {
    const artists = [
      {
        artist_id: 'artist-1',
        name: 'Alice Mural',
        pin_lat: 51.8994,
        pin_lng: -2.0783,
        w3w: 'filled.count.soap',
      },
      {
        artist_id: 'artist-2',
        name: 'Bob Spray',
        pin_lat: null,
        pin_lng: null,
        w3w: null,
      },
    ]

    mockUseQuery.mockReturnValue({
      data: artists,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getByText('Map editor')).toBeInTheDocument()
    })

    // Back link
    expect(screen.getByText('← Festival')).toBeInTheDocument()

    // Artists list (Alice also appears in the popup, so use getAllByText)
    expect(screen.getAllByText('Alice Mural').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Bob Spray')).toBeInTheDocument()

    // Pin marker rendered for artist with pin
    expect(screen.getByTestId('map-marker')).toBeInTheDocument()

    // Artist without pin shows "no pin" label
    expect(screen.getByText('no pin')).toBeInTheDocument()
  })

  it('shows error state when accepted artists fail to load', async () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Failed to load accepted artists'),
    } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))

    await waitFor(() => {
      expect(
        screen.getByRole('alert')
      ).toHaveTextContent('Failed to load accepted artists.')
    })
  })
})
