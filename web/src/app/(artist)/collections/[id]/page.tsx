'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { apiClient } from '@/lib/api'
import { useUploadImage } from '@/hooks/useUploadImage'
import type { components } from '@render/api-client'

type CollectionImage = components['schemas']['CollectionImage']

function SortableImageCard({
  img,
  onDelete,
  deleting,
}: {
  img: CollectionImage
  onDelete: () => void
  deleting: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: img.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative group aspect-square bg-warm rounded-lg overflow-hidden border cursor-grab active:cursor-grabbing touch-none
        ${isDragging ? 'border-amber shadow-lg opacity-75 rotate-1' : 'border-light'}`}
    >
      <img src={img.cdn_url} alt="" className="w-full h-full object-cover pointer-events-none" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={deleting}
        className="absolute top-2 right-2 bg-ink/70 text-offwhite rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-clay"
        aria-label="Delete image"
      >
        ×
      </button>
    </div>
  )
}

type Props = { params: Promise<{ id: string }> }

export default function CollectionDetailPage({ params }: Props) {
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Resolve async params (Next.js 15)
  if (!collectionId) {
    params.then(p => setCollectionId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }

  return <CollectionDetail collectionId={collectionId} queryClient={queryClient} />
}

function CollectionDetail({ collectionId, queryClient }: { collectionId: string; queryClient: ReturnType<typeof useQueryClient> }) {
  const { upload, isUploading, error: uploadError } = useUploadImage(collectionId)
  const [dragOver, setDragOver] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor))

  const collectionQuery = useQuery({
    queryKey: ['collection', collectionId],
    queryFn: async () => {
      const res = await apiClient.GET('/collections/{collectionID}', {
        params: { path: { collectionID: collectionId } },
      })
      if (res.error) throw new Error('Failed to load collection')
      return res.data
    },
  })

  const imagesQuery = useQuery({
    queryKey: ['collection-images', collectionId],
    queryFn: async () => {
      const res = await apiClient.GET('/collections/{collectionID}/images', {
        params: { path: { collectionID: collectionId } },
      })
      return res.data ?? []
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const res = await apiClient.DELETE('/collections/{collectionID}/images/{imageID}', {
        params: { path: { collectionID: collectionId, imageID: imageId } },
      })
      if (res.error) throw new Error('Failed to delete image')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collection-images', collectionId] }),
  })

  const reorderMutation = useMutation({
    mutationFn: async (imageIds: string[]) => {
      const res = await apiClient.PUT('/collections/{collectionID}/images/order', {
        params: { path: { collectionID: collectionId } },
        body: { imageIds },
      })
      if (res.error) throw new Error('Failed to save order')
    },
  })

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await upload(file)
    queryClient.invalidateQueries({ queryKey: ['collection-images', collectionId] })
    e.target.value = ''
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return
    await upload(file)
    queryClient.invalidateQueries({ queryKey: ['collection-images', collectionId] })
  }, [upload, queryClient, collectionId])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const images: CollectionImage[] = (imagesQuery.data ?? []) as CollectionImage[]
    const oldIndex = images.findIndex((img) => img.id === active.id)
    const newIndex = images.findIndex((img) => img.id === over.id)
    const reordered = arrayMove(images, oldIndex, newIndex)

    queryClient.setQueryData(['collection-images', collectionId], reordered)

    reorderMutation.mutate(
      reordered.map((img) => img.id),
      {
        onError: () => {
          queryClient.setQueryData(['collection-images', collectionId], images)
        },
      },
    )
  }

  const collection = collectionQuery.data
  const images: CollectionImage[] = (imagesQuery.data ?? []) as CollectionImage[]

  if (collectionQuery.isLoading) return <div className="font-sans text-mid text-sm">Loading…</div>
  if (!collection) return <div className="font-sans text-mid text-sm">Collection not found.</div>

  return (
    <div>
      <div className="mb-6">
        <Link href="/collections" className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Collections
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-1">{collection.name}</h1>
      {collection.description && <p className="font-sans text-mid mb-6">{collection.description}</p>}

      {/* Upload zone — uses native HTML drag events, separate from dnd-kit pointer events */}
      <div
        className={`mb-6 border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragOver ? 'border-amber bg-amber/5' : 'border-light'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <p className="font-sans text-mid text-sm mb-3">
          {isUploading ? 'Uploading…' : 'Drop an image here, or'}
        </p>
        {!isUploading && (
          <label className="cursor-pointer font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90">
            Choose file
            <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </label>
        )}
        {uploadError && <p role="alert" className="mt-2 font-sans text-sm text-clay">{uploadError}</p>}
      </div>

      {/* Image grid */}
      {imagesQuery.isLoading && <p className="font-sans text-mid text-sm">Loading images…</p>}
      {images.length === 0 && !imagesQuery.isLoading && (
        <p className="font-sans text-mid text-sm">No images yet. Upload one to get started.</p>
      )}
      {images.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={images.map((img) => img.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.map((img) => (
                <SortableImageCard
                  key={img.id}
                  img={img}
                  onDelete={() => deleteMutation.mutate(img.id)}
                  deleting={deleteMutation.isPending}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
