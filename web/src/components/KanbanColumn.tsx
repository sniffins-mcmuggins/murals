'use client'

import { useDroppable } from '@dnd-kit/core'

interface Props {
  id: string
  label: string
  count: number
  headerClass: string
  borderColor: string
  children: React.ReactNode
  isReleased?: boolean
}

export function KanbanColumn({ id, label, count, headerClass, borderColor, children, isReleased }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={isReleased ? undefined : setNodeRef}
      className={`flex flex-col gap-1 transition-colors ${isOver ? 'bg-warm/60 rounded-lg' : ''}`}
    >
      <div className={`font-mono text-xs font-bold uppercase tracking-widest mb-2 pb-1 border-b-2 ${headerClass} ${borderColor}`}>
        {label} <span className="text-light font-normal">({count})</span>
      </div>
      <div className="flex flex-col gap-2">
        {children}
      </div>
    </div>
  )
}
