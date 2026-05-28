import { useMutation, useQueryClient } from '@tanstack/react-query'
import { arrayMove } from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

export function useApplicationReorder(
  festivalId: string,
  applications: Application[],
  status: string,
  setApplications: (apps: Application[]) => void
) {
  const queryClient = useQueryClient()

  const reorderMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/reorder', {
        params: { path: { festivalID: festivalId } },
        body: { status, ids },
      })
      if (res.error) throw new Error('Reorder failed')
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = applications.findIndex(a => a.id === active.id)
    const newIndex = applications.findIndex(a => a.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(applications, oldIndex, newIndex)
    setApplications(reordered)
    reorderMutation.mutate(reordered.map(a => a.id ?? ''))
  }

  return { handleDragEnd }
}
