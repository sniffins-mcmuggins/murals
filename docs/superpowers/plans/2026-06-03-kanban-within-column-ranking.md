# Kanban Within-Column Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organisers drag-to-reorder application cards within each of the 5 kanban columns, ranking them before/after deciding.

**Architecture:** Swap the kanban cards from dnd-kit `useDraggable` to `useSortable`, wrap each column's cards in a `SortableContext`, and split `handleDragEnd` into two paths: same-column drops reorder (existing `/applications/reorder` endpoint), cross-column drops stage a decision (existing `stageMutation`). No API or DB changes — the `rank` field and reorder endpoint already exist.

**Tech Stack:** Next.js App Router, @dnd-kit/core + @dnd-kit/sortable (already installed), @tanstack/react-query, TypeScript.

---

### Task 1: Convert ApplicationCard to useSortable

**Files:**
- Modify: `web/src/components/ApplicationCard.tsx`

The card currently uses `useDraggable` from `@dnd-kit/core`. `useSortable` (from `@dnd-kit/sortable`) has the same return shape plus a `transition` value that animates cards sliding into new positions during a sort.

- [ ] **Step 1: Swap the import**

In `web/src/components/ApplicationCard.tsx`, change line 3 from:

```tsx
import { useDraggable } from '@dnd-kit/core'
```

to:

```tsx
import { useSortable } from '@dnd-kit/sortable'
```

- [ ] **Step 2: Swap the hook call and add transition to style**

Replace the hook call and style object (currently lines 33-39):

```tsx
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: application.id ?? '', disabled: !isDraggable })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }
```

with:

```tsx
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: application.id ?? '', disabled: !isDraggable })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
```

(`CSS` is already imported from `@dnd-kit/utilities` on line 4 — leave that import as-is. `CSS.Translate.toString` works fine with `useSortable`'s transform.)

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/adampowis/workspace/murals && task web:lint
```

Expected: passes (only pre-existing `<img>` warnings). The `transition` value from `useSortable` is typed `string | undefined`, which is a valid CSS style value — no type error.

- [ ] **Step 4: Run the card component tests**

```bash
cd /Users/adampowis/workspace/murals/web && npx vitest run "ApplicationCard"
```

Expected: PASS. Note — the existing test mocks `@dnd-kit/core`'s `useDraggable`. Because the card now imports from `@dnd-kit/sortable`, the test's mock must be updated. If the test fails with "useSortable is not a function" or a null-destructure error, update the mock: find the `vi.mock('@dnd-kit/core', ...)` block in `web/src/__tests__/components/ApplicationCard.test.tsx` and add a sibling mock for the sortable package:

```tsx
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))
```

Keep the existing `@dnd-kit/core` mock too (the page still uses `DndContext`/`useDroppable` from core). Re-run until PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/adampowis/workspace/murals
git add web/src/components/ApplicationCard.tsx web/src/__tests__/components/ApplicationCard.test.tsx
git commit -m "feat(web): ApplicationCard uses useSortable for within-column reordering"
```

---

### Task 2: Wrap KanbanColumn children in SortableContext

**Files:**
- Modify: `web/src/components/KanbanColumn.tsx`

The column needs to register its card IDs with a `SortableContext` so dnd-kit can compute sort positions within the column. The existing `useDroppable` stays — it catches drops on the empty column background for cross-column moves into an empty column.

- [ ] **Step 1: Update imports and Props**

Replace the entire contents of `web/src/components/KanbanColumn.tsx` with:

```tsx
'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

interface Props {
  id: string
  label: string
  count: number
  headerClass: string
  borderColor: string
  itemIds: string[]
  children: React.ReactNode
  isReleased?: boolean
}

export function KanbanColumn({ id, label, count, headerClass, borderColor, itemIds, children, isReleased }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={isReleased ? undefined : setNodeRef}
      className={`flex flex-col gap-1 transition-colors ${isOver ? 'bg-warm/60 rounded-lg' : ''}`}
    >
      <div className={`font-mono text-xs font-bold uppercase tracking-widest mb-2 pb-1 border-b-2 ${headerClass} ${borderColor}`}>
        {label} <span className="text-light font-normal">({count})</span>
      </div>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {children}
        </div>
      </SortableContext>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/adampowis/workspace/murals && task web:lint
```

Expected: This will FAIL on `page.tsx` because `KanbanColumn` is now called without the required `itemIds` prop. That is expected — Task 3 fixes the call site. If the ONLY error is the missing `itemIds` prop on the `<KanbanColumn>` usage in `page.tsx`, proceed. (Do not commit yet — Tasks 2 and 3 commit together since the type only resolves after both.)

---

### Task 3: Wire reorder mutation and split handleDragEnd in page.tsx

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`

This task adds a `reorderMutation`, rewrites `handleDragEnd` to distinguish same-column reorder from cross-column staging, and passes `itemIds` to each column.

- [ ] **Step 1: Add the arrayMove + SortableContext imports**

In `web/src/app/organiser/festivals/[id]/applications/page.tsx`, line 5 currently imports from `@dnd-kit/core`:

```tsx
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
```

Add a new import line directly after it:

```tsx
import { arrayMove } from '@dnd-kit/sortable'
```

- [ ] **Step 2: Add reorderMutation**

The page already has a `stageMutation`, `patchMutation`, and `scoreMutation` defined with the same shape. Find the closing `})` of `scoreMutation` (it ends with `onSuccess: invalidate,` then `})`). Immediately after `scoreMutation`'s closing `})`, add:

```tsx
  const reorderMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/reorder', {
        params: { path: { festivalID: festivalId } },
        body: { status: 'submitted', ids },
      })
      if (res.error) throw new Error('Reorder failed')
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })
```

Note: there is no optimistic `onMutate` here because `handleDragEnd` (Step 4) already updates `localApps` synchronously before calling the mutation. `onError` re-fetches to discard the bad local order.

- [ ] **Step 3: Find the current handleDragEnd**

The current `handleDragEnd` (around lines 279-301) looks like this:

```tsx
  const handleDragEnd = (event: DragEndEvent) => {
    if (isReleased) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const appId = active.id as string
    const targetColumn = over.id as ColumnKey
    const app = allApps.find(a => a.id === appId)
    if (!app) return

    const decisionMap: Partial<Record<ColumnKey, string | null>> = {
      accept: 'accept', waitlist: 'waitlist', decline: 'decline',
      undecided: null, shortlisted: null,
    }
    if (!(targetColumn in decisionMap)) return

    stageMutation.mutate({
      appId,
      stagedDecision: decisionMap[targetColumn] ?? null,
      shortlisted: targetColumn === 'shortlisted',
      reviewFlag: app.review_flag ?? false,
    })
  }
```

- [ ] **Step 4: Replace handleDragEnd**

Replace that entire block with:

```tsx
  const handleDragEnd = (event: DragEndEvent) => {
    if (isReleased) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const appId = active.id as string
    const app = allApps.find(a => a.id === appId)
    if (!app) return

    const activeColumn = getColumn(app, isReleased)

    // Resolve the target column: over.id is either a column key or a card id.
    const overId = over.id as string
    let targetColumn: ColumnKey
    if (overId in COLUMN_META) {
      targetColumn = overId as ColumnKey
    } else {
      const overApp = allApps.find(a => a.id === overId)
      if (!overApp) return
      targetColumn = getColumn(overApp, isReleased)
    }

    // Same column AND dropped on a card → reorder within the column.
    if (activeColumn === targetColumn && !(overId in COLUMN_META)) {
      const colApps = columns[activeColumn]
      const oldIndex = colApps.findIndex(a => a.id === appId)
      const newIndex = colApps.findIndex(a => a.id === overId)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(colApps, oldIndex, newIndex)
      // Splice the reordered column back into the full local list.
      const reorderedIds = new Set(reordered.map(a => a.id))
      setLocalApps(prev => {
        const base = prev ?? allApps
        const others = base.filter(a => !reorderedIds.has(a.id))
        return [...others, ...reordered]
      })
      reorderMutation.mutate(reordered.map(a => a.id ?? ''))
      return
    }

    // Different column → stage a decision (or clear it).
    if (activeColumn === targetColumn) return  // same column, dropped on empty bg — no-op

    const decisionMap: Partial<Record<ColumnKey, string | null>> = {
      accept: 'accept', waitlist: 'waitlist', decline: 'decline',
      undecided: null, shortlisted: null,
    }
    stageMutation.mutate({
      appId,
      stagedDecision: decisionMap[targetColumn] ?? null,
      shortlisted: targetColumn === 'shortlisted',
      reviewFlag: app.review_flag ?? false,
    })
  }
```

Key points:
- `getColumn` and `COLUMN_META` are already defined at module scope in this file.
- `columns` is the already-computed `Record<ColumnKey, Application[]>` memo.
- Reorder updates `localApps` synchronously (which feeds `allApps` → `columns`), so the UI reflects the new order immediately; `reorderMutation` persists it.
- The reorder builds the new full list as `[...others, ...reordered]`. Because `columns` is recomputed from `allApps` via `getColumn` bucketing (not by array position) and within-column order is preserved by stable iteration, the reordered cards keep their new relative order. The server's `rank` (set by the reorder endpoint, `ORDER BY rank ASC, created_at ASC`) makes this durable on next fetch.

- [ ] **Step 5: Pass itemIds to each KanbanColumn**

Find the `<KanbanColumn>` usage (around lines 368-376). It currently passes `id`, `label`, `count`, `headerClass`, `borderColor`, `isReleased`. Add `itemIds`:

```tsx
              <KanbanColumn
                key={col}
                id={col}
                label={COLUMN_META[col].label}
                count={columns[col].length}
                headerClass={COLUMN_META[col].headerClass}
                borderColor={COLUMN_META[col].borderColor}
                itemIds={columns[col].map(a => a.id ?? '')}
                isReleased={isReleased}
              >
```

- [ ] **Step 6: Run typecheck**

```bash
cd /Users/adampowis/workspace/murals && task web:lint
```

Expected: passes (only pre-existing `<img>` warnings). The `itemIds` prop now satisfies `KanbanColumn`'s required prop from Task 2.

- [ ] **Step 7: Run the page tests**

```bash
cd /Users/adampowis/workspace/murals/web && npx vitest run "applications-page"
```

Expected: PASS (15 tests). These tests mock `@dnd-kit/core` and don't simulate real drag events, so the new reorder branch won't break them. If a test fails because the mock for `@dnd-kit/sortable` is missing `arrayMove`, add it to that file's existing dnd mock:

```tsx
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  verticalListSortingStrategy: {},
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: false }),
  arrayMove: <T,>(arr: T[]) => arr,
}))
```

Re-run until PASS.

- [ ] **Step 8: Commit (Tasks 2 + 3 together)**

```bash
cd /Users/adampowis/workspace/murals
git add web/src/components/KanbanColumn.tsx \
  web/src/app/organiser/festivals/\[id\]/applications/page.tsx \
  web/src/__tests__/organiser/applications-page.test.tsx
git commit -m "feat(web): within-column drag reordering in kanban via SortableContext"
```

---

### Task 4: Add a unit test for the reorder branch

**Files:**
- Modify: `web/src/__tests__/organiser/applications-page.test.tsx`

The existing tests verify column bucketing and the release button. Add one test that confirms `reorderMutation` (i.e. the `/applications/reorder` POST) fires when a same-column drag occurs. Since the page mocks dnd-kit and never dispatches real drag events, the cleanest verification is at the integration boundary: assert that `apiClient.POST` is called with the reorder path when `handleDragEnd` runs with a same-column `over`.

This requires invoking `handleDragEnd` indirectly. The simplest robust approach: mock `DndContext` so its `onDragEnd` prop is captured and can be fired from the test.

- [ ] **Step 1: Check how DndContext is currently mocked**

```bash
cd /Users/adampowis/workspace/murals
grep -n "DndContext\|dnd-kit/core" web/src/__tests__/organiser/applications-page.test.tsx
```

Read the existing mock block so you extend it rather than duplicate it.

- [ ] **Step 2: Capture onDragEnd in the DndContext mock**

In the `vi.mock('@dnd-kit/core', ...)` block, make `DndContext` capture its `onDragEnd` to a module-scoped variable so the test can fire a synthetic drag event. Replace the `DndContext` entry in the mock with:

```tsx
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd?: (e: unknown) => void }) => {
    ;(globalThis as Record<string, unknown>).__onDragEnd = onDragEnd
    return children
  },
```

Keep the other `@dnd-kit/core` exports (`useDroppable`, `PointerSensor`, `useSensor`, `useSensors`) in the mock as they were.

- [ ] **Step 3: Write the test**

Add this test inside the main `describe` block (place it after the "confirmation modal" test):

```tsx
  it('fires the reorder endpoint when a card is dragged within its column', async () => {
    const { apiClient } = await import('@/lib/api')
    ;(apiClient.POST as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {}, error: null })

    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: null, shortlisted: false }),
      createMockApplication('app-2', 'artist-2', { staged_decision: null, shortlisted: false }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect((globalThis as Record<string, unknown>).__onDragEnd).toBeDefined()
    })

    // Both apps are in the Undecided column. Drag app-1 onto app-2 (same column → reorder).
    const onDragEnd = (globalThis as Record<string, unknown>).__onDragEnd as (e: unknown) => void
    onDragEnd({ active: { id: 'app-1' }, over: { id: 'app-2' } })

    await waitFor(() => {
      const calls = (apiClient.POST as ReturnType<typeof vi.fn>).mock.calls
      const reorderCall = calls.find(c => c[0] === '/festivals/{festivalID}/applications/reorder')
      expect(reorderCall).toBeDefined()
      expect(reorderCall?.[1]?.body?.ids).toEqual(['app-2', 'app-1'])
    })
  })
```

Note: `arrayMove(['app-1','app-2'], 0, 1)` produces `['app-2','app-1']`, which is what the reorder body should contain. If your `@dnd-kit/sortable` mock stubbed `arrayMove` to return the array unchanged (from Task 3 Step 7), the real `arrayMove` is needed here — so in this test file, do NOT stub `arrayMove`; instead use the real implementation by importing it. If the file's sortable mock stubs `arrayMove`, change that stub to delegate to the real one:

```tsx
vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>()
  return {
    SortableContext: ({ children }: { children: React.ReactNode }) => children,
    verticalListSortingStrategy: {},
    useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: false }),
    arrayMove: actual.arrayMove,
  }
})
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/adampowis/workspace/murals/web && npx vitest run "applications-page"
```

Expected: PASS (16 tests). If the reorder body assertion fails with the wrong order, confirm `arrayMove` is the real implementation (not a stub).

- [ ] **Step 5: Commit**

```bash
cd /Users/adampowis/workspace/murals
git add web/src/__tests__/organiser/applications-page.test.tsx
git commit -m "test(web): assert reorder endpoint fires on same-column drag"
```

---

### Task 5: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Ensure the stack is running**

```bash
cd /Users/adampowis/workspace/murals
curl -sf http://localhost:8080/healthz && curl -sf http://localhost:3000 -o /dev/null -w "web: %{http_code}\n"
```

If not running: `task up` and wait for both to respond.

- [ ] **Step 2: Seed and verify in the browser**

```bash
cd /Users/adampowis/workspace/murals && task demo:seed
```

Log in as `marcus@cpf-demo.art` / `demo-password-2027`, navigate to CPF 2027 → Applications. Verify:
- Dragging a card up/down within the Undecided column reorders it and the order persists after a page refresh (confirms `rank` was saved).
- Dragging a card from Undecided to Accept still stages the decision (cross-column move unaffected).
- Dragging within the Accept column (after staging 2+ cards there) reorders them.
- After releasing decisions, dragging is disabled in all columns.

- [ ] **Step 3: Report results**

Note any discrepancy between expected and observed behaviour. No commit for this task.

---

## Self-Review Checklist

- [ ] `task web:lint` passes
- [ ] `npx vitest run "ApplicationCard"` passes
- [ ] `npx vitest run "applications-page"` passes (16 tests)
- [ ] Manual: within-column reorder persists across refresh in all 5 columns
- [ ] Manual: cross-column staging still works
- [ ] Manual: post-release dragging disabled
