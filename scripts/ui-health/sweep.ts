/**
 * UI health sweep — deterministic, scriptable browser pass over every route.
 *
 * Run:   npx tsx scripts/ui-health/sweep.ts          (full sweep, writes a report)
 *        npx tsx scripts/ui-health/sweep.ts --update-baseline   (accept current state as the new baseline)
 *
 * Requires the local stack to be up (web :3000, api :8080). It builds its own
 * fixtures via the e2e helpers — no dependency on the demo seed — then drives a
 * real Chrome (Playwright's bundled chromium) across each route in routes.json,
 * capturing per page:
 *   - console errors / warnings  (page 'console' + 'pageerror')
 *   - failed network requests    (HTTP >= 400)
 *   - slow network requests      (> SLOW_MS)
 *   - broken same-origin links   (harvested <a href>, HEAD-checked)
 *   - main-document load time
 *
 * Output:
 *   docs/ui-health/report.md     human-readable, newest run
 *   docs/ui-health/report.json   machine-readable, newest run
 *   docs/ui-health/baseline.json committed "known issues" — the sweep only flags
 *                                NEW problems vs this, so existing noise doesn't drown signal.
 *
 * Why a script and not ad-hoc MCP calls: predictability. Same routes, same checks,
 * same report shape every run, diffable against a baseline, CI-able. Use
 * chrome-devtools-mcp for the *why* (perf-trace insights, heap) once this flags a route.
 */
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createArtist,
  createOrganiser,
  createProfile,
  publishProfile,
  createCollection,
  createFestival,
  setFestivalStatus,
  upsertForm,
} from '../../e2e/fixtures/helpers'

// `task ui-health` runs from the repo root; resolve everything from there so the
// script is agnostic to ESM/CJS module mode (no import.meta / __dirname needed).
const REPO_ROOT = process.cwd()
const HERE = resolve(REPO_ROOT, 'scripts/ui-health')
const OUT_DIR = resolve(REPO_ROOT, 'docs/ui-health')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const SLOW_MS = Number(process.env.SLOW_MS ?? 2000)
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT ?? 15000)
const UPDATE_BASELINE = process.argv.includes('--update-baseline')

type Auth = 'public' | 'artist' | 'organiser'
interface RouteSpec { path: string; auth: Auth; waitFor?: string }
interface Manifest { routes: RouteSpec[]; skipped?: { path: string; reason: string }[] }

interface RouteResult {
  path: string
  auth: Auth
  loadMs: number
  consoleErrors: string[]
  consoleWarnings: string[]
  failedRequests: { url: string; status: number }[]
  slowRequests: { url: string; ms: number }[]
  brokenLinks: { href: string; status: number }[]
  navError?: string
}

/** Strip volatile bits so baseline comparison doesn't false-positive on UUIDs/ports/timestamps. */
function normalize(s: string): string {
  return s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/:\d{2,5}\b/g, ':{port}')
    .replace(/\b\d{10,13}\b/g, '{ts}')
    .replace(/\s+/g, ' ')
    .trim()
}

async function buildFixtures(): Promise<Record<string, string>> {
  const sfx = Date.now()
  // Primary artist: published profile + collection, can apply to the open festival.
  const artist = await createArtist(`uih-artist-${sfx}`)
  const { profileId: artistProfileId } = await createProfile(artist.token, {
    displayName: `UIH Artist ${sfx}`,
    bio: 'Health-sweep fixture artist.',
  })
  // Create the collection BEFORE publishing: publishing seeds the public snapshot,
  // and a collection added afterwards isn't in it → public GET 404s (see
  // api/internal/artist/collection.go "Collection not in snapshot"). Mirror the real
  // flow — set up content, then publish.
  const { collectionId } = await createCollection(artist.token, { name: `UIH Collection ${sfx}` })
  await publishProfile(artist.token)

  // Second artist: a different published profile so /endorse/{id} has a valid target.
  const other = await createArtist(`uih-other-${sfx}`)
  const { profileId: otherProfileId } = await createProfile(other.token, {
    displayName: `UIH Other ${sfx}`,
  })
  await publishProfile(other.token)

  // Organiser: festival with a form, open for applications.
  const org = await createOrganiser(`uih-org-${sfx}`)
  const { festivalId, slug: festivalSlug } = await createFestival(org.token, {
    name: `UIH Festival ${sfx}`,
    slug: `uih-fest-${sfx}`,
  })
  await upsertForm(org.token, festivalId)
  await setFestivalStatus(org.token, festivalId, 'open')

  return {
    artistProfileId,
    otherProfileId,
    collectionId,
    festivalId,
    festivalSlug,
    applyFestivalId: festivalId,
    // tokens/credentials carried out-of-band for login (prefixed _ so they're not substituted into paths)
    _artistEmail: artist.email,
    _artistPassword: artist.password,
    _orgEmail: org.email,
    _orgPassword: org.password,
  }
}

async function login(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: BASE_URL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await page.waitForURL('/dashboard', { timeout: NAV_TIMEOUT }).catch(() => {
    /* organiser may land elsewhere; tolerate and proceed */
  })
  await page.close()
  return ctx
}

function substitute(path: string, fx: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_, key) => fx[key] ?? `{MISSING:${key}}`)
}

async function visit(ctx: BrowserContext, spec: RouteSpec, fx: Record<string, string>): Promise<RouteResult> {
  const url = substitute(spec.path, fx)
  const page = await ctx.newPage()
  const r: RouteResult = {
    path: spec.path, auth: spec.auth, loadMs: 0,
    consoleErrors: [], consoleWarnings: [], failedRequests: [], slowRequests: [], brokenLinks: [],
  }

  page.on('console', (msg) => {
    const type = msg.type()
    if (type === 'error') r.consoleErrors.push(normalize(msg.text()))
    else if (type === 'warning') r.consoleWarnings.push(normalize(msg.text()))
  })
  page.on('pageerror', (err) => r.consoleErrors.push(normalize(`[pageerror] ${err.message}`)))
  page.on('response', (res) => {
    const status = res.status()
    const u = res.url()
    if (u.startsWith('data:')) return
    if (status >= 400) r.failedRequests.push({ url: normalize(u), status })
    const timing = res.request().timing()
    const ms = timing.responseEnd
    if (ms > SLOW_MS) r.slowRequests.push({ url: normalize(u), ms: Math.round(ms) })
  })

  const start = Date.now()
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT })
    if (spec.waitFor) await page.waitForSelector(spec.waitFor, { timeout: 5000 }).catch(() => {})
  } catch (e) {
    r.navError = normalize(String((e as Error).message))
  }
  r.loadMs = Date.now() - start

  // Harvest same-origin links and check them (deduped, HEAD then GET fallback).
  try {
    const hrefs: string[] = await page.$$eval('a[href]', (as) =>
      (as as HTMLAnchorElement[]).map((a) => a.href).filter((h) => h.startsWith(location.origin)),
    )
    const seen = new Set<string>()
    for (const href of hrefs) {
      const clean = href.split('#')[0]
      if (seen.has(clean)) continue
      seen.add(clean)
      try {
        let resp = await ctx.request.head(clean, { timeout: 5000 })
        if (resp.status() === 405) resp = await ctx.request.get(clean, { timeout: 5000 })
        if (resp.status() >= 400) r.brokenLinks.push({ href: normalize(clean), status: resp.status() })
      } catch {
        r.brokenLinks.push({ href: normalize(clean), status: 0 })
      }
    }
  } catch {
    /* link harvest is best-effort */
  }

  await page.close()
  return r
}

/** Returns only the issues present now that are NOT in the baseline. */
function diffAgainstBaseline(results: RouteResult[], baseline: Record<string, RouteResult>) {
  const regressions: { path: string; kind: string; detail: string }[] = []
  for (const r of results) {
    const base = baseline[r.path]
    const known = (arr: string[]) => new Set(arr.map(normalize))
    const add = (kind: string, items: string[], baseItems: string[]) => {
      const b = known(baseItems)
      for (const it of items) if (!b.has(normalize(it))) regressions.push({ path: r.path, kind, detail: it })
    }
    add('console-error', r.consoleErrors, base?.consoleErrors ?? [])
    add('console-warning', r.consoleWarnings, base?.consoleWarnings ?? [])
    add('failed-request', r.failedRequests.map((x) => `${x.status} ${x.url}`), (base?.failedRequests ?? []).map((x) => `${x.status} ${x.url}`))
    add('broken-link', r.brokenLinks.map((x) => `${x.status} ${x.href}`), (base?.brokenLinks ?? []).map((x) => `${x.status} ${x.href}`))
    if (r.navError && r.navError !== base?.navError) regressions.push({ path: r.path, kind: 'nav-error', detail: r.navError })
  }
  return regressions
}

function renderMarkdown(results: RouteResult[], regressions: ReturnType<typeof diffAgainstBaseline>): string {
  const lines: string[] = []
  lines.push(`# UI Health Sweep — ${new Date().toISOString()}`)
  lines.push('')
  const totErr = results.reduce((n, r) => n + r.consoleErrors.length, 0)
  const totWarn = results.reduce((n, r) => n + r.consoleWarnings.length, 0)
  const totFail = results.reduce((n, r) => n + r.failedRequests.length, 0)
  const totBroken = results.reduce((n, r) => n + r.brokenLinks.length, 0)
  lines.push(`**Routes swept:** ${results.length}  |  **Console errors:** ${totErr}  |  **Warnings:** ${totWarn}  |  **Failed requests:** ${totFail}  |  **Broken links:** ${totBroken}`)
  lines.push('')
  lines.push(`## Regressions vs baseline (${regressions.length})`)
  if (regressions.length === 0) lines.push('\n_None. Every issue below is already in the baseline._')
  else { lines.push(''); lines.push('| Route | Kind | Detail |'); lines.push('|---|---|---|'); for (const x of regressions) lines.push(`| \`${x.path}\` | ${x.kind} | ${x.detail.slice(0, 160)} |`) }
  lines.push('')
  lines.push('## Per-route detail')
  lines.push('')
  lines.push('| Route | Auth | Load ms | Errs | Warns | Failed | Slow | Broken |')
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|')
  for (const r of results) lines.push(`| \`${r.path}\` | ${r.auth} | ${r.loadMs} | ${r.consoleErrors.length} | ${r.consoleWarnings.length} | ${r.failedRequests.length} | ${r.slowRequests.length} | ${r.brokenLinks.length} |`)
  lines.push('')
  for (const r of results) {
    if (!r.consoleErrors.length && !r.failedRequests.length && !r.brokenLinks.length && !r.navError) continue
    lines.push(`### \`${r.path}\``)
    if (r.navError) lines.push(`- **nav error:** ${r.navError}`)
    for (const e of r.consoleErrors) lines.push(`- console error: ${e}`)
    for (const f of r.failedRequests) lines.push(`- failed request: ${f.status} ${f.url}`)
    for (const b of r.brokenLinks) lines.push(`- broken link: ${b.status} ${b.href}`)
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const manifest: Manifest = JSON.parse(readFileSync(resolve(HERE, 'routes.json'), 'utf8'))

  console.log('› building fixtures via e2e helpers…')
  const fx = await buildFixtures()

  const browser = await chromium.launch()
  console.log('› logging in artist + organiser…')
  const ctxs: Record<Auth, BrowserContext> = {
    public: await browser.newContext({ baseURL: BASE_URL }),
    artist: await login(browser, fx._artistEmail, fx._artistPassword),
    organiser: await login(browser, fx._orgEmail, fx._orgPassword),
  }

  const results: RouteResult[] = []
  for (const spec of manifest.routes) {
    process.stdout.write(`  · ${spec.auth.padEnd(9)} ${spec.path} … `)
    const r = await visit(ctxs[spec.auth], spec, fx)
    results.push(r)
    console.log(`${r.loadMs}ms  e:${r.consoleErrors.length} f:${r.failedRequests.length} b:${r.brokenLinks.length}${r.navError ? '  NAV-ERR' : ''}`)
  }

  await browser.close()

  const baselinePath = resolve(OUT_DIR, 'baseline.json')
  if (UPDATE_BASELINE) {
    const byPath: Record<string, RouteResult> = {}
    for (const r of results) byPath[r.path] = r
    writeFileSync(baselinePath, JSON.stringify(byPath, null, 2))
    console.log(`\n✓ baseline updated → ${baselinePath}`)
    return
  }

  const baseline: Record<string, RouteResult> = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : {}
  const regressions = diffAgainstBaseline(results, baseline)

  writeFileSync(resolve(OUT_DIR, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results, regressions }, null, 2))
  writeFileSync(resolve(OUT_DIR, 'report.md'), renderMarkdown(results, regressions))
  console.log(`\n✓ report → docs/ui-health/report.md   (${regressions.length} regressions vs baseline)`)
  if (!existsSync(baselinePath)) console.log('  no baseline yet — run with --update-baseline to establish one.')

  // Non-zero exit on regressions so this can gate CI later.
  if (regressions.length > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
