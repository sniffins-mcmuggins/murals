# Shared TypeScript API Base Client — Design Spec

**Issue:** #88
**Date:** 2026-05-26
**Status:** Approved

## Goal

Provide a shared, typed HTTP client that both the Next.js web app (E7) and the React Native app (E8) import. Extracts base fetch wiring and auth injection from the platform-specific layers so neither E7 nor E8 blocks on the other.

## Background

`openapi/generated/client.ts` (produced by `task openapi:gen`) is type-only — it exports TypeScript interfaces for every path, operation, and schema. It contains no runtime fetch logic. This spec covers the thin runtime layer that sits on top of it.

## File Structure

```
openapi/
  client/
    index.ts        ← createApiClient factory + ApiError class + re-exports
    index.test.ts   ← vitest unit tests (mocked fetch)
    package.json    ← openapi-fetch, vitest, typescript
    tsconfig.json   ← strict TS, references ../generated/client.ts
  generated/
    client.ts       ← existing, auto-generated, do not edit
  openapi.yaml
  oapi-codegen.yaml
```

## Dependencies

- [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) — typed fetch runtime companion to `openapi-typescript`. ~6 kB. No other runtime deps.
- `vitest` — test runner (dev only)
- `typescript` — type checking (dev only)

`openapi-fetch` is installed in `openapi/client/package.json`. When web and mobile are scaffolded, they install it in their own `package.json` as well — Node module resolution will find whichever is closest.

## Public API

### `createApiClient(options)`

```ts
import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from '../generated/client'

interface ApiClientOptions {
  baseUrl: string
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl })

  if (getToken) {
    const authMiddleware: Middleware = {
      async onRequest({ request }) {
        const token = await getToken()
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
        return request
      },
    }
    client.use(authMiddleware)
  }

  return client
}
```

**Parameters:**
- `baseUrl` — API origin, e.g. `http://localhost:8080` (dev) or `https://api.renderltd.com` (prod). Caller supplies this; the shared client has no opinion on env vars.
- `getToken` — optional async-or-sync function returning a JWT string. Called on every request. If it returns `null`/`undefined`, no `Authorization` header is set. Web passes nothing (HTTP-only session cookie is sent automatically by the browser). Mobile passes `() => Keychain.getPassword(...)`.

**Return value:** The fully-typed `openapi-fetch` client. Every call is typed against the generated `paths` interface — wrong method, path, params, or response shape is a compile error.

### `ApiError`

```ts
export class ApiError extends Error {
  readonly status: number
  readonly title: string
  readonly detail?: string
  readonly instance?: string
  readonly type?: string

  constructor(problem: components['schemas']['Problem']) {
    super(problem.title)
    this.name = 'ApiError'
    this.status = problem.status
    this.title = problem.title
    this.detail = problem.detail
    this.instance = problem.instance
    this.type = problem.type
  }
}
```

`openapi-fetch` never throws — it returns `{ data, error, response }`. `ApiError` exists for callers that want throw semantics:

```ts
const { data, error } = await client.GET('/me')
if (error) throw new ApiError(error)
```

Not thrown internally. TanStack Query's `throwOnError` or manual throws are the expected use sites.

### Re-exports

```ts
export type { components, operations, paths } from '../generated/client'
```

Consumers import everything from `openapi/client` — they never import directly from `openapi/generated/client`.

## Error Handling

All API errors use `application/problem+json` (RFC 7807). The `Problem` schema has `title` (required), `status` (required), and optional `detail`, `instance`, `type`. `openapi-fetch` parses error responses automatically; the `error` field on each call result is typed to `Problem` for every operation that can fail.

## Auth Strategy

| Consumer | `getToken` | How auth works |
|---|---|---|
| Next.js web | not provided | Browser sends HTTP-only `session` cookie automatically |
| React Native | `() => Keychain.getPassword(service)` | Middleware injects `Authorization: Bearer <token>` |

Token storage (keychain, memory, cookie) is entirely the caller's responsibility. This layer only reads and injects.

## Testing

Unit tests in `openapi/client/index.test.ts` using vitest with `vi.stubGlobal('fetch', ...)`.

**Test cases:**
1. No `getToken` provided → requests have no `Authorization` header
2. Sync `getToken` returning a string → header is `Authorization: Bearer <token>`
3. Async `getToken` returning a Promise → awaited, header injected when resolved
4. `getToken` returning `null` → no header injected

The `/healthz` smoke call (one real request against the local stack) is a manual dev-time verification, not an automated test.

## Taskfile Changes

Add to root `Taskfile.yml`:

```yaml
openapi:test:
  desc: "Run shared TS client tests (vitest)"
  dir: openapi/client
  cmd: npm test

openapi:lint:
  desc: "Type-check shared TS client"
  dir: openapi/client
  cmd: npm run typecheck

openapi:install:
  desc: "Install openapi/client dependencies"
  dir: openapi/client
  cmd: npm install
```

Update the root `test` task to include `openapi:test`:

```yaml
test:
  desc: "Run all tests (api, web, mobile, openapi in parallel)"
  deps: [api:test, web:test, mobile:test, openapi:test]
```

The root `task lint` is not updated — it delegates to api/web/mobile only. `openapi:lint` is a standalone task for CI or manual use.

## Consumers

- **#50 (E7.2)** — `web/lib/api.ts` imports `createApiClient` and `ApiError`. Passes `baseUrl: process.env.NEXT_PUBLIC_API_URL`. No `getToken` (cookie auth). Builds TanStack Query hooks on top.
- **#64 (E8.4)** — `mobile/src/lib/api.ts` imports `createApiClient`. Passes `getToken: () => Keychain.getPassword('render-api')`. Configures Metro resolver to find `openapi/client` via `watchFolders` + `resolver.nodeModulesPaths`.

## Definition of Done

- [ ] `openapi/client/index.ts` implemented and type-checks cleanly
- [ ] `openapi/client/index.test.ts` — all 4 unit test cases pass
- [ ] `task openapi:test` passes
- [ ] `task lint` passes (root lint delegates to api/web/mobile — openapi/client has its own `npm run typecheck`)
- [ ] Manual smoke: `createApiClient({ baseUrl: 'http://localhost:8080' })` → `GET /healthz` returns `{ status: 'ok' }` against live local stack
