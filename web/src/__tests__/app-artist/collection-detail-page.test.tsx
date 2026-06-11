import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient, ok, byPath } from '../helpers/query'

// Real QueryClient drives the queries/mutations; we stub only the API boundary,
// the upload hook (its own choreography is tested separately), and next/link.
const { mockGet, mockPost, mockDelete, mockPut, mockPatch, mockUpload } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockDelete: vi.fn(),
  mockPut: vi.fn(),
  mockPatch: vi.fn(),
  mockUpload: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  apiClient: { GET: mockGet, POST: mockPost, DELETE: mockDelete, PUT: mockPut, PATCH: mockPatch },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: vi.fn(() => ({ upload: mockUpload, state: 'idle' as const, isUploading: false, error: null })),
}))

import { useImageUpload } from '@/hooks/useImageUpload'
import CollectionDetailPage from '@/app/(artist)/collections/[id]/page'

const mockUseImageUpload = vi.mocked(useImageUpload)
const mockParams = Promise.resolve({ id: 'col-abc123' })

const collection = {
  id: 'col-1', name: 'My Murals', description: 'Street art collection',
  status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '',
}
const images = [
  { id: 'img-1', collection_id: 'col-1', cdn_url: 'https://example.com/img1.jpg', s3_key: 's3-key-1', created_at: '', updated_at: '' },
  { id: 'img-2', collection_id: 'col-1', cdn_url: 'https://example.com/img2.jpg', s3_key: 's3-key-2', created_at: '', updated_at: '' },
]

function wireApi(opts: { collection?: unknown; images?: unknown[] } = {}) {
  mockGet.mockImplementation(byPath({
    '/collections/{collectionID}': ok('collection' in opts ? opts.collection : collection),
    '/collections/{collectionID}/images': ok(opts.images ?? []),
  }))
}

function renderPage() {
  return renderWithClient(React.createElement(CollectionDetailPage, { params: mockParams }))
}

describe('CollectionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseImageUpload.mockReturnValue({ upload: mockUpload, state: 'idle' as const, isUploading: false, error: null })
    mockDelete.mockResolvedValue(ok(undefined))
  })

  describe('collection display', () => {
    it('shows "Collection not found" when the collection query returns null', async () => {
      wireApi({ collection: null })
      renderPage()
      expect(await screen.findByText(/Collection not found/)).toBeInTheDocument()
    })

    it('renders the collection name and description', async () => {
      wireApi()
      renderPage()
      expect(await screen.findByText('My Murals')).toBeInTheDocument()
      expect(screen.getByText('Street art collection')).toBeInTheDocument()
    })

    it('links back to the collections list', async () => {
      wireApi()
      renderPage()
      const link = await screen.findByRole('link', { name: /Collections/ })
      expect(link).toHaveAttribute('href', '/collections')
    })
  })

  describe('upload zone', () => {
    it('shows the "Choose file" affordance when idle', async () => {
      wireApi()
      renderPage()
      expect(await screen.findByText('Choose file')).toBeInTheDocument()
    })

    it('shows "Uploading…" and hides the file picker while uploading', async () => {
      mockUseImageUpload.mockReturnValue({ upload: mockUpload, state: 'uploading' as const, isUploading: true, error: null })
      wireApi()
      renderPage()
      expect(await screen.findByText('Uploading…')).toBeInTheDocument()
      expect(screen.queryByText('Choose file')).not.toBeInTheDocument()
    })

    it('surfaces an upload error from the hook', async () => {
      mockUseImageUpload.mockReturnValue({ upload: mockUpload, state: 'error' as const, isUploading: false, error: 'File too large' })
      wireApi()
      renderPage()
      expect(await screen.findByRole('alert')).toHaveTextContent('File too large')
    })

    it('uploads the chosen file via the input', async () => {
      wireApi()
      const { container } = renderPage()
      await screen.findByText('Choose file')
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
      await userEvent.upload(fileInput, file)
      await waitFor(() => expect(mockUpload).toHaveBeenCalledWith(file))
    })

    it('uploads an image dropped on the zone, but ignores non-images', async () => {
      wireApi()
      renderPage()
      const dropZone = (await screen.findByText('Drop an image here, or')).closest('div')!

      const img = new File(['content'], 'a.jpg', { type: 'image/jpeg' })
      fireEvent.dragOver(dropZone)
      fireEvent.drop(dropZone, { dataTransfer: { files: [img] } })
      expect(mockUpload).toHaveBeenCalledWith(img)

      mockUpload.mockClear()
      const txt = new File(['content'], 'a.txt', { type: 'text/plain' })
      fireEvent.drop(dropZone, { dataTransfer: { files: [txt] } })
      expect(mockUpload).not.toHaveBeenCalled()
    })

    it('highlights the drop zone while dragging over it', async () => {
      wireApi()
      renderPage()
      const dropZone = (await screen.findByText('Drop an image here, or')).closest('div')!
      fireEvent.dragOver(dropZone)
      expect(dropZone).toHaveClass('border-amber')
    })
  })

  describe('image grid', () => {
    it('shows the empty state when there are no images', async () => {
      wireApi({ images: [] })
      renderPage()
      expect(await screen.findByText('No images yet. Upload one to get started.')).toBeInTheDocument()
    })

    it('renders one tile per image with the correct sources', async () => {
      wireApi({ images })
      const { container } = renderPage()
      await screen.findByText('My Murals')
      await waitFor(() => {
        const imgs = container.querySelectorAll('img')
        expect(imgs).toHaveLength(2)
        expect(imgs[0]).toHaveAttribute('src', 'https://example.com/img1.jpg')
        expect(imgs[1]).toHaveAttribute('src', 'https://example.com/img2.jpg')
      })
    })

    it('renders a labelled delete button per image', async () => {
      wireApi({ images })
      renderPage()
      const buttons = await screen.findAllByRole('button', { name: /Delete image/ })
      expect(buttons).toHaveLength(2)
    })

    it('calls the delete endpoint for the clicked image', async () => {
      wireApi({ images })
      renderPage()
      const buttons = await screen.findAllByRole('button', { name: /Delete image/ })
      fireEvent.click(buttons[0])
      await waitFor(() =>
        expect(mockDelete).toHaveBeenCalledWith(
          '/collections/{collectionID}/images/{imageID}',
          expect.objectContaining({ params: { path: { collectionID: 'col-abc123', imageID: 'img-1' } } }),
        ),
      )
    })

    it('disables the delete buttons while a delete is in flight', async () => {
      // A never-resolving DELETE keeps the mutation pending so the buttons stay disabled.
      mockDelete.mockReturnValue(new Promise(() => {}))
      wireApi({ images })
      renderPage()
      const buttons = await screen.findAllByRole('button', { name: /Delete image/ })
      fireEvent.click(buttons[0])
      await waitFor(() => {
        for (const btn of screen.getAllByRole('button', { name: /Delete image/ })) {
          expect(btn).toBeDisabled()
        }
      })
    })
  })
})
