import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  apiClient: { POST: vi.fn() },
}))

import { apiClient } from '@/lib/api'
import { useImageUpload } from '@/hooks/useImageUpload'

const mockPOST = vi.mocked(apiClient.POST)
const file = new File(['x'], 'mural.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('useImageUpload', () => {
  it('runs presign → PUT → confirm → onUploaded with cdnUrl and s3Key', async () => {
    mockPOST
      .mockResolvedValueOnce({ data: { uploadUrl: 'http://minio/put', s3Key: 'k1' }, error: undefined } as never)
      .mockResolvedValueOnce({ data: { cdnUrl: 'http://cdn/k1' }, error: undefined } as never)
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useImageUpload(onUploaded))

    await act(() => result.current.upload(file))

    expect(mockPOST).toHaveBeenNthCalledWith(1, '/images/presign', {
      body: { contentType: 'image/jpeg' },
    })
    expect(fetch).toHaveBeenCalledWith('http://minio/put', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: file,
    })
    expect(mockPOST).toHaveBeenNthCalledWith(2, '/images/confirm', { body: { s3Key: 'k1' } })
    expect(onUploaded).toHaveBeenCalledWith({ cdnUrl: 'http://cdn/k1', s3Key: 'k1' })
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('sets error state when presign fails', async () => {
    mockPOST.mockResolvedValueOnce({ data: undefined, error: { message: 'nope' } } as never)
    const { result } = renderHook(() => useImageUpload(vi.fn()))

    await act(() => result.current.upload(file))

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('Failed to get upload URL')
  })

  it('sets error state when the S3 PUT fails', async () => {
    mockPOST.mockResolvedValueOnce({ data: { uploadUrl: 'http://minio/put', s3Key: 'k1' }, error: undefined } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { result } = renderHook(() => useImageUpload(vi.fn()))

    await act(() => result.current.upload(file))

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('Failed to upload file')
  })

  it('catches errors thrown by onUploaded (e.g. attach failure)', async () => {
    mockPOST
      .mockResolvedValueOnce({ data: { uploadUrl: 'http://minio/put', s3Key: 'k1' }, error: undefined } as never)
      .mockResolvedValueOnce({ data: { cdnUrl: 'http://cdn/k1' }, error: undefined } as never)
    const { result } = renderHook(() =>
      useImageUpload(() => {
        throw new Error('Failed to attach image')
      }),
    )

    await act(() => result.current.upload(file))

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('Failed to attach image')
  })
})
