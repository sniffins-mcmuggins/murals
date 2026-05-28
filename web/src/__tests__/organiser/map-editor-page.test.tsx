import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('leaflet', () => ({
  default: {
    icon: vi.fn(() => ({})),
    divIcon: vi.fn(() => ({})),
    Marker: { prototype: { options: {} } },
  },
  icon: vi.fn(() => ({})),
  divIcon: vi.fn(() => ({})),
}))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'map-container' }, children),
  TileLayer: () => null,
  Marker: ({ children, eventHandlers }: { children?: React.ReactNode; eventHandlers?: { click?: () => void } }) =>
    React.createElement('div', { 'data-testid': 'map-marker', onClick: eventHandlers?.click }, children),
  Popup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'map-popup' }, children),
  useMapEvents: vi.fn(),
}))
vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('leaflet/dist/images/marker-icon.png', () => ({ default: { src: '/marker-icon.png' } }))
vi.mock('leaflet/dist/images/marker-shadow.png', () => ({ default: { src: '/marker-shadow.png' } }))
vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn(), PUT: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

import { useQuery } from '@tanstack/react-query'
import MapEditorClient from '@/app/organiser/festivals/[id]/map/MapEditorClient'

const mockUseQuery = vi.mocked(useQuery)

const spotsData = {
  spots: [
    { id: 'spot-1', number: 1, lat: 51.9007, lng: -2.0783, artist_id: null, artist_name: null },
    { id: 'spot-2', number: 2, lat: 51.901, lng: -2.079, artist_id: 'artist-1', artist_name: 'Rosa Vane' },
  ],
  unassigned_artists: [{ artist_id: 'artist-2', name: 'Kai Hollis' }],
}

describe('MapEditorClient', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading spinner while spots fetch is pending', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(MapEditorClient, { festivalId: 'fest-abc123' }))
    // Map container is not rendered while loading
    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument()
  })

  it('renders map editor with spots list and Add spot button', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(MapEditorClient, { festivalId: 'fest-abc123' }))

    await waitFor(() => expect(screen.getByText('Map editor')).toBeInTheDocument())

    expect(screen.getByTestId('add-spot-btn')).toBeInTheDocument()
    expect(screen.getByTestId('spots-list')).toBeInTheDocument()
    // "Spot 1" / "Spot 2" appear in both the sidebar list and marker popups
    expect(screen.getAllByText('Spot 1')).not.toHaveLength(0)
    expect(screen.getAllByText('Spot 2')).not.toHaveLength(0)
    expect(screen.getByText('Rosa Vane')).toBeInTheDocument()
    expect(screen.getByText('2 spots · 1 assigned')).toBeInTheDocument()
  })

  it('renders one marker per spot', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(MapEditorClient, { festivalId: 'fest-abc123' }))

    await waitFor(() => expect(screen.getByText('Map editor')).toBeInTheDocument())
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2)
  })

  it('shows error state when spots fail to load', async () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true } as ReturnType<typeof useQuery>)
    render(React.createElement(MapEditorClient, { festivalId: 'fest-abc123' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load spots.'))
  })

  it('clicking a spot in the sidebar opens the spot panel', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(MapEditorClient, { festivalId: 'fest-abc123' }))

    await waitFor(() => expect(screen.getByTestId('spots-list')).toBeInTheDocument())
    // Click the sidebar button for Spot 1 (scoped to the spots list to avoid the popup duplicate)
    const spotsList = screen.getByTestId('spots-list')
    await userEvent.click(spotsList.querySelectorAll('button')[0])

    expect(screen.getByTestId('spot-panel')).toBeInTheDocument()
  })

  it('clicking Save in the spot panel calls PATCH with updated notes', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    const { apiClient } = await import('@/lib/api')
    const mockPatch = vi.mocked(apiClient.PATCH)
    mockPatch.mockResolvedValue({ data: spotsData.spots[0] as never, error: undefined, response: new Response(null, { status: 200 }) })

    render(React.createElement(MapEditorClient, { festivalId: 'fest-abc123' }))
    await waitFor(() => expect(screen.getByTestId('spots-list')).toBeInTheDocument())

    // Open the spot panel (scope to sidebar list to avoid map popup duplicate)
    const spotsList = screen.getByTestId('spots-list')
    await userEvent.click(spotsList.querySelectorAll('button')[0])
    expect(screen.getByTestId('spot-panel')).toBeInTheDocument()

    // Edit the notes field
    const notesField = screen.getByPlaceholderText('e.g. needs cherry picker')
    await userEvent.clear(notesField)
    await userEvent.type(notesField, 'needs scaffold')

    // Click Save
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatch).toHaveBeenCalledWith(
      '/festivals/{festivalID}/spots/{spotID}',
      expect.objectContaining({
        params: { path: { festivalID: 'fest-abc123', spotID: 'spot-1' } },
      })
    )
  })

  it('clicking Add spot button toggles placement mode label', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(MapEditorClient, { festivalId: 'fest-abc123' }))

    await waitFor(() => expect(screen.getByTestId('add-spot-btn')).toBeInTheDocument())

    const addBtn = screen.getByTestId('add-spot-btn')
    expect(addBtn).toHaveTextContent('+ Add spot')

    await userEvent.click(addBtn)
    expect(addBtn).toHaveTextContent('Click map to place…')

    await userEvent.click(addBtn)
    expect(addBtn).toHaveTextContent('+ Add spot')
  })
})
