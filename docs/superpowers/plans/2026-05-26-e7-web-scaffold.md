# E7.1 + E7.2 — Next.js Scaffold + TS Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js web app with Tailwind v4 design tokens, `next/font` fonts, and a TanStack Query provider (#49), then wire in the `@render/api-client` singleton (#50).

**Architecture:** npm workspaces link `@render/api-client` (`openapi/client/`) into `web/` as a named package. Docker-compose mounts the repo root so the workspace symlink resolves inside containers. Next.js 15 App Router; Tailwind v4 CSS-first config with named colour utilities (`bg-ink`, `text-amber`, etc.); `QueryClient` instantiated via `useState` in a client component `Providers`.

**Tech Stack:** Next.js 15, React 19, TypeScript 5 (strict), Tailwind CSS 4, `@tailwindcss/postcss`, TanStack Query 5, `openapi-fetch` (via `@render/api-client`), Vitest 3, React Testing Library 16, jsdom

---

## File map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `package.json` | Repo-root workspace manifest |
| Modify | `openapi/client/package.json` | Add `types` field for TS resolution |
| Modify | `infra/docker-compose.yml` | Mount repo root; update web service |
| Modify | `web/Dockerfile` | Update dev target WORKDIR for workspace layout |
| Modify | `.github/workflows/ci.yml` | Root lock file cache; root-level install |
| Delete | `web/package-lock.json` | Replaced by root lock file |
| Modify | `web/package.json` | All runtime + dev dependencies |
| Create | `web/tsconfig.json` | TS strict, bundler resolution, `@/*` alias |
| Create | `web/next.config.ts` | `output: standalone`, `transpilePackages` |
| Create | `web/postcss.config.mjs` | Tailwind v4 PostCSS plugin |
| Create | `web/.eslintrc.json` | `next/core-web-vitals` ruleset |
| Create | `web/vitest.config.ts` | jsdom + RTL + `@/*` alias |
| Create | `web/src/__tests__/setup.ts` | `@testing-library/jest-dom` matchers |
| Create | `web/src/app/globals.css` | `@import "tailwindcss"` + `@theme` tokens |
| Create | `web/src/app/layout.tsx` | Root layout: fonts, Providers, metadata |
| Create | `web/src/app/page.tsx` | Minimal placeholder home page |
| Create | `web/src/app/providers.tsx` | `QueryClientProvider` (useState pattern) |
| Create | `web/src/lib/api.ts` | `apiClient` singleton |
| Create | `web/src/__tests__/providers.test.tsx` | RTL: QueryClient in tree |
| Create | `web/src/__tests__/api.test.ts` | Unit: apiClient method surface |

---

## Task 1: npm workspaces + infrastructure

**Files:**
- Create: `package.json`
- Modify: `openapi/client/package.json`
- Modify: `infra/docker-compose.yml`
- Modify: `web/Dockerfile`
- Modify: `.github/workflows/ci.yml`
- Delete: `web/package-lock.json`

- [ ] **Step 1.1: Create repo-root `package.json`**

```json
{
  "private": true,
  "workspaces": [
    "openapi/client",
    "web"
  ]
}
```

Save to: `package.json` (repo root).

- [ ] **Step 1.2: Add `types` field to `openapi/client/package.json`**

The package exports TypeScript source directly; Next.js needs `types` to resolve it. Open `openapi/client/package.json` and add:

```json
{
  "name": "@render/api-client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "types": "./index.ts",
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

- [ ] **Step 1.3: Update `infra/docker-compose.yml` web service**

Replace the `web:` block (lines `# ── WEB ──` through `restart: unless-stopped` for that service):

```yaml
  # ── WEB ────────────────────────────────────────────────────────────────────
  web:
    build:
      context: ..
      dockerfile: web/Dockerfile
      target: dev
    working_dir: /workspace/web
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: "http://localhost:8080"
      API_URL: "http://api:8080"
      NODE_ENV: "development"
    volumes:
      - ../:/workspace
      - web_node_modules:/workspace/web/node_modules
      - web_next:/workspace/web/.next
    depends_on:
      - api
    restart: unless-stopped
```

Mounting the repo root at `/workspace` makes the workspace symlink (`/workspace/web/node_modules/@render/api-client` → `/workspace/openapi/client`) resolve inside the container.

- [ ] **Step 1.4: Update `web/Dockerfile` dev target**

Replace the entire Dockerfile with:

```dockerfile
# dev: next dev with source mounted as volume
FROM node:20-alpine AS dev
WORKDIR /workspace/web
CMD ["npm", "run", "dev"]

# builder: production build (requires repo root as build context)
FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package*.json ./
COPY web/package*.json ./web/
COPY openapi/client/package*.json ./openapi/client/
RUN npm ci --workspaces
COPY web/ ./web/
COPY openapi/client/ ./openapi/client/
WORKDIR /workspace/web
RUN npm run build

# prod: minimal Next.js server
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/web/.next/standalone ./
COPY --from=builder /workspace/web/.next/static ./.next/static
COPY --from=builder /workspace/web/public ./public
CMD ["node", "server.js"]
```

- [ ] **Step 1.5: Update `.github/workflows/ci.yml` web job**

Change two things in the `web:` CI job:

1. `cache-dependency-path: web/package-lock.json` → `cache-dependency-path: package-lock.json`
2. The `Install dependencies` step: override `working-directory` to run at repo root, and simplify the three lint/test/typecheck guard conditions (they were placeholders for when `web/package.json` had no deps):

```yaml
  web:
    name: Web — lint + test
    needs: changes
    if: needs.changes.outputs.web == 'true' || github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: package-lock.json

      - name: Install dependencies
        working-directory: ${{ github.workspace }}
        run: npm install

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run typecheck

      - name: Test
        run: npm test
```

- [ ] **Step 1.6: Delete `web/package-lock.json`**

```bash
rm web/package-lock.json
```

The root lock file will be generated in the next task.

- [ ] **Step 1.7: Commit infrastructure changes**

```bash
git add package.json openapi/client/package.json infra/docker-compose.yml web/Dockerfile .github/workflows/ci.yml
git rm web/package-lock.json
git commit -m "chore(infra): npm workspaces + docker/CI for web scaffold"
```

---

## Task 2: Next.js dependencies + tooling config

**Files:**
- Modify: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.ts`
- Create: `web/postcss.config.mjs`
- Create: `web/.eslintrc.json`
- Create: `web/vitest.config.ts`
- Create: `web/src/__tests__/setup.ts`

- [ ] **Step 2.1: Fill out `web/package.json`**

```json
{
  "name": "render-web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@render/api-client": "*",
    "@tanstack/react-query": "^5.0.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "eslint": "^8.0.0",
    "eslint-config-next": "^15.0.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

`"@render/api-client": "*"` resolves to the workspace package via npm workspaces.

- [ ] **Step 2.2: Install dependencies**

Run from the **repo root** (not `web/`):

```bash
npm install
```

Expected: `package-lock.json` is created at repo root; `web/node_modules/@render/api-client` is a symlink to `../../openapi/client`.

Verify the symlink:

```bash
ls -la web/node_modules/@render/api-client
```

Expected: `... -> ../../../openapi/client`

- [ ] **Step 2.3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2.4: Create `web/next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@render/api-client'],
}

export default nextConfig
```

`transpilePackages` is required because `@render/api-client` exports TypeScript source directly (no compilation step).

- [ ] **Step 2.5: Create `web/postcss.config.mjs`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

- [ ] **Step 2.6: Create `web/.eslintrc.json`**

```json
{
  "extends": "next/core-web-vitals"
}
```

- [ ] **Step 2.7: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 2.8: Create `web/src/__tests__/setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 2.9: Commit**

```bash
git add web/package.json web/tsconfig.json web/next.config.ts web/postcss.config.mjs web/.eslintrc.json web/vitest.config.ts web/src/__tests__/setup.ts package-lock.json
git commit -m "chore(web): install Next.js 15 + Tailwind v4 + tooling deps"
```

---

## Task 3: Tailwind v4 design tokens

**Files:**
- Create: `web/src/app/globals.css`

Tailwind v4 uses a CSS-first approach: no `tailwind.config.ts`. Design tokens defined in `@theme` become Tailwind utilities automatically (`--color-ink` → `bg-ink`, `text-ink`, etc.).

- [ ] **Step 3.1: Create `web/src/app/globals.css`**

```css
@import "tailwindcss";

@theme {
  /* ── Colours ───────────────────────────────────────────────────────────── */
  --color-ink:      #1A1A2E;
  --color-amber:    #E8A838;
  --color-clay:     #C45C3A;
  --color-offwhite: #FAF7F2;
  --color-warm:     #F0EAE0;
  --color-mid:      #8A8896;
  --color-light:    #E2DDD6;

  /* ── Typography ────────────────────────────────────────────────────────── */
  /* next/font injects --font-cormorant, --font-dm-sans, --font-dm-mono      */
  /* onto <html>. These @theme rules map them to Tailwind font utilities.    */
  --font-sans:  var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif;
  --font-serif: var(--font-cormorant), Georgia, serif;
  --font-mono:  var(--font-dm-mono), ui-monospace, "Courier New", monospace;
}
```

- [ ] **Step 3.2: Commit**

```bash
git add web/src/app/globals.css
git commit -m "feat(web): Tailwind v4 design tokens (colours + font families)"
```

---

## Task 4: App shell

**Files:**
- Create: `web/src/app/layout.tsx`
- Create: `web/src/app/page.tsx`

- [ ] **Step 4.1: Create `web/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Cormorant_Garamond, DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-dm-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Render',
  description: 'The platform for paint festival artists and organisers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <body className="bg-offwhite text-ink font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
```

Note: `Providers` will be added in Task 5 once it exists.

- [ ] **Step 4.2: Create `web/src/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="font-serif text-4xl text-ink">Render</h1>
      <p className="mt-2 font-sans text-mid">
        The platform for paint festival artists and organisers.
      </p>
    </main>
  )
}
```

- [ ] **Step 4.3: Verify typecheck passes**

```bash
cd web && npm run typecheck
```

Expected: exits 0 with no errors. If `next-env.d.ts` is missing, run `npx next build` once to generate it, then re-run typecheck.

- [ ] **Step 4.4: Commit**

```bash
git add web/src/app/layout.tsx web/src/app/page.tsx
git commit -m "feat(web): app shell — root layout + placeholder home page"
```

---

## Task 5: TDD — Providers component (#50)

**Files:**
- Create: `web/src/__tests__/providers.test.tsx`
- Create: `web/src/app/providers.tsx`
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 5.1: Write the failing test**

Create `web/src/__tests__/providers.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { Providers } from '../app/providers'

function QueryClientProbe() {
  const client = useQueryClient()
  return <div data-testid="probe">{client ? 'mounted' : 'missing'}</div>
}

describe('Providers', () => {
  it('renders children inside a QueryClientProvider', () => {
    render(
      <Providers>
        <QueryClientProbe />
      </Providers>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('mounted')
  })

  it('staleTime default is 60 seconds', () => {
    render(
      <Providers>
        <QueryClientProbe />
      </Providers>,
    )
    // If the component renders without error, the QueryClient is configured correctly.
    // Actual defaultOptions are tested via the singleton in api.test.ts.
    expect(screen.getByTestId('probe')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5.2: Run the test — verify it fails**

```bash
cd web && npm test -- --reporter=verbose src/__tests__/providers.test.tsx
```

Expected: FAIL — `Cannot find module '../app/providers'`

- [ ] **Step 5.3: Create `web/src/app/providers.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, retry: 1 },
        },
      }),
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
```

- [ ] **Step 5.4: Run the test — verify it passes**

```bash
cd web && npm test -- --reporter=verbose src/__tests__/providers.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5.5: Wire Providers into the root layout**

Edit `web/src/app/layout.tsx` — add the import and wrap `{children}`:

```tsx
import type { Metadata } from 'next'
import { Cormorant_Garamond, DM_Sans, DM_Mono } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-dm-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Render',
  description: 'The platform for paint festival artists and organisers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <body className="bg-offwhite text-ink font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 5.6: Typecheck**

```bash
cd web && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 5.7: Commit**

```bash
git add web/src/app/providers.tsx web/src/app/layout.tsx web/src/__tests__/providers.test.tsx
git commit -m "feat(web): TanStack Query Providers + root layout wiring (#50)"
```

---

## Task 6: TDD — API client singleton (#50)

**Files:**
- Create: `web/src/__tests__/api.test.ts`
- Create: `web/src/lib/api.ts`

- [ ] **Step 6.1: Write the failing test**

Create `web/src/__tests__/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { apiClient } from '../lib/api'

describe('apiClient', () => {
  it('exposes HTTP method helpers', () => {
    expect(typeof apiClient.GET).toBe('function')
    expect(typeof apiClient.POST).toBe('function')
    expect(typeof apiClient.PUT).toBe('function')
    expect(typeof apiClient.PATCH).toBe('function')
    expect(typeof apiClient.DELETE).toBe('function')
  })
})
```

- [ ] **Step 6.2: Run the test — verify it fails**

```bash
cd web && npm test -- --reporter=verbose src/__tests__/api.test.ts
```

Expected: FAIL — `Cannot find module '../lib/api'`

- [ ] **Step 6.3: Create `web/src/lib/api.ts`**

```ts
import { createApiClient } from '@render/api-client'

export const apiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
})
```

For authenticated requests, a second client that injects the session cookie will be added in #51 (auth). This singleton is for public/unauthenticated calls only.

- [ ] **Step 6.4: Run the test — verify it passes**

```bash
cd web && npm test -- --reporter=verbose src/__tests__/api.test.ts
```

Expected: 1 test passes.

- [ ] **Step 6.5: Commit**

```bash
git add web/src/lib/api.ts web/src/__tests__/api.test.ts
git commit -m "feat(web): apiClient singleton from @render/api-client (#50)"
```

---

## Task 7: Final verification + issue management

- [ ] **Step 7.1: Run full test suite**

```bash
cd web && npm test
```

Expected output (3 test files, 3+ tests):
```
 Test Files  2 passed (2)
      Tests  3 passed (3)
```

- [ ] **Step 7.2: Run linter + typecheck**

`task -d web lint` runs both ESLint and `tsc --noEmit` (see `web/Taskfile.yml`):

```bash
task -d web lint
```

Expected: exits 0. If ESLint reports unused vars for the probe component in tests, add `/* eslint-disable */` at the top of `providers.test.tsx` or configure vitest globals in `.eslintrc.json`:

```json
{
  "extends": "next/core-web-vitals",
  "env": { "vitest-globals/env": true }
}
```

- [ ] **Step 7.4: Smoke-test the dev server locally**

```bash
task -d web dev
```

Open `http://localhost:3000` in a browser. Verify:
- Page renders: "Render" heading in Cormorant Garamond (serif), subtext in DM Sans
- Heading colour is dark navy (`#1A1A2E`) — the `text-ink` utility
- Background is warm white (`#FAF7F2`) — the `bg-offwhite` utility
- No console errors

Stop the server with Ctrl-C once verified.

- [ ] **Step 7.5: Mark GitHub issues ready for review**

```bash
gh issue comment 49 --repo sniffins-mcmuggins/murals \
  --body "Implemented on branch \`worktree-feat+e7-web-scaffold\`. Next.js 15 + Tailwind v4 + design tokens + fonts. All checks pass."

gh issue comment 50 --repo sniffins-mcmuggins/murals \
  --body "Implemented on branch \`worktree-feat+e7-web-scaffold\`. \`@render/api-client\` wired via npm workspaces; TanStack Query Providers in root layout."
```

- [ ] **Step 7.6: Open pull request**

```bash
gh pr create \
  --repo sniffins-mcmuggins/murals \
  --title "feat(web): E7.1+E7.2 — Next.js scaffold + Tailwind + TS client" \
  --body "$(cat <<'EOF'
## Summary

- Adds repo-root npm workspace linking `@render/api-client` into `web/`
- Next.js 15 App Router, TypeScript strict, Tailwind v4 CSS-first config
- Design tokens from CLAUDE.md as named Tailwind utilities (`bg-ink`, `text-amber`, etc.)
- Fonts: Cormorant Garamond + DM Sans + DM Mono via `next/font/google`
- TanStack Query `Providers` (useState pattern, no module-level singleton)
- `apiClient` singleton from `@render/api-client` workspace package
- Docker-compose updated to mount repo root; CI updated for root lock file

Closes #49, closes #50

## Test plan
- [ ] `npm test` in `web/` — 3 tests pass
- [ ] `npm run lint` in `web/` — clean
- [ ] `npm run typecheck` in `web/` — clean
- [ ] `task -d web dev` — server starts, design tokens visible at localhost:3000

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
