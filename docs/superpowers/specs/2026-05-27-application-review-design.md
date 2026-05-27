# Application Review — Design Spec

**Date:** 2026-05-27
**Status:** Approved
**Scope:** Full organiser application review workflow — tabbed list UI, waitlist status, internal flags, notes, drag-to-rank, email notifications.

---

## Overview

Organisers review artist applications through a tabbed interface on the browser platform. Each tab corresponds to a status bucket. Applications can be accepted, declined, waitlisted, shortlisted, flagged for team review, reordered within a bucket by dragging, and annotated with internal notes. Email notifications fire on any status change.

This replaces the existing bare-bones flat list (accept/decline only, no artist names, no notes).

---

## 1. Database

**Migration:** `db/migrations/000007_application_review.up.sql`

```sql
ALTER TYPE application_status ADD VALUE 'waitlisted';

ALTER TABLE applications
  ADD COLUMN rank        int  NOT NULL DEFAULT 0,
  ADD COLUMN shortlisted bool NOT NULL DEFAULT false,
  ADD COLUMN review_flag bool NOT NULL DEFAULT false;

CREATE TABLE application_notes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  content        text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

**`rank`** sorts applications within a status bucket — lower value = higher in list. When the organiser reorders, the API overwrites all ranks for that bucket in a single transaction.

**`shortlisted` / `review_flag`** are organiser-internal — never surfaced to artists.

**`application_notes`** is a separate table (not JSONB) to position for future team attribution (`author_user_id`) without a migration.

---

## 2. SQL Queries

New and modified queries in `db/queries/`:

### applications.sql additions

```sql
-- name: ListApplicationsByFormWithArtist :many
-- Joins artist_profiles so the list response is a single query, not N+1.
SELECT
  a.*,
  ap.display_name,
  ap.avatar_s3_key,
  ap.medium_tags,
  ap.location_label
FROM applications a
JOIN artist_profiles ap ON ap.id = a.artist_id
WHERE a.form_id = $1
ORDER BY a.rank ASC, a.created_at ASC;

-- name: UpdateApplicationStatus :one
UPDATE applications SET status = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: UpdateApplicationFlags :one
UPDATE applications
SET
  shortlisted = COALESCE($2, shortlisted),
  review_flag = COALESCE($3, review_flag),
  updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: ReorderApplicationsInBucket :exec
-- Called with pairs of (rank, id). The handler builds the args from the ordered ID slice.
UPDATE applications SET rank = $1, updated_at = now() WHERE id = $2;
```

### application_notes.sql (new file)

```sql
-- name: ListNotesByApplications :many
-- Batch fetch for the list endpoint. Returns notes for all given application IDs.
SELECT * FROM application_notes WHERE application_id = ANY($1::uuid[]) ORDER BY application_id, created_at ASC;

-- name: ListNotesByApplication :many
SELECT * FROM application_notes WHERE application_id = $1 ORDER BY created_at ASC;

-- name: CreateApplicationNote :one
INSERT INTO application_notes (application_id, content) VALUES ($1, $2) RETURNING *;
```

---

## 3. API

All endpoints require auth + festival ownership. Base path: `/festivals/{festivalID}/applications`.

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| `GET` | `/festivals/{festivalID}/applications` | `ListApplicationsHandler` | Rewritten — uses join query, returns enriched response |
| `POST` | `…/{applicationID}/accept` | `AcceptApplicationHandler` | Existing — adds email notification |
| `POST` | `…/{applicationID}/decline` | `DeclineApplicationHandler` | Existing — adds email notification |
| `POST` | `…/{applicationID}/waitlist` | `WaitlistApplicationHandler` | New |
| `PATCH` | `…/{applicationID}` | `PatchApplicationHandler` | New — toggles `shortlisted` / `review_flag` |
| `POST` | `/festivals/{festivalID}/applications/reorder` | `ReorderApplicationsHandler` | New — operates on a whole bucket, not a single application |
| `POST` | `…/{applicationID}/notes` | `AddApplicationNoteHandler` | New |

### Enriched list response

```json
{
  "id": "...",
  "form_id": "...",
  "artist_id": "...",
  "status": "submitted",
  "rank": 0,
  "shortlisted": false,
  "review_flag": false,
  "answers": { "field-id": "answer text" },
  "created_at": "...",
  "updated_at": "...",
  "artist": {
    "display_name": "Rosa Vane",
    "avatar_s3_key": "avatars/abc123.jpg",
    "medium_tags": ["large-scale", "spray paint"],
    "location_label": "Bristol"
  },
  "notes": [
    { "id": "...", "content": "Strong portfolio, worth a call.", "created_at": "..." }
  ]
}
```

Notes are included inline in the list response (avoids a separate fetch on slide-over open). The handler runs two queries: `ListApplicationsByFormWithArtist` then `ListNotesByApplications` (`WHERE application_id = ANY($1)` with the returned IDs) — one round-trip each, no N+1. Since note counts are low per application, the payload overhead is negligible.

### Reorder endpoint

```
POST /festivals/{festivalID}/applications/reorder
Body: { "status": "submitted", "ids": ["uuid1", "uuid2", "uuid3"] }
```

The handler:
1. Verifies festival ownership.
2. Verifies all IDs belong to the given festival and have the given status.
3. Writes ranks 0, 1, 2… in a transaction.

### Email notifications

Status-change handlers (accept / decline / waitlist) fire a notification in a detached goroutine:

```go
go func() {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    // send "your application to <Festival Name> was accepted/declined/waitlisted"
    if err := mailer.Send(ctx, ...); err != nil {
        slog.Error("application notification failed", "err", err, "application_id", app.ID)
    }
}()
```

Pattern follows `forgotPasswordWork` in `api/internal/auth/reset.go`. The mailer is passed to the handler constructor — same wiring pattern as the auth handlers in `main.go`.

Email content (plain text + HTML):
- **Subject:** `Your application to [Festival Name]`
- **Body:** One sentence stating the outcome. For waitlisted: "You're on the waitlist — we'll be in touch if a spot opens up."
- No customisation in v1.

---

## 4. Frontend

### Page

`web/src/app/organiser/festivals/[id]/applications/page.tsx` — full rewrite.

**Five tabs:** Pending · Shortlisted · Accepted · Waitlisted · Declined (each with a count badge)

Tab definitions:
- **Pending** — `status = submitted AND shortlisted = false`
- **Shortlisted** — `status = submitted AND shortlisted = true`
- **Accepted / Waitlisted / Declined** — filtered by `status`

Toggling ⭐ on a Pending card moves it to Shortlisted and vice versa. Toggling does not change `status` — the application remains `submitted` until Accept / Waitlist / Decline is pressed. An application is in exactly one tab at a time.

### Application card (`ApplicationCard.tsx`)

Medium density. Each card shows:
- Drag handle (left edge, visible on hover)
- Avatar (letter fallback on missing `avatar_s3_key`)
- Name, location, applied date
- Medium tags (up to 3, `+N more` if longer)
- ⭐ shortlist toggle (PATCH immediately, optimistic update)
- 🚩 review flag toggle (same)
- Action buttons — only valid transitions: pending/shortlisted show Accept + Waitlist + Decline; accepted shows Decline; waitlisted shows Accept + Decline; declined shows nothing

Clicking anywhere on the card (except buttons/toggles/drag handle) opens the slide-over.

### Slide-over panel (`ApplicationSlideOver.tsx`)

Right-side panel (~40% width), dismissible by clicking outside or pressing Escape.

Sections:
1. **Artist** — avatar, name, location, medium tags, social links (Instagram, website)
2. **Application** — all answers rendered with their original question labels (fetched from the form's `fields` JSON)
3. **Notes** — chronological list of notes + textarea to add a new one (POST on submit)
4. **Actions** — same buttons as the card

### Drag-to-rank

Library: `@dnd-kit/core` + `@dnd-kit/sortable`. Drag is tab-scoped — you can only reorder within the current tab. Status changes are button-only.

On drag end, the frontend:
1. Optimistically reorders the local list.
2. Fires `POST /reorder` with `{ status, ids }`.
3. Rolls back on error.

### New files

| File | Purpose |
|------|---------|
| `ApplicationCard.tsx` | Medium card with drag handle, toggles, action buttons |
| `ApplicationSlideOver.tsx` | Detail panel — full answers, notes, actions |
| `ApplicationNotes.tsx` | Notes list + add form, extracted for reuse |
| `useApplicationReorder.ts` | Mutation hook — optimistic reorder + POST |

---

## 5. Constraints

- Internal flags (`shortlisted`, `review_flag`), notes, and rank order are **never surfaced to artists** under any circumstances.
- The enriched list endpoint is organiser-only (ownership check required).
- Email notification errors are logged but never propagate to the HTTP response — the status change succeeds even if the email fails.
- `waitlisted` added to the `application_status` enum is an irreversible Postgres migration — the down migration drops the column additions and the notes table but cannot remove an enum value (Postgres limitation). Document this in the down migration.

---

## Open questions (resolved)

- **Layout:** Tabbed list (not kanban, not expandable list).
- **Row density:** Medium cards (name + tags + bio snippet — no inline answer preview).
- **Drag-to-rank:** Included in v1.
- **Notes:** Simple free text, no author attribution yet. Separate table to allow attribution later.
- **Email customisation:** Not in v1 — fixed copy per status.
