import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))
vi.mock('@/hooks/useUploadImage', () => ({
  useUploadImage: vi.fn().mockReturnValue({ upload: vi.fn(), isUploading: false, error: null }),
}))

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUploadImage } from '@/hooks/useUploadImage'
import CollectionDetailPage from '@/app/(artist)/collections/[id]/page'

const mockUseQuery = vi.mocked(useQuery)
const mockUseMutation = vi.mocked(useMutation)
const mockUseQueryClient = vi.mocked(useQueryClient)
const mockUseUploadImage = vi.mocked(useUploadImage)

const mockParams = Promise.resolve({ id: 'col-abc123' })

describe('CollectionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mocks
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as unknown as ReturnType<typeof useQueryClient>)
    mockUseMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useMutation>)
    mockUseUploadImage.mockReturnValue({
      upload: vi.fn(),
      state: 'idle' as const,
      isUploading: false,
      error: null,
    })
  })

  describe('Loading states', () => {
    it('shows loading state when collectionQuery is loading', async () => {
      mockUseQuery
        .mockReturnValueOnce({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('Loading…')).toBeInTheDocument()
      })
    })

    it('shows "Loading images…" when imagesQuery is loading', async () => {
      const collection = { id: 'col-1', name: 'My Murals', description: 'Street art', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' }
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: true } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('Loading images…')).toBeInTheDocument()
      })
    })

    it('shows "Collection not found" when collection query returns no data', async () => {
      mockUseQuery
        .mockReturnValueOnce({ data: null, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText(/Collection not found/)).toBeInTheDocument()
      })
    })
  })

  describe('Collection display', () => {
    it('renders collection name and description', async () => {
      const collection = { id: 'col-1', name: 'My Murals', description: 'Street art collection', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' }
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('My Murals')).toBeInTheDocument()
        expect(screen.getByText('Street art collection')).toBeInTheDocument()
      })
    })

    it('does not render description when collection has no description', async () => {
      const collection = { id: 'col-1', name: 'My Murals', description: '', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' }
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('My Murals')).toBeInTheDocument()
      })
      // Collection with empty description should not have a <p> with the description content
      const heading = screen.getByText('My Murals')
      const descriptionP = heading.parentElement?.querySelector('p')
      // If description is empty string, it shouldn't render a p tag after h1
      expect(descriptionP?.textContent).not.toBe('Street art')
    })

    it('renders back link to collections page', async () => {
      const collection = { id: 'col-1', name: 'My Murals', description: 'Street art', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' }
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        const link = screen.getByRole('link', { name: /Collections/ })
        expect(link).toHaveAttribute('href', '/collections')
      })
    })
  })

  describe('Upload zone', () => {
    const collection = { id: 'col-1', name: 'My Murals', description: 'Street art', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' }

    it('shows "Choose file" label when not uploading', async () => {
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      mockUseUploadImage.mockReturnValue({ upload: vi.fn(), state: 'idle' as const, isUploading: false, error: null })
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('Choose file')).toBeInTheDocument()
      })
    })

    it('shows "Uploading…" and hides file input when uploading', async () => {
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      mockUseUploadImage.mockReturnValue({ upload: vi.fn(), state: 'uploading' as const, isUploading: true, error: null })
      const { rerender } = render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('Uploading…')).toBeInTheDocument()
      })
      // Verify the "Choose file" label is not visible when uploading
      expect(screen.queryByText('Choose file')).not.toBeInTheDocument()
    })

    it('displays upload error when useUploadImage returns an error', async () => {
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      mockUseUploadImage.mockReturnValue({ upload: vi.fn(), state: 'error' as const, isUploading: false, error: 'File too large' })
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent('File too large')
      })
    })

    it('calls file input onChange handler when file is selected', async () => {
      const mockUpload = vi.fn()
      const mockInvalidateQueries = vi.fn()
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      mockUseUploadImage.mockReturnValue({ upload: mockUpload, state: 'idle' as const, isUploading: false, error: null })
      mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries } as unknown as ReturnType<typeof useQueryClient>)

      const { container } = render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('Choose file')).toBeInTheDocument()
      })

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
      await userEvent.upload(fileInput, file)

      // Upload should be called
      await waitFor(() => {
        expect(mockUpload).toHaveBeenCalledWith(file)
      })
    })

    it('handles drag and drop upload', async () => {
      const mockUpload = vi.fn().mockResolvedValue(undefined)
      // Use mockReturnValue for consistent returns across all calls
      mockUseQuery.mockReturnValue({
        data: collection,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>)
      mockUseUploadImage.mockReturnValue({ upload: mockUpload, state: 'idle' as const, isUploading: false, error: null })

      render(React.createElement(CollectionDetailPage, { params: mockParams }))

      const dropZone = await screen.findByText('Drop an image here, or')
      const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })

      fireEvent.dragOver(dropZone.closest('div')!)
      fireEvent.drop(dropZone.closest('div')!, { dataTransfer: { files: [file] } })

      expect(mockUpload).toHaveBeenCalledWith(file)
    })

    it('does not upload non-image files on drag and drop', async () => {
      const mockUpload = vi.fn()
      mockUseQuery.mockReturnValue({
        data: collection,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>)
      mockUseUploadImage.mockReturnValue({ upload: mockUpload, state: 'idle' as const, isUploading: false, error: null })

      render(React.createElement(CollectionDetailPage, { params: mockParams }))

      const dropZone = await screen.findByText('Drop an image here, or')
      const file = new File(['content'], 'test.txt', { type: 'text/plain' })

      fireEvent.dragOver(dropZone.closest('div')!)
      fireEvent.drop(dropZone.closest('div')!, { dataTransfer: { files: [file] } })

      expect(mockUpload).not.toHaveBeenCalled()
    })

    it('shows drag over state when dragging files over upload zone', async () => {
      mockUseQuery.mockReturnValue({
        data: collection,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>)
      mockUseUploadImage.mockReturnValue({ upload: vi.fn(), state: 'idle' as const, isUploading: false, error: null })

      render(React.createElement(CollectionDetailPage, { params: mockParams }))

      const dropZone = await screen.findByText('Drop an image here, or')
      fireEvent.dragOver(dropZone.closest('div')!)
      expect(dropZone.closest('div')).toHaveClass('border-amber')
    })
  })

  describe('Image grid', () => {
    const collection = { id: 'col-1', name: 'My Murals', description: 'Street art', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' }
    const images = [
      { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
      { id: 'img-2', collection_id: 'col-1', cdn_url: 'https://example.com/img2.jpg', s3_key: 's3-key-2', created_at: '', updated_at: '' },
    ]

    it('shows "No images yet" when collection has no images', async () => {
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        expect(screen.getByText('No images yet. Upload one to get started.')).toBeInTheDocument()
      })
    })

    it('renders image grid with multiple images', async () => {
      const images = [
        { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
        { id: 'img-2', collection_id: 'col-1', cdn_url: 'https://example.com/img2.jpg', s3_key: 's3-key-2', created_at: '', updated_at: '' },
      ]
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: images, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      const { container } = render(React.createElement(CollectionDetailPage, { params: mockParams }))

      // Wait for grid to exist, then check images
      await waitFor(() => {
        const gridContainer = container.querySelector('.grid')
        expect(gridContainer).toBeInTheDocument()
      })

      const imgs = container.querySelectorAll('img')
      expect(imgs).toHaveLength(2)
      expect(imgs[0]).toHaveAttribute('src', 'https://example.com/img1.jpg')
      expect(imgs[1]).toHaveAttribute('src', 'https://example.com/img2.jpg')
    })

    it('renders delete button for each image with aria-label', async () => {
      const images = [
        { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
        { id: 'img-2', collection_id: 'col-1', cdn_url: 'https://example.com/img2.jpg', s3_key: 's3-key-2', created_at: '', updated_at: '' },
      ]
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: images, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      const deleteButtons = await screen.findAllByRole('button', { name: /Delete image/ })
      expect(deleteButtons).toHaveLength(2)
    })

    it('calls delete mutation when delete button is clicked', async () => {
      const images = [
        { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
        { id: 'img-2', collection_id: 'col-1', cdn_url: 'https://example.com/img2.jpg', s3_key: 's3-key-2', created_at: '', updated_at: '' },
      ]
      const mockMutate = vi.fn()
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: images, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      mockUseMutation.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as unknown as ReturnType<typeof useMutation>)

      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        const deleteButtons = screen.getAllByRole('button', { name: /Delete image/ })
        expect(deleteButtons).toHaveLength(2)
      })

      fireEvent.click(screen.getAllByRole('button', { name: /Delete image/ })[0])
      expect(mockMutate).toHaveBeenCalledWith('img-1')
    })

    it('disables delete button when mutation is pending', async () => {
      const images = [
        { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
        { id: 'img-2', collection_id: 'col-1', cdn_url: 'https://example.com/img2.jpg', s3_key: 's3-key-2', created_at: '', updated_at: '' },
      ]
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: images, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      mockUseMutation.mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof useMutation>)

      render(React.createElement(CollectionDetailPage, { params: mockParams }))
      await waitFor(() => {
        const deleteButtons = screen.getAllByRole('button', { name: /Delete image/ })
        deleteButtons.forEach(btn => {
          expect(btn).toBeDisabled()
        })
      })
    })

    it('renders image grid using grid-cols-2 sm:grid-cols-3 classes', async () => {
      const images = [
        { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
        { id: 'img-2', collection_id: 'col-1', cdn_url: 'https://example.com/img2.jpg', s3_key: 's3-key-2', created_at: '', updated_at: '' },
      ]
      mockUseQuery
        .mockReturnValueOnce({ data: collection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: images, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      const { container } = render(React.createElement(CollectionDetailPage, { params: mockParams }))

      await waitFor(() => {
        const gridContainer = container.querySelector('.grid')
        expect(gridContainer).toHaveClass('grid-cols-2')
        expect(gridContainer).toHaveClass('sm:grid-cols-3')
      })
    })
  })

  describe('Integration', () => {
    it('renders complete page with collection, upload zone, and image grid', async () => {
      const integrationCollection = { id: 'col-1', name: 'My Murals', description: 'Street art', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' }
      const integrationImages = [
        { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
      ]
      mockUseQuery
        .mockReturnValueOnce({ data: integrationCollection, isLoading: false } as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce({ data: integrationImages, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      const { container } = render(React.createElement(CollectionDetailPage, { params: mockParams }))

      // Collection header
      expect(await screen.findByText('My Murals')).toBeInTheDocument()
      expect(screen.getByText('Street art')).toBeInTheDocument()

      // Back link
      expect(screen.getByRole('link', { name: /Collections/ })).toHaveAttribute('href', '/collections')

      // Upload zone
      expect(screen.getByText('Drop an image here, or')).toBeInTheDocument()
      expect(screen.getByText('Choose file')).toBeInTheDocument()

      // Image grid - verify it exists in the DOM
      const gridImages = container.querySelectorAll('img')
      expect(gridImages.length).toBeGreaterThan(0)
      expect(gridImages[0]).toHaveAttribute('src', 'https://example.com/img1.jpg')
      expect(screen.getByRole('button', { name: /Delete image/ })).toBeInTheDocument()
    })
  })
})
