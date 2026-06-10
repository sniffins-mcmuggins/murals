# web/src/lib Spec
**Path:** `web/src/lib/`
**Last updated:** 2026-05-31

## Contract
- Shared utilities for the Next.js app: auth helpers, API client configuration, type utilities
- `auth-server.ts`: server-side session utilities — reads the `session` cookie, validates JWT, returns user or null
- API client setup: configures `@render/api-client` with the correct base URL for server vs client contexts

## Boundaries
- Does NOT contain UI components — those live in `web/src/components/`
- Does NOT contain route-specific logic — that belongs in the page/layout files

## Key Decisions
- **Server vs client API URL**: `lib/` is the single place that decides `API_URL` vs `NEXT_PUBLIC_API_URL` — all other files import from here rather than reading `process.env` directly

## Invariants
- `auth-server.ts` MUST use `API_URL` for any server-side API calls — never `NEXT_PUBLIC_API_URL`

## AI Context
- `auth-server.ts`: server-side auth — called from server component `page.tsx` files that need to know who the user is
- If all pages are 500-ing with ECONNREFUSED, check that `auth-server.ts` is using `API_URL` (see e2e-debugging rule)

## Changelog
2026-05-31 — initial spec
2026-06-07 — E28 M2: added `prefill.ts` (PrefillKey allowlist + `resolvePrefill`), the source of truth for profile-bound form fields; allowlist mirrored server-side in `api/internal/festival/form.go`.
2026-06-10 — Added `favicon.ts` (PLATFORM_DOMAINS + linkIconForPrefill) backing per-platform application link fields with self-hosted favicons; refreshed by web/scripts/fetch-favicons.sh + the refresh-favicons workflow.
