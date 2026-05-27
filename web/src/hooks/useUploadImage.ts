import { useState } from 'react'
import { apiClient } from '@/lib/api'

type UploadState = 'idle' | 'uploading' | 'error'

export function useUploadImage(collectionId: string) {
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

      // 2. PUT to S3/MinIO
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error('Failed to upload file')

      // 3. Confirm
      const confirmRes = await apiClient.POST('/images/confirm', { body: { s3Key } })
      if (confirmRes.error || !confirmRes.data) throw new Error('Failed to confirm upload')
      const { cdnUrl } = confirmRes.data

      // 4. Attach to collection
      const attachRes = await apiClient.POST('/collections/{collectionID}/images', {
        params: { path: { collectionID: collectionId } },
        body: { s3Key, cdnUrl },
      })
      if (attachRes.error) throw new Error('Failed to attach image')

      setState('idle')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  return { upload, state, error, isUploading: state === 'uploading' }
}
