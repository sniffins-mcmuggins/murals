# Spot Pre-Setup & Artist Assignment — Design Spec

**Date:** 2026-05-27
**Status:** Approved
**Scope:** Two-phase map editor: organiser plots wall spots upfront, then assigns accepted artists to spots one by one.

---

## Overview

The current map editor lets organisers set a pin for an already-accepted artist. This spec replaces that with a two-phase flow:

1. **Phase 1 — Spot setup:** the organiser plots all wall locations on the map before any artists are assigned. Each spot is a first-class entity with coordinates, optional details, and no artist yet.
2. **Phase 2 — Artist assignment:** once artists are accepted, the organiser assigns them to spots one at a time via the same map editor page.

Both phases live in the existing map editor page — no separate UI.

---

## Data Model

### New table: `festival_spots`

```sql
CREATE TABLE festival_spots (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id uuid         NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    number      int          NOT NULL,
    lat         numeric(9,6) NOT NULL,
    lng         numeric(9,6) NOT NULL,
    w3w         text,
    width_m     numeric(5,1),
    height_m    numeric(5,1),
    notes       text,
    artist_id   uuid         REFERENCES artist_profiles(id) ON DELETE SET NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (festival_id, number)
);

-- One spot per artist per festival
CREATE UNIQUE INDEX festival_spots_artist_idx
    ON festival_spots (festival_id, artist_id)
    WHERE artist_id IS NOT NULL;
```

**Spot numbering:** auto-assigned as `MAX(number) + 1` for the festival at creation time. Numbers are not reassigned when a spot is deleted — gaps are acceptable (Spot 1, Spot 3, Spot 4 is fine).

**Artist constraint:** the partial unique index ensures an accepted artist can only be assigned to one spot per festival.

**`artist_id` ON DELETE SET NULL:** if an artist profile is deleted, spots become empty rather than cascade-deleting.

### Migration: remove pin columns from `festival_artists`

`festival_artists.pin_lat`, `festival_artists.pin_lng`, and `festival_artists.w3w` are removed. Any existing rows with coordinates set are converted to `festival_spots` rows (one spot per pinned artist, artist assigned at creation).

---

## API

All spot endpoints require organiser auth and ownership of the festival.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/festivals/{festivalID}/spots` | Create a spot. Body: `{lat, lng, w3w?, width_m?, height_m?, notes?}` |
| `GET` | `/festivals/{festivalID}/spots` | List all spots with assignment status. Used by the map editor. |
| `PATCH` | `/festivals/{festivalID}/spots/{spotID}` | Update spot details (lat, lng, w3w, dimensions, notes — all optional). |
| `DELETE` | `/festivals/{festivalID}/spots/{spotID}` | Delete a spot. Unassigns the artist first if one is assigned. |
| `PUT` | `/festivals/{festivalID}/spots/{spotID}/artist` | Assign an accepted artist. Body: `{artist_id}`. 409 if artist already assigned elsewhere. |
| `DELETE` | `/festivals/{festivalID}/spots/{spotID}/artist` | Unassign the artist from this spot. |

**Removed:** `PATCH /festivals/{festivalID}/artists/{artistID}/pin` — replaced by the spots flow.

**Changed:** `GET /festivals/slug/{slug}/map` (public) queries `festival_spots` instead of `festival_artists` for pin coordinates and artist display names.

**Artist dropdown data:** `GET /festivals/{festivalID}/spots` returns a combined response:
```json
{
  "spots": [{ "id", "number", "lat", "lng", "w3w", "width_m", "height_m", "notes", "artist_id", "artist_name" }],
  "unassigned_artists": [{ "artist_id", "name" }]
}
```
`unassigned_artists` is the list of accepted artists for this festival who are not yet assigned to any spot — used to populate the assignment dropdown. The `PUT /artist` handler also validates that the artist has `status = 'accepted'` in `festival_artists` before writing, rejecting with 422 if not.

---

## Map Editor UI

Single page (`/organiser/festivals/{id}/map`). Two-column layout: sidebar left, map right.

### Sidebar

- **"+ Add spot" button** at the top — clicking arms one-time placement mode; the next map click drops a spot.
- **Spots list** below the button — one row per spot showing:
  - Spot number
  - Empty/assigned badge
  - Artist name if assigned, or optional details (W3W, dimensions) if empty
- **Summary line** at the bottom: "N spots · M assigned"

### Map

- **Amber pin** = empty spot
- **Terracotta pin** = assigned spot (artist name shown in a small label beneath)
- Clicking any pin opens the spot management panel inline on the map

### Spot management panel (opens on pin click)

- Spot number and W3W (read-only display, W3W editable)
- Artist dropdown: accepted artists not yet assigned to another spot, plus "— unassigned —" to clear
- Width and height fields (optional, in metres)
- Notes textarea (optional, internal — never shown to artists)
- **Save** button: commits all fields in one request
- **Delete spot** link: removes the spot; if assigned, unassigns artist first. No confirmation dialog — undo is not provided (spots are cheap to recreate).

### Interaction flow

1. Organiser clicks **"+ Add spot"** → button enters active state, hint text appears on map: "Click to place spot"
2. Organiser clicks the map → `POST /spots` → amber pin appears, sidebar list updates, panel opens for the new spot
3. Organiser fills optional fields (W3W, dimensions, notes) and clicks **Save** → `PATCH /spots/{id}`
4. Later, with accepted artists available, organiser clicks an amber pin → panel opens → selects artist from dropdown → **Save** → `PUT /spots/{id}/artist` → pin turns terracotta, sidebar badge updates

---

## Public Map (unchanged behaviour, updated query)

`GET /festivals/slug/{slug}/map` continues to return `{pins: [{artist_id, name, lat, lng, w3w}]}`. The query source shifts from `festival_artists` to `festival_spots WHERE artist_id IS NOT NULL`. Response shape is identical — no API client changes needed.

---

## What is Not in Scope

- Reassigning a spot to a different artist requires unassigning first, then assigning — no atomic swap endpoint.
- Spot reordering / renumbering — numbers are fixed at creation.
- Spot visibility to artists — spots and their coordinates are organiser-only. Artists only see their assignment in their own festival dashboard (already handled via the accepted application flow).
- Mural status per pin (still painting / complete / removed) — deferred to the "During Festival" phase per the organiser setup spec.

---

## Key Constraints

- Only accepted artists appear in the assignment dropdown.
- An artist can be assigned to at most one spot per festival (enforced by unique index).
- Logistics notes are never surfaced to artists.
- Deleting a spot with an assigned artist silently unassigns — no orphaned `festival_artists` row.
