# analytics Spec
**Path:** `api/internal/analytics/`
**Last updated:** 2026-05-31

## Contract
- `analytics.RecordEvent(ctx, pool, profileID, eventType)` — fire-and-forget: records a `profile_view`, `qr_scan`, or `link_click` event row
- `GET /profiles/me/analytics` — returns `AnalyticsResponse` with counts and `window_days` (90 for free, 730 for pro)
- `POST /profiles/me/links/:linkType/click` — records a link click event for the given social link type

## Boundaries
- Does NOT expose individual user tracking — all data is aggregated by profile; no user IDs are stored against events
- Does NOT gate access by plan — both free and pro users can read their analytics; the window size varies
- GDPR-clean by design: no PII in event rows

## Key Decisions
- **Aggregated only**: event rows store `profile_id` and `event_type` with a timestamp — no user ID, no IP, no device fingerprint
- **Window gating by plan**: free tier gets 90 days, pro gets 730 days — the window is applied at query time, not at write time
- **`hasPro` mirrors `billing.RequirePlan` without blocking**: analytics uses its own `hasPro` helper (not the middleware) so it can return data with a smaller window rather than 403

## Invariants
- Event rows MUST NOT store user IDs or any PII — GDPR compliance depends on this
- `window_days` in the response MUST reflect the caller's actual plan tier — free callers must not receive 730-day data

## AI Context
- `handler.go`: `AnalyticsHandler` (GET) + `LinkClickHandler` (POST) + `hasPro` helper
- `analytics.go`: `RecordEvent` — the write path; called from `artist.profile.go` on public GET and from `LinkClickHandler`
- The `hasPro` function in this package duplicates logic from `billing` — this is intentional to avoid a circular import (billing → analytics would create a cycle)

## Changelog
2026-05-31 — initial spec
