# E18 Endorsements Design

**Date:** 2026-06-01
**Issues:** #194 (epic), #195 (E18.1), #196 (E18.2), #197 (E18.3)
**Status:** Design locked — all decisions from issues.

---

## What We're Building

Artist-to-artist and organiser-to-artist endorsements. Social proof on the artist's public profile — short testimonials with optional skills chips. Organiser endorsements carry a festival badge for authentic attribution.

---

## Data Model

### `endorsements` table (migration `000020`)

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `endorser_id` | uuid | `REFERENCES users(id) ON DELETE CASCADE` |
| `endorsee_id` | uuid | `REFERENCES artist_profiles(id) ON DELETE CASCADE` |
| `kind` | varchar(20) | `CHECK (kind IN ('peer', 'organiser'))` |
| `festival_id` | uuid | `REFERENCES festivals(id) ON DELETE SET NULL`, nullable |
| `body` | text | nullable |
| `skills` | text[] | default `'{}'` |
| `hidden_by_endorsee` | bool | default `false` |
| `moderation_status` | varchar(20) | default `'ok'`, `CHECK (moderation_status IN ('ok', 'hidden', 'removed'))` |
| `created_at` | timestamptz | `DEFAULT now()` |
| `updated_at` | timestamptz | `DEFAULT now()` |

**Constraints:**
- `UNIQUE (endorser_id, endorsee_id)` — one endorsement per pair, upsert on repeat
- `CHECK (endorser_id <> endorsee_id)` — no self-endorse (DB + handler)
- `CHECK (kind = 'peer' OR festival_id IS NOT NULL)` — organiser endorsements must carry a festival

---

## API Endpoints

### POST /endorsements

Create or upsert an endorsement (one per pair).

**Auth:** required.

**Request body:**
```json
{
  "endorsee_id": "uuid",
  "kind": "peer|organiser",
  "festival_id": "uuid (required if kind=organiser)",
  "body": "optional text",
  "skills": ["optional", "skill", "chips"]
}
```

**Validation (in order):**
1. Self-endorse → 400
2. `endorsee_id` must resolve to a public artist profile → 404
3. `kind=peer` → caller must have an `artist_profile` → 403
4. `kind=organiser` → caller must own `festival_id` → 403
5. `kind=organiser` + no `festival_id` → 422

**Success:** 201 with endorsement object. On upsert (repeat pair), merges body/skills/festival_id and returns updated row.

**Side effect:** background email to endorsee (bounded goroutine, 30s timeout, errors logged).

### DELETE /endorsements/{id}

Withdraw an endorsement. Endorser only → 403 for anyone else. 204 on success.

### GET /profiles/{profileID}/endorsements

Public list. Returns endorsements where `moderation_status = 'ok'` AND `hidden_by_endorsee = false`. Sorted organiser-first, then by `created_at DESC`.

**Response:**
```json
{
  "endorsements": [
    {
      "id": "uuid",
      "kind": "peer|organiser",
      "endorser_id": "uuid",
      "endorser_display_name": "Artist Name",
      "endorser_avatar_s3_key": "...",
      "festival_id": "uuid|null",
      "festival_name": "Festival Name|null",
      "body": "text|null",
      "skills": ["mural", "stencil"],
      "created_at": "2026-06-01T..."
    }
  ]
}
```

### PATCH /endorsements/{id}/visibility (E18.2)

Toggle `hidden_by_endorsee`. Endorsee only — verified by joining endorsements → artist_profiles → users.

**Request:** `{ "hidden": true|false }`
**Success:** 200 with updated endorsement.
**Auth errors:** 403 if caller is not the endorsee; 404 if endorsement doesn't exist.

---

## Package Structure

New package: `api/internal/endorsement/`

- `endorsement.go` — all four handlers
- `notification.go` — background email goroutine (same pattern as `festival/notification.go`)

---

## sqlc Queries (`db/queries/endorsements.sql`)

- `CreateOrUpdateEndorsement` — `INSERT ... ON CONFLICT (endorser_id, endorsee_id) DO UPDATE SET ... RETURNING *`
- `GetEndorsementByID` — for delete/patch ownership checks
- `DeleteEndorsement`
- `ListPublicEndorsements` — filtered + sorted, with JOINs for display name, avatar, festival name
- `SetEndorsementVisibility`
- `SetEndorsementModerationStatus` — stub for E17 integration (not wired to a route yet)

---

## Web UI (E18.2)

### Public profile page (`(public)/artists/[id]/page.tsx`)

Added alongside collections and appearances:
- Organiser endorsements rendered first: festival name badge (DM Mono), endorser name, body text (Cormorant Garamond), skills chips (DM Mono)
- Peer endorsements: avatar + name grid, body text, skills chips
- "Endorse this artist" button → `/artists/{id}/endorse` — hidden on own profile

### Endorse page (`(artist)/endorse/[profileID]/page.tsx`)

Client page with:
- `kind` selector (peer / "Endorse as [Festival]" — shows owned festivals)
- body textarea
- skills input (free-form tags)
- Submit → `POST /endorsements`

### Endorsee controls (profile owner view)

On the `/profile` artist dashboard, an Endorsements tab shows all received endorsements (including hidden ones) with toggle buttons → `PATCH /endorsements/{id}/visibility`.

---

## E18.3 — Moderation Status Stub

- `moderation_status` column is on the table from day one (default `'ok'`)
- `SetEndorsementModerationStatus` query exists for E17 to call when moderation dispatches
- Public list already filters `moderation_status = 'ok'`
- No flag route, no admin queue UI — that comes with E17

---

## Security

| Scenario | Expected |
|---|---|
| No token → POST /endorsements | 401 |
| Self-endorse | 400 |
| Peer endorse without artist profile | 403 |
| Organiser badge with unowned festival | 403 |
| Delete endorsement as endorsee | 403 |
| PATCH visibility as endorser | 403 |
| PATCH visibility as third party | 404 |
| Hidden endorsement in public list | absent |

---

## Changelog

2026-06-01 — initial spec from locked decisions in #194–#197
