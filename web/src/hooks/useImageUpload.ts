'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api'

type UploadState = 'idle' | 'uploading' | 'error'

export interface UploadedImage {
  cdnUrl: string
  s3Key: string
}

/**
 * The full image-upload choreography: presign → PUT to S3/MinIO → confirm.
 * What happens to the confirmed image is the caller's business — attach it to
 * a collection, set it as an avatar, etc. — via onUploaded. Errors thrown by
 * onUploaded are caught and surfaced through the hook's error state.
 */
export function useImageUpload(
  onUploaded: (img: UploadedImage) => void | Promise<void>,
) {
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File): Promise<void> {
    setState('uploading')
    setError(null)
    try {
      // 1. Presign
      const presignRes = await apiClient.POST('/images/presign', {
        body: { contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' },
      })
      if (presignRes.error || !presignRes.data) throw new Error('Failed to get upload URL')
      const { uploadUrl, s3Key } = presignRes.data

      // 2. PUT to S3/MinIO (presigned URL — not our API, raw fetch is correct here)
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error('Failed to upload file')

      // 3. Confirm
      const confirmRes = await apiClient.POST('/images/confirm', { body: { s3Key } })
      if (confirmRes.error || !confirmRes.data) throw new Error('Failed to confirm upload')

      // 4. Caller's post-upload step
      await onUploaded({ cdnUrl: confirmRes.data.cdnUrl, s3Key })

      setState('idle')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  return { upload, state, error, isUploading: state === 'uploading' }
}
