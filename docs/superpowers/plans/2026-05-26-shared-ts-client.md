# Shared TypeScript API Base Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `openapi/client/index.ts` — a typed fetch client factory shared by the Next.js web app and React Native app, sitting on top of the generated OpenAPI types.

**Architecture:** Uses `openapi-fetch` as the runtime (companion to `openapi-typescript`). A `createApiClient({ baseUrl, getToken? })` factory returns a fully-typed client; an optional async token getter injects `Authorization: Bearer` headers per-request. `ApiError` wraps the `Problem` RFC 7807 schema for callers that want throw semantics.

**Tech Stack:** TypeScript, openapi-fetch, vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `openapi/client/package.json` | Package manifest — openapi-fetch dep, vitest dev dep |
| Create | `openapi/client/tsconfig.json` | TypeScript config for this package |
| Create | `openapi/client/index.ts` | `createApiClient` factory, `ApiError` class, re-exports |
| Create | `openapi/client/index.test.ts` | Vitest unit tests (mocked fetch) |
| Modify | `Taskfile.yml` | Add `openapi:test`, `openapi:lint`, `openapi:install`; add `openapi:test` to `task test` deps |

---

## Task 1: Scaffold the package

**Files:**
- Create: `openapi/client/package.json`
- Create: `openapi/client/tsconfig.json`
- Create: `openapi/client/index.ts` (stub only)

- [ ] **Step 1: Create `openapi/client/package.json`**

```json
{
  "name": "@render/api-client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "openapi-fetch": "^0.13.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `openapi/client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 3: Create stub `openapi/client/index.ts`**

```ts
// populated in Tasks 2–4
```

- [ ] **Step 4: Install dependencies**

```bash
cd openapi/client && npm install
```

Expected: `node_modules/` created, `package-lock.json` written.

- [ ] **Step 5: Commit**

```bash
git add openapi/client/package.json openapi/client/tsconfig.json openapi/client/index.ts openapi/client/package-lock.json
git commit -m "chore(openapi/client): scaffold package with openapi-fetch + vitest"
```

---

## Task 2: ApiError class (TDD)

**Files:**
- Create: `openapi/client/index.test.ts`
- Modify: `openapi/client/index.ts`

- [ ] **Step 1: Write the failing test**

Create `openapi/client/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApiError } from './index'

describe('ApiError', () => {
  it('is an instance of Error with status and title', () => {
    const err = new ApiError({ status: 404, title: 'Not Found' })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
    expect(err.message).toBe('Not Found')
    expect(err.status).toBe(404)
    expect(err.title).toBe('Not Found')
  })

  it('carries optional detail and instance fields', () => {
    const err = new ApiError({
      status: 422,
      title: 'Unprocessable Entity',
      detail: 'email is required',
      instance: '/auth/signup',
      type: 'about:blank',
    })

    expect(err.detail).toBe('email is required')
    expect(err.instance).toBe('/auth/signup')
    expect(err.type).toBe('about:blank')
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd openapi/client && npm test -- --reporter=verbose
```

Expected: error collecting `index.test.ts` — `ApiError` is not exported from `./index`.

- [ ] **Step 3: Implement `ApiError` in `index.ts`**

Replace the stub content of `openapi/client/index.ts` with:

```ts
import type { components } from '../generated/client'

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

- [ ] **Step 4: Run the test — confirm it passes**

```bash
cd openapi/client && npm test -- --reporter=verbose
```

Expected: `ApiError > is an instance of Error with status and title` ✓  
Expected: `ApiError > carries optional detail and instance fields` ✓

- [ ] **Step 5: Commit**

```bash
git add openapi/client/index.ts openapi/client/index.test.ts
git commit -m "feat(openapi/client): ApiError wrapping RFC 7807 Problem"
```

---

## Task 3: createApiClient — no auth (TDD)

**Files:**
- Modify: `openapi/client/index.test.ts`
- Modify: `openapi/client/index.ts`

- [ ] **Step 1: Add the failing test**

Append to `openapi/client/index.test.ts` (below the existing `ApiError` describe block):

```ts
import { vi } from 'vitest'
import { createApiClient } from './index'

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('createApiClient — no auth', () => {
  it('makes a request without an Authorization header when getToken is not provided', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({ baseUrl: 'http://localhost:8080' })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBeNull()

    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd openapi/client && npm test -- --reporter=verbose
```

Expected: error collecting — `createApiClient` is not exported from `./index`.

- [ ] **Step 3: Add `createApiClient` to `index.ts`**

Append to `openapi/client/index.ts` (below `ApiError`):

```ts
import createClient from 'openapi-fetch'
import type { paths } from '../generated/client'

interface ApiClientOptions {
  baseUrl: string
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl })
  return client
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
cd openapi/client && npm test -- --reporter=verbose
```

Expected: `createApiClient — no auth > makes a request without an Authorization header...` ✓

- [ ] **Step 5: Commit**

```bash
git add openapi/client/index.ts openapi/client/index.test.ts
git commit -m "feat(openapi/client): createApiClient base (no auth)"
```

---

## Task 4: Auth middleware (TDD)

**Files:**
- Modify: `openapi/client/index.test.ts`
- Modify: `openapi/client/index.ts`

- [ ] **Step 1: Add the failing tests**

Append to `openapi/client/index.test.ts` (below the `createApiClient — no auth` block):

```ts
describe('createApiClient — auth middleware', () => {
  it('injects Authorization header when getToken returns a string', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({
      baseUrl: 'http://localhost:8080',
      getToken: () => 'sync-token',
    })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBe('Bearer sync-token')

    vi.unstubAllGlobals()
  })

  it('awaits an async getToken and injects the header', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({
      baseUrl: 'http://localhost:8080',
      getToken: async () => 'async-token',
    })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBe('Bearer async-token')

    vi.unstubAllGlobals()
  })

  it('does not inject Authorization header when getToken returns null', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({
      baseUrl: 'http://localhost:8080',
      getToken: () => null,
    })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBeNull()

    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd openapi/client && npm test -- --reporter=verbose
```

Expected: the three new `auth middleware` tests fail — no header is injected because the middleware isn't wired yet.

- [ ] **Step 3: Add the auth middleware to `createApiClient` in `index.ts`**

Replace the `createApiClient` function body (keep `ApiClientOptions` and the import lines unchanged):

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
    const middleware: Middleware = {
      async onRequest({ request }) {
        const token = await getToken()
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
        return request
      },
    }
    client.use(middleware)
  }

  return client
}
```

- [ ] **Step 4: Run all tests — confirm they all pass**

```bash
cd openapi/client && npm test -- --reporter=verbose
```

Expected: 7 tests pass (2 ApiError + 1 no-auth + 3 auth middleware + 1 null token).

- [ ] **Step 5: Commit**

```bash
git add openapi/client/index.ts openapi/client/index.test.ts
git commit -m "feat(openapi/client): auth middleware — async token getter per-request"
```

---

## Task 5: Re-exports + typecheck

**Files:**
- Modify: `openapi/client/index.ts`

- [ ] **Step 1: Add type re-exports to the top of `index.ts`**

Add this line immediately after the existing `import type { components } from '../generated/client'` line:

```ts
export type { components, operations, paths } from '../generated/client'
```

The top of `index.ts` should now read:

```ts
import type { components } from '../generated/client'
export type { components, operations, paths } from '../generated/client'
```

- [ ] **Step 2: Run typecheck**

```bash
cd openapi/client && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run all tests to confirm nothing broke**

```bash
cd openapi/client && npm test
```

Expected: all 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add openapi/client/index.ts
git commit -m "feat(openapi/client): re-export components/operations/paths from generated types"
```

---

## Task 6: Wire Taskfile

**Files:**
- Modify: `Taskfile.yml`

- [ ] **Step 1: Add `openapi:*` tasks and update `test` in `Taskfile.yml`**

In `Taskfile.yml`, replace the existing `test` task:

```yaml
  test:
    desc: "Run all tests (api, web, mobile in parallel)"
    deps: [api:test, web:test, mobile:test]
```

with:

```yaml
  test:
    desc: "Run all tests (api, web, mobile, openapi in parallel)"
    deps: [api:test, web:test, mobile:test, openapi:test]

  openapi:install:
    desc: "Install openapi/client dependencies"
    dir: openapi/client
    cmd: npm install

  openapi:test:
    desc: "Run shared TS client tests (vitest)"
    dir: openapi/client
    cmd: npm test

  openapi:lint:
    desc: "Type-check shared TS client"
    dir: openapi/client
    cmd: npm run typecheck
```

- [ ] **Step 2: Verify `task openapi:test` runs correctly from the repo root**

```bash
task openapi:test
```

Expected: `Test Files  1 passed (1)` — all 7 tests pass.

- [ ] **Step 3: Verify `task openapi:lint` runs correctly**

```bash
task openapi:lint
```

Expected: no TypeScript errors, exits 0.

- [ ] **Step 4: Commit**

```bash
git add Taskfile.yml
git commit -m "chore(taskfile): wire openapi:test/lint/install; add to task test"
```
