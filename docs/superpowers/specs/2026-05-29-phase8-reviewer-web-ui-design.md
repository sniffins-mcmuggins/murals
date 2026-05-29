# Phase 8: Reviewer Web UI — Design Spec

**Date:** 2026-05-29
**Status:** Approved
**Scope:** Web UI for the festival reviewer / panellist accounts backend (#160). No new API endpoints — this is purely a frontend feature consuming the endpoints already shipped.

---

## Overview

PR #160 delivered the full backend: reviewer accounts, score upsert, enriched application list with `avg_score` / `score_count` / `my_score`, note authorship, and `GET /me/reviewing`. This spec covers the five UI surfaces that expose that backend to users.

---

## Decisions

| Question | Decision |
|---|---|
| Reviewer entry point | "Reviewing (N)" card on the organiser dashboard alongside "Festivals" |
| Score control style | 5-star tap-to-rate (click to set, click again to change) |
| Avg score visibility | Hidden until `my_score != null` — always-on, no toggle |
| Reviewer management placement | Section on the existing `/organiser/festivals/[id]` settings page |
| Reviewer board vs owner board | Decision controls (Accept/Waitlist/Decline), drag handles, and flag toggles **absent** from the DOM for reviewers — not disabled, not greyed out |
| Reviewer reordering | Out of scope — score is the ranking signal; owner breaks ties with drag-reorder |

---

## 1. Files

| File | Change |
|---|---|
| `web/src/app/organiser/dashboard/page.tsx` | Fetch `GET /me/reviewing`; render "Reviewing (N)" card when result is non-empty |
| `web/src/app/organiser/reviewing/page.tsx` | **New** — `/organiser/reviewing` route listing festivals-to-review |
| `web/src/app/organiser/festivals/[id]/page.tsx` | Add Reviewers section below festival details |
| `web/src/components/ApplicationCard.tsx` | Add avg-score badge; accept `isReviewer` prop removing drag/flags/actions |
| `web/src/components/ApplicationSlideOver.tsx` | Add star score control; hide action buttons for reviewers; gate avg on `my_score` |
| `web/src/app/organiser/festivals/[id]/applications/page.tsx` | Detect owner vs reviewer; pass `isReviewer`; add score mutation; skip DndContext for reviewers |
| `web/src/__tests__/organiser/applications-page.test.tsx` | Extend with reviewer-mode assertions |
| `e2e/browser/reviewer-board.spec.ts` | **New** — reviewer board browser spec (5 cases) |
| `e2e/browser/reviewer-management.spec.ts` | **New** — reviewer management + dashboard + dual-role browser spec (5 cases) |

---

## 2. Owner vs reviewer detection

After loading applications, call `GET /festivals/{id}/reviewers`. If the response is `403`, the caller is a reviewer (not the owner). If it succeeds, the caller is the owner. Store as a `isReviewer: boolean` in component state. This uses an endpoint that already exists and requires no new JWT claims or `/me` changes.

```ts
// In ApplicationsView, after applicationsQuery
// Use a sentinel to distinguish "403 (reviewer)" from "200 with empty list (owner with no reviewers yet)".
const REVIEWER_SENTINEL = 'REVIEWER' as const

const reviewersQuery = useQuery({
  queryKey: ['festival-reviewers', festivalId],
  queryFn: async () => {
    const res = await apiClient.GET('/festivals/{festivalID}/reviewers', {
      params: { path: { festivalID: festivalId } },
    })
    if (res.response.status === 403) return REVIEWER_SENTINEL
    return res.data ?? []
  },
})
const isReviewer = reviewersQuery.data === REVIEWER_SENTINEL
```

The DndContext and SortableContext wrappers are skipped entirely when `isReviewer` is true — a plain `<ul>` replaces them.

---

## 3. Score mutation

A new `scoreMutation` in `ApplicationsView`:

```ts
const scoreMutation = useMutation({
  mutationFn: async ({ applicationId, score }: { applicationId: string; score: number }) => {
    const res = await apiClient.PUT(
      '/festivals/{festivalID}/applications/{applicationID}/score',
      {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
        body: { score },
      }
    )
    if (res.error) throw new Error('Score failed')
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] }),
})
```

Passed to `ApplicationSlideOver` as `onScore`. Optimistic update: update `my_score` in local state immediately, roll back on error.

---

## 4. `ApplicationCard` changes

New prop: `isReviewer: boolean`.

**When `isReviewer` is true:**
- Drag handle (`⠿` button + `useSortable`) removed from the DOM
- Shortlist (`⭐`) and review-flag (`🚩`) buttons removed
- Accept / Waitlist / Decline buttons removed
- Replaced in the right-hand slot by: empty stars if `my_score == null`, or filled stars + compact avg if `my_score != null`

**Score badge (shown to both owner and reviewer once `my_score != null`):**
```
★ 3.5 · 2
```
Rendered as `font-mono text-xs text-mid` — same style as the applied-date text. Sits in the top-right of the card.

**When `isReviewer` is false (owner):**
- Badge shown when `score_count > 0`, hidden when 0
- All existing controls unchanged

---

## 5. `ApplicationSlideOver` changes

New props: `isReviewer: boolean`, `onScore: (id: string, score: number) => void`.

**Score section** — inserted above "Internal Notes":

```
YOUR SCORE                    ← font-mono xs uppercase label
★ ★ ★ ★ ☆                    ← 5 interactive stars, filled to my_score
4 / 5  · click to change      ← shown when my_score != null
                              ← "Not yet scored" when my_score == null
```

- Clicking a star fires `onScore(id, n)` immediately (no submit button)
- Optimistic update: update the displayed star state locally before the mutation resolves, roll back on error
- When `my_score == null`: avg section is hidden entirely

**Panel average** (below score control, visible only when `my_score != null`):
```
PANEL AVERAGE
★ 3.5  from 2 reviewers
```

**Action buttons** (Accept / Waitlist / Decline): rendered only when `!isReviewer`. For reviewers the actions section is absent entirely — no disabled state, no tooltip.

---

## 6. Reviewer management section (`/organiser/festivals/[id]`)

Added as a `<section>` below the existing festival details form. Visible only to the festival owner (the page already requires ownership to load festival data; a 403 on the reviewers fetch means the visitor is a reviewer, not an owner — hide the section in that case).

**Three states:**

**Empty:**
```
REVIEWERS
No reviewers yet. Invite someone by email to score applications.
[email input] [Invite button]
```

**With reviewers:**
```
REVIEWERS
hannah@example.com    pending     [Remove]
jo@example.com        accepted    [Remove]

[email input] [Invite button]
```

- `accepted_at != null` → "accepted" badge (font-mono xs, bg-warm border)
- `accepted_at == null` → "pending" badge (same style, muted)
- Remove fires `DELETE /festivals/{id}/reviewers/{userID}`, then invalidates the reviewers query
- Invite fires `POST /festivals/{id}/reviewers { email }`, clears the input on success, shows inline error on failure (e.g. "Invalid email")
- Email validated as non-empty + contains `@` before the request fires

---

## 7. Dashboard ("Reviewing" card)

`GET /me/reviewing` is called in `dashboard/page.tsx`. If the array is empty, no card is shown — pure organisers never see it.

```tsx
// Only rendered when reviewingFestivals.length > 0
<Link href="/organiser/reviewing" className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors">
  <h2 className="font-serif text-xl text-ink mb-1">Reviewing ({reviewingFestivals.length})</h2>
  <p className="font-sans text-sm text-mid">Festivals you've been invited to review.</p>
</Link>
```

---

## 8. Reviewing page (`/organiser/reviewing`)

New route at `web/src/app/organiser/reviewing/page.tsx`.

Fetches `GET /me/reviewing`. Renders a list of festival cards:

```
Cheltenham Paint Festival 2027    open
Go to applications →
```

Each card links to `/organiser/festivals/{id}/applications`. Empty state: "You haven't been invited to review any festivals yet."

---

## 9. Testing

### Unit tests (vitest + testing-library)

Extend `web/src/__tests__/organiser/applications-page.test.tsx`:
- With `isReviewer=true` mock: asserts `Accept`, `Waitlist`, `Decline`, `⭐`, `🚩` buttons **absent** from the DOM; star control present
- avg badge hidden when `my_score == null`; visible when `my_score = 4`

New `web/src/__tests__/components/ApplicationCard.test.tsx`:
- `isReviewer=false`: drag handle, flag buttons, action buttons all present
- `isReviewer=true`: those elements absent; star score control present

New `web/src/__tests__/components/ApplicationSlideOver.test.tsx`:
- Score section renders; avg hidden pre-score, shown after `my_score` set
- `isReviewer=true`: action buttons absent

New `web/src/__tests__/organiser/festivals-detail-reviewers.test.tsx`:
- Reviewer list renders with pending/accepted badges
- Invite form present; empty state shown when list empty

### Browser specs (Playwright)

**`e2e/browser/reviewer-board.spec.ts`** — 5 cases:

1. **Read-only board** — reviewer logs in, navigates to `/organiser/festivals/{id}/applications`, asserts `Accept`, `Waitlist`, `Decline` buttons **absent** from DOM; drag handle absent; flag buttons absent; star control visible
2. **Score submission + avg unlock** — reviewer clicks 4th star; star state reflects 4; `avg_score` badge appears on the card; avg section appears in slide-over
3. **Score persists on reload** — after scoring, full page reload; star state shows 4 filled; avg still visible (not re-hidden)
4. **Re-scoring** — with `my_score = 4`, click 2nd star; stars update to 2; persists on reload
5. **COI empty board** — reviewer who is the only applicant to the festival sees "No applications here." on pending tab; no crash

**`e2e/browser/reviewer-management.spec.ts`** — 5 cases:

1. **Invite + pending badge** — organiser invites an existing user by email; reviewer row appears in the settings page with "pending" badge
2. **Reviewer board is read-only** — invited reviewer logs in, navigates to the festival's applications page; no decision controls in DOM (same assertion as case 1 above — belt and braces from a different setup path)
3. **Full entry-point flow** — reviewer logs in → dashboard shows "Reviewing (1)" card → click → `/organiser/reviewing` lists the festival → "Go to applications →" → lands on read-only board
4. **Dual-role: organiser invited to review a peer festival** — user A creates festival A, user B creates festival B, user B invites user A as a reviewer; user A's dashboard shows both "Festivals" card (from festival A) and "Reviewing (1)" card (from festival B)
5. **Reviewing page with multiple festivals** — user invited to 2 festivals; `/organiser/reviewing` lists both

---

## 10. Out of scope

- Anonymous review toggle (`anonymous_review` field on application forms) — tracked as #158
- Score badge in the public-facing artist profile or festival map
- Email notifications when a reviewer scores (no such notification exists in the current system)
