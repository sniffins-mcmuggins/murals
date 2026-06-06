'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api'

type UploadState = 'idle' | 'uploading' | 'error'

export function useProfileImageUpload(onComplete: (cdnUrl: string, s3Key: string) => void) {
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File): Promise<void> {
    setState('uploading')
    setError(null)
    try {
      const presignRes = await apiClient.POST('/images/presign', {
        body: { contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' },
      })
      if (presignRes.error || !presignRes.data) throw new Error('Failed to get upload URL')
      const { uploadUrl, s3Key } = presignRes.data

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error('Failed to upload file')

      const confirmRes = await apiClient.POST('/images/confirm', { body: { s3Key } })
      if (confirmRes.error || !confirmRes.data) throw new Error('Failed to confirm upload')

      onComplete(confirmRes.data.cdnUrl, s3Key)
      setState('idle')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  return { upload, state, error, isUploading: state === 'uploading' }
}
