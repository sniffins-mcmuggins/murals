# Kanban Within-Column Ranking — Design Spec
**Date:** 2026-06-03
**Status:** Approved

## Problem

The 5-column kanban lets organisers drag applications between decision columns, but cards within a column have no meaningful order. Organisers want to rank applications before deciding — e.g. sort Undecided by preference, or rank the Accept pile by priority for spot assignment.

## Solution

Enable drag-to-reorder within all 5 kanban columns using dnd-kit's `useSortable` pattern. The existing `POST /festivals/{festivalID}/applications/reorder` endpoint and `rank` DB field are already in place — only the frontend needs updating.

---

## API — No changes

`POST /festivals/{festivalID}/applications/reorder` takes `{ status, ids }`, validates all IDs have that status, and sets `rank = 0, 1, 2…`. All pre-release kanban columns contain `status = 'submitted'` apps, so the endpoint works for all 5 columns unchanged.

Post-release: dragging is already disabled, so reordering accepted/declined/waitlisted apps is never triggered.

---

## Frontend

### Three files changed, no new files

#### `ApplicationCard.tsx`
Replace `useDraggable` (from `@dnd-kit/core`) with `useSortable` (from `@dnd-kit/sortable`). The API is identical except `useSortable` also returns `transition`, which enables smooth animation as cards slide to their new positions during a sort. Add `transition` to the card's style object.

#### `KanbanColumn.tsx`
- Accept a new `itemIds: string[]` prop
- Wrap `children` in `<SortableContext items={itemIds} strategy={verticalListSortingStrategy}>`
- Keep `useDroppable` on the outer container — it catches drops on the empty column background for cross-column moves to an empty column

#### `page.tsx`
Three additions:
1. **`reorderMutation`** — calls `/applications/reorder` with `{ status: 'submitted', ids }`. Uses the same optimistic update pattern as `stageMutation`: snapshot local state, apply immediately, revert on error, invalidate on success.
2. **Updated `handleDragEnd`** — distinguishes same-column vs cross-column (see below).
3. **Pass `itemIds`** — `itemIds={columns[col].map(a => a.id ?? '')}` to each `KanbanColumn`.

---

## `handleDragEnd` logic

On drag end, `active.id` is the dragged card's ID and `over.id` is either a card ID or a column key.

```
1. Find which column active card belongs to (activeColumn)
2. Determine targetColumn:
   - If over.id is a column key (e.g. 'accept') → targetColumn = that column key
   - If over.id is a card ID → find which column that card is in → targetColumn = that column
3. If activeColumn === targetColumn AND over.id is a card ID:
   → within-column reorder: arrayMove, optimistic update, reorderMutation
4. If activeColumn !== targetColumn:
   → cross-column move: existing stageMutation (unchanged)
5. If active.id === over.id → no-op
```

**Cross-column drop onto a card**: if you drop a card from Undecided onto a card that's in Accept, `over.id` is a card ID in Accept. Step 2 resolves `targetColumn = 'accept'`, step 4 fires `stageMutation`. The moved card's `rank` is not updated — it takes its natural position in Accept; the organiser can reorder within Accept afterward.

**Empty column background**: `useDroppable` catches these. `over.id` is the column key, step 4 fires `stageMutation`.

**`isDraggable = false` post-release**: `useSortable`'s `disabled` prop prevents any drag events.

---

## Dependency

`@dnd-kit/sortable` is already installed (used by the old `useApplicationReorder` hook). No new packages needed.

---

## What doesn't change

- The existing `useApplicationReorder` hook — no longer used in the kanban but kept for reference
- All API handlers and DB queries
- Post-release read-only behaviour
- The `isReleased` guard on drag
