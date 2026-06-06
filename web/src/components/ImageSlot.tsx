'use client'

import { useRef } from 'react'

export function ImageSlot({
  url,
  label,
  round,
  onFile,
  isUploading,
}: {
  url: string | null
  label: string
  round?: boolean
  onFile: (file: File) => void
  isUploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const shape = round ? 'rounded-full' : 'rounded-lg'
  const size = round ? 'w-24 h-24' : 'w-full h-40'

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className={`${size} ${shape} border-2 border-dashed border-light bg-warm flex items-center justify-center overflow-hidden hover:border-amber transition-colors disabled:opacity-50 relative`}
        aria-label={`Upload ${label}`}
      >
        {url ? (
          <img src={url} alt={label} className={`${size} ${shape} object-cover`} />
        ) : (
          <span className="font-mono text-xs uppercase tracking-widest text-mid">
            {isUploading ? '…' : '+'}
          </span>
        )}
      </button>
      <span className="font-sans text-xs text-mid">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
