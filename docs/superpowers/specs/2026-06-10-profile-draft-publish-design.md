# E29 — Profile draft / preview / publish-changes

**Date:** 2026-06-10
**Status:** Design — awaiting review
**Epic number:** E29 (latest epic is E28; confirm with the next-number query before creating issues)
**Area:** api, db, web, e2e

---

## Problem

Once an artist's profile is `public`, every edit goes **live instantly**. Editing
flows through `ProfileForm → PATCH /profiles/me` and the collection/image
endpoints, all of which write straight to the live tables; the public read path
(`GetProfileHandler` + `ListCollectionsHandler`) assembles the response from
those same live rows on every request. There is no way for an artist to revise
their page — bio, links, avatar, **and their whole portfolio** — review it
privately, and then push it all live at once.

Two artist-facing gaps:

1. **No "view my profile"** — `/profile` is the *editor*; there is no first-class
   way to see the page as the public sees it, nor a way to preview pending edits.
2. **No staging** — no durable draft layer; you cannot prepare changes and
   publish them deliberately.

E15 (shipped) covers *visibility* (`draft | public`, preview-token sharing,
Go-Public / Take-Offline). This epic is orthogonal: it adds a **content
staging** layer on top of an already-public profile.

## Goals

- An artist can edit their profile + collections + images freely without those
  edits reaching the public.
- An artist can **preview** their pending edits in-app (`/profile/preview`) and
  **view the live public page** (`/artists/[id]`).
- An artist can **Publish changes** to push the entire draft live atomically.
- The public always sees a consistent, point-in-time **published** version.
- Invariant the user asked for: **exactly one live (published) version and at
  most one set of unpublished changes per artist** — enforced structurally, not
  by application bookkeeping.

## Non-goals

- **Discard / revert** ("undo my edits back to the live version"). Deferred —
  see Open Decisions. Not publishing already leaves the live page untouched; a
  true revert means rebuilding live rows from the snapshot and is out of scope.
- Multiple named drafts / version history / scheduled publishing. One draft, one
  published. YAGNI.
- Changing *how* the public page renders. This epic changes *when* it is built
  (once at publish), not the rendered shape.
- Touching the existing visibility model (draft/public, preview token) beyond
  composing with it.

---

## Approach (decided): published snapshot column

The public profile is a **read model**. We freeze it.

- The **draft** is the existing live tables (`artist_profiles` + `collections` +
  `collection_images`). The artist keeps editing these in place — the editor is
  essentially unchanged.
- The **published** version is a single JSONB column, `published_snapshot`, on
  the one `artist_profiles` row.
- **Publish changes** = serialize the live graph into `published_snapshot` in one
  atomic UPDATE.
- **Public reads** the snapshot. **The owner's editor/preview reads the live
  tables.**

### Why this over the alternatives

Rejected during brainstorming:

- **Versioned rows** (`version: draft|published` on existing tables): every
  existing query must add `WHERE version='published'`; one miss leaks a draft
  publicly. Worst for the security invariant; doubles rows in hot tables.
- **Shadow draft/published tables**: 3× table duplication, must mirror every
  future schema change, heavy copy logic.
- **`profile_drafts` JSON-blob table**: genuinely simplest *if* we staged
  profile fields only — but the chosen scope is "everything (profile +
  collections)", and a blob handles the relational collections/images graph
  badly (loses FKs and ordering), forcing a large editor rewrite.

The snapshot column wins for the "everything" scope because: the serializer
already exists (reuse `toProfileResponse` + the collections/images assembly),
the editor is untouched, publish is atomic by construction, and the
"one live / one draft" invariant is free (one row ⇒ one snapshot; the draft is
the live rows, so there is nothing to duplicate).

---

## Data model

One migration, **no new tables**. Add to `artist_profiles`:

```sql
ALTER TABLE artist_profiles
  ADD COLUMN published_snapshot      jsonb,         -- frozen public read-model; NULL = never published
  ADD COLUMN published_at            timestamptz,   -- when the snapshot was last taken; NULL = never
  ADD COLUMN has_unpublished_changes boolean NOT NULL DEFAULT false;
```

Three orthogonal concepts compose:

| Concept | Column | Meaning |
|---|---|---|
| Listing | `visibility` (existing) | Is the page publicly listed at all? (Go Public / Take Offline) |
| What public sees | `published_snapshot` | The frozen authored page |
| Pending work | `has_unpublished_changes` | Is the draft ahead of the snapshot? |

### Invariant enforcement (why "one live, one draft")

- **One live version**: `published_snapshot` is one column on one row; the
  existing partial unique index `artist_profiles_user_id_idx` guarantees one
  profile per user. One row ⇒ one snapshot.
- **One set of unpublished changes**: the draft *is* the canonical live rows.
  There is no draft copy, so nothing can become a second draft.

### sqlc / read-cost rule

`published_snapshot` is a large blob and must **not** be added to the default
`ArtistProfile` row struct that every read scans (the `sqlc-and-schema` rule
trap, and it would bloat hot reads). Use explicit column lists and dedicated
narrow queries:

- `GetPublishedSnapshot(profileID) → (jsonb, published_at)` — public render.
- `SetPublishedSnapshot(userID, snapshot, published_at)` — publish.
- `SetHasUnpublishedChanges(...)` — flag maintenance (or trigger, below).

`has_unpublished_changes` and `published_at` are small and *may* join the main
struct; `published_snapshot` must not.

---

## Snapshot serializer

The serializer is **not new rendering logic** — it reuses the two builders that
already produce the public response on the fly:

```
published_snapshot = {
  ...toProfileResponse(profile, public=true),          // profile.go:63 (authored fields)
  collections: [                                        // collection.go assembly (public)
    { id, name, description, cover, focal, display_order,
      images: [ { cdn_url, display_order }, ... ] },
    ...
  ]
}
```

Built once inside the publish transaction. Because the snapshot is produced by
the same code that renders live, the snapshot shape cannot drift from the live
render.

### What is frozen vs read live (important)

The snapshot holds **only artist-authored content**. Dynamic, cross-entity data
that other actors change is **not** frozen (it would go stale), and stays as
small live side-reads on the public page:

| Data | In snapshot? | Why |
|---|---|---|
| Profile fields, collections, images, ordering, covers | **Yes** | Artist-authored; the thing being published |
| Festival **spot history** (`GetSpotHistoryForProfile`, profile.go:190) | **No** | Set by organisers; changes independently |
| **Endorsements** (if shown on the public page) | **No** | Written by other users |
| Live **analytics** (views/scans) | **No** | Continuous; owner-only anyway |

So: **public profile = `published_snapshot` (one column) + a few live side-reads
for dynamic cross-entity data.**

---

## API surface

### New / changed endpoints

- `POST /profiles/me/publish-changes` (new) — builds the snapshot from the
  caller's live graph, writes `published_snapshot` + `published_at = now()`,
  sets `has_unpublished_changes = false`. Single transaction. Gated on the same
  billing entitlement as `POST /profiles/me/publish` (`billing.CanPublish`) —
  you cannot push a public snapshot without an active subscription/comp.
- `POST /profiles/me/publish` (existing, extended) — "Go Public" must also
  create the **initial** snapshot if none exists, so a first publish makes the
  page renderable. After this, visibility-flip and content-publish are distinct
  actions (see UX).
- Read path change — public profile reads return the snapshot:
  - `GetProfileHandler` (`GET /profiles/{id}`) — for non-owners on a public
    profile, return `published_snapshot` instead of assembling live. Owners (and
    preview) continue to get the live assembly. Draft-visibility 404 gate
    unchanged.
  - `ListCollectionsHandler` (`GET /profiles/{id}/collections`) — public callers
    served from the snapshot's `collections`; owner served live.
  - `ListPublicProfilesHandler` (`GET /public/profiles`) and the festival **map**
    / discovery listings — must read snapshot-derived fields (name, avatar,
    medium) so listings don't leak unpublished edits.
  - The E15.2 **preview-token** page (`/profiles/preview/{token}`) renders the
    **live** tables (it is a preview of the draft) — confirm/align it here.

### Dirty-flag maintenance — DECIDED: database triggers

Every mutation to the graph must set `has_unpublished_changes = true`; publish
clears it. **We use DB triggers** on `artist_profiles`, `collections`, and
`collection_images` for INSERT / UPDATE / **DELETE**, each setting the parent
profile's flag.

Rationale: dirtiness **cannot** be derived from `updated_at` because a DELETE
(removing a collection or image) lowers the graph without raising any timestamp
— an `updated_at > published_at` check would silently miss deletions and the
public page would keep showing removed work. A DELETE trigger is the clean fix,
and triggers cannot be forgotten when future mutation endpoints are added.

Trade-off accepted: triggers are less visible than the repo's explicit-sqlc
style. Mitigation: document them in `db.spec.md` and `artist.spec.md`, and add
an e2e canary asserting the flag flips on a delete.

The publish endpoint clears the flag in the same transaction *after* building
the snapshot, so a concurrent edit during publish leaves the flag correctly
`true` (it re-fires the trigger).

---

## Web surface

- **PublishBar** (`web/src/app/(artist)/profile/PublishBar.tsx`) gains:
  - "Publish changes" button + an "unpublished changes" indicator, shown when
    `has_unpublished_changes` is true on a `public` profile.
  - "View public profile" link → `/artists/[id]` (the live page).
  - Keeps existing Go Public / Take Offline / Copy preview link.
- **`/profile/preview`** (new route in the `(artist)` group) — renders the
  profile + collections from the **live tables** (the draft): "what your changes
  will look like." Owner-only (`requireAuth`).
- The two views, explicitly: **View public profile** = snapshot (what's live);
  **Preview** = live tables (what's coming).

### Visibility × changes matrix (UX)

| | `has_unpublished_changes = false` | `= true` |
|---|---|---|
| `visibility = public` | live = snapshot, in sync | live = snapshot (old); banner "You have unpublished changes" + Publish changes |
| `visibility = draft` | hidden; preview link shows draft | hidden; preview link shows draft |

---

## Migration / backfill

1. Migration adds the three columns (`.down.sql` drops them in reverse) and
   creates the triggers (dropped in `.down.sql`).
2. **Backfill** (Go, reusing the serializer): for every `visibility='public'`
   profile, build and store an initial `published_snapshot`, set
   `published_at = now()`, `has_unpublished_changes = false`, so public pages do
   not go blank when reads switch to the snapshot.
3. Migration-window safety: while `published_snapshot IS NULL`, public reads fall
   back to the live assembly. After backfill, public-visible profiles are
   asserted to have a non-null snapshot; the fallback is retained only as a
   defensive path (a public profile should never have a null snapshot).

---

## Image lifecycle constraint

Because the public renders the *old snapshot* (which references image objects)
until the artist publishes, an S3 object must **not** be hard-deleted the moment
its draft `collection_images` row is removed — the live public page would show a
broken image pre-publish.

Rule: **S3 objects are retained until a publish leaves them unreferenced.**
Defer actual object deletion to a GC pass that removes objects referenced by
neither the live tables nor the current `published_snapshot`. Verify whether
today's image-delete removes the object synchronously and adjust if so.

---

## Testing — the no-leak canary

E2E (`e2e/browser` + `e2e/api`) must prove the core guarantee:

1. Publish a profile (snapshot v1). Public page shows v1.
2. Edit bio + reorder/add/**delete** a collection. Public page **still shows
   v1**; `/profile/preview` shows the edits; `has_unpublished_changes = true`.
3. Publish changes. Public page now shows v2; flag clears.
4. **Leak canary:** assert no public surface (profile, collections, listing,
   map) ever exposes step-2 edits before step 3 — including the delete case
   (a removed collection must still appear publicly until publish).
5. Dirty-flag-on-delete canary (per the sqlc-and-schema rule): deleting an image
   flips `has_unpublished_changes` (catches a missed trigger).

---

## Sub-task breakdown (proposed issues)

- **E29.1 — DB:** `published_snapshot` / `published_at` /
  `has_unpublished_changes` columns + dirty-flag triggers + `.down.sql`.
  (`area:db`)
- **E29.2 — API publish:** snapshot serializer (reuse `toProfileResponse` +
  collections assembly), `POST /profiles/me/publish-changes`, extend
  `POST /profiles/me/publish` to seed the initial snapshot. Narrow snapshot
  get/set queries. (`area:api`)
- **E29.3 — API reads:** repoint public read paths (`GetProfileHandler`,
  `ListCollectionsHandler`, `ListPublicProfilesHandler`, map/discovery,
  preview-token) to snapshot-vs-live by viewer. (`area:api`) — *highest risk;
  ships with the leak canary.*
- **E29.4 — Web publish UI:** PublishBar "Publish changes" + unpublished-changes
  indicator + "View public profile" link. (`area:web`)
- **E29.5 — Web preview route:** `/profile/preview` rendering the live draft.
  (`area:web`)
- **E29.6 — Backfill + image-retention:** Go backfill for existing public
  profiles; confirm/adjust S3 retention on draft delete. (`area:api` /
  `area:infra`)
- **E29.7 — E2E:** no-leak canary + dirty-flag-on-delete canary across api &
  browser. (`area:e2e`)

Sequencing: E29.1 → E29.2 → E29.3 (gated by the canary in E29.7) → E29.4/E29.5
(parallel) ; E29.6 alongside E29.3 ; E29.7 written early, run throughout.

Spec updates required in the same work: `db.spec.md` (new columns + triggers),
`api/internal/artist/artist.spec.md` (publish-changes contract, snapshot
invariant, frozen-vs-live rule), `web/src/app/(artist)/artist.spec.md` and
`(public)/public.spec.md` (read-from-snapshot decision).

---

## Open decisions

1. **Discard / revert** — deferred. Revisit if artists ask to undo edits back to
   the live version (requires rebuilding live rows from the snapshot).
2. **Listings/map scope** — confirm exactly which public listing fields read
   from the snapshot vs live (name/avatar/medium at minimum). Resolve in E29.3.
3. **Endorsements on public page** — confirm they are a live side-read (not
   frozen). Resolve when wiring E29.3.

## Risks

- **Draft leak via a missed public read path** (E29.3) — mitigated by the leak
  canary covering profile, collections, listing, and map, including deletes.
- **Snapshot/live shape drift** — mitigated by building the snapshot from the
  same `toProfileResponse` + collections assembly used for live rendering.
- **Stale frozen data** — mitigated by keeping spot history / endorsements /
  analytics as live side-reads, never in the snapshot.

---

## Changelog
2026-06-10 — initial design
