# me Spec
**Path:** `api/internal/me/`
**Last updated:** 2026-05-31

## Contract
- `GET /me/summary` → `SummaryHandler(pool)` — returns `{ artist_profile?, festivals[] }` for the authenticated user: the user's own artist profile stub (if they have one) and a list of festivals they own as an organiser

## Boundaries
- Does NOT return full profile or full festival objects — stubs only (id, name, slug, status)
- Does NOT paginate — returns all festivals for the organiser; intended for navigation/dashboard bootstrap

## Key Decisions
- **Cross-resource summary endpoint**: the `me` package exists specifically to avoid clients making N+1 calls on first load; it joins across artist profiles and festivals in one query
- **Stub responses not full objects**: the full profile and festival objects are fetched by their respective packages when needed

## Invariants
- `SummaryHandler` MUST require auth — 401 if no principal

## AI Context
- `summary.go`: the single handler; reads artist profile + organiser festivals via sqlcdb in two queries

## Changelog
2026-05-31 — initial spec
