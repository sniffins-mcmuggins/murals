// Shared, off-screen setup for the per-feature demo clips.
//
// The clips are short (≤ ~20s) and self-contained: only `artist-signup` shows a
// visible registration/login. Every other clip silently injects a session cookie
// (no login UI) and navigates straight to the page it demonstrates. Some organiser
// clips also need the festival in a particular state (round closed, an artist
// accepted, a spot assigned) — that precondition is built here via the API, never
// on camera, so the recording shows only the headline interaction.
//
// NOT a test file — `playwright.config.ts` testMatch is scoped to artist-*/organiser-*
// so this module is never collected as a spec.
import type { Page, APIRequestContext } from '@playwright/test'

export const API = process.env.API_URL ?? 'http://localhost:8080'
export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

// All seeded demo accounts share one password (see demos/seed/main.go).
export const DEMO_PW = 'demo-password-2027'
export const ARTIST_EMAIL = 'ladygabe@demo.art'
// Lady Gabe OWNS CPF 2027 (seed: owner: featured), so she IS its organiser — the
// organiser clips log in as her. marcus@cpf-demo.art still owns Upfest (the apply target).
export const ORGANISER_EMAIL = ARTIST_EMAIL
// The marcus account, kept for the Upfest-owner / apply-target festival.
export const UPFEST_ORGANISER_EMAIL = 'marcus@cpf-demo.art'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// ── Auth ─────────────────────────────────────────────────────────────────────

/** Set the `session` cookie on the browser context so the next navigation is authed. */
async function setSessionCookie(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{
    name: 'session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }])
}

/** Log in a pre-seeded account and drop its session cookie — no login UI shown. */
export async function silentLogin(page: Page, email = ARTIST_EMAIL, password = DEMO_PW): Promise<string> {
  const res = await page.request.post(`${API}/auth/login`, { data: { email, password }, headers: JSON_HEADERS })
  if (!res.ok()) throw new Error(`silentLogin(${email}): ${res.status()}`)
  const { token } = await res.json()
  await setSessionCookie(page, token)
  return token
}

/** Create a fresh account (verified) and drop its session cookie — no signup UI shown. */
export async function silentSignup(page: Page, email: string, password = DEMO_PW): Promise<string> {
  await page.request.post(`${API}/auth/signup`, { data: { email, password }, headers: JSON_HEADERS })
  await page.request.post(`${API}/_test/verify-email`, { data: { email }, headers: JSON_HEADERS })
  return silentLogin(page, email, password)
}

/** Redeem the demo promo so a fresh account can publish/apply (uses the session cookie). */
export async function redeemPromo(page: Page): Promise<void> {
  const res = await page.request.post(`${API}/promo/redeem`, { data: { code: 'DEMO2027' }, headers: JSON_HEADERS })
  if (!res.ok()) throw new Error(`redeemPromo: ${res.status()}`)
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/** The id of the (live) Cheltenham Paint Festival 2027 — used by the organiser clips. */
export async function cpfFestivalId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${API}/public/festivals?status=live`)
  const festivals: Array<{ id: string; slug: string }> = await res.json()
  const cpf = festivals.find(f => f.slug === 'cpf-2027')
  if (!cpf) throw new Error('cpfFestivalId: cpf-2027 not found (did you run task demos:seed?)')
  return cpf.id
}

/** The id of the (open) Upfest 2027 — the festival Lady Gabe applies to as an artist. */
export async function upfestFestivalId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${API}/public/festivals?status=open`)
  const festivals: Array<{ id: string; slug: string }> = await res.json()
  const upfest = festivals.find(f => f.slug === 'upfest-2027')
  if (!upfest) throw new Error('upfestFestivalId: upfest-2027 not found (did you run task demos:seed?)')
  return upfest.id
}

/** The signed-in artist's own profile id (artist_profiles.id). */
export async function myProfileId(page: Page): Promise<string> {
  const res = await page.request.get(`${API}/profiles/me`)
  const { id } = await res.json()
  return id
}

// ── Organiser off-screen state (all act as the signed-in organiser) ───────────

type Application = { id: string; answers?: Record<string, unknown>; [k: string]: unknown }

export async function listApplications(page: Page, festivalId: string): Promise<Application[]> {
  const res = await page.request.get(`${API}/festivals/${festivalId}/applications`)
  if (!res.ok()) throw new Error(`listApplications: ${res.status()}`)
  const body = await res.json()
  // Endpoint returns either an array or { applications: [...] } depending on shape.
  return Array.isArray(body) ? body : (body.applications ?? [])
}

/** Find an application id by the applicant's display name (matches any field). */
export async function findApplicationByName(page: Page, festivalId: string, name: string): Promise<string> {
  const apps = await listApplications(page, festivalId)
  const hit = apps.find(a => JSON.stringify(a).includes(name))
  if (!hit) throw new Error(`findApplicationByName: "${name}" not found among ${apps.length} applications`)
  return hit.id
}

export async function openRound(page: Page, festivalId: string): Promise<void> {
  await page.request.post(`${API}/festivals/${festivalId}/review/open`, { data: {}, headers: JSON_HEADERS })
}

export async function closeRound(page: Page, festivalId: string): Promise<void> {
  await page.request.post(`${API}/festivals/${festivalId}/review/close`, { data: {}, headers: JSON_HEADERS })
}

/** Stage a decision on an application (round must be closed first). */
export async function stageDecision(
  page: Page, festivalId: string, applicationId: string, decision: 'accept' | 'decline' | 'waitlist',
): Promise<void> {
  const res = await page.request.post(
    `${API}/festivals/${festivalId}/applications/${applicationId}/${decision}`,
    { data: {}, headers: JSON_HEADERS },
  )
  if (!res.ok()) throw new Error(`stageDecision(${decision}): ${res.status()}`)
}

export async function releaseDecisions(page: Page, festivalId: string): Promise<void> {
  const res = await page.request.post(
    `${API}/festivals/${festivalId}/applications/release-decisions`,
    { data: { confirm: true }, headers: JSON_HEADERS },
  )
  if (!res.ok()) throw new Error(`releaseDecisions: ${res.status()}`)
}

// The seeded CPF applicants (see demos/seed/main.go — artistSeed).
const SEED_APPLICANTS = ['Kit Harrow', 'Tomás Cruz', 'Amara Diallo', 'Rosa Vane']

/**
 * Drive the full organiser decision flow off-screen so a clip can start from a
 * released state (accepted artists become eligible for map placement). Opens then
 * closes the round, accepts the named artists, declines the rest, and releases —
 * release requires *every* submitted application to have a staged decision.
 */
export async function decideAllAndRelease(page: Page, festivalId: string, accept: string[]): Promise<void> {
  await openRound(page, festivalId)
  await closeRound(page, festivalId)
  for (const name of SEED_APPLICANTS) {
    const appId = await findApplicationByName(page, festivalId, name)
    await stageDecision(page, festivalId, appId, accept.includes(name) ? 'accept' : 'decline')
  }
  await releaseDecisions(page, festivalId)
}

export async function createSpot(page: Page, festivalId: string, lat: number, lng: number): Promise<string> {
  const res = await page.request.post(
    `${API}/festivals/${festivalId}/spots`,
    { data: { lat, lng }, headers: JSON_HEADERS },
  )
  if (!res.ok()) throw new Error(`createSpot: ${res.status()}`)
  const { id } = await res.json()
  return id
}

/** GET /spots returns { spots, unassigned_artists } — the artist_id used for assignment. */
export async function eligibleArtistId(page: Page, festivalId: string, name: string): Promise<string> {
  const res = await page.request.get(`${API}/festivals/${festivalId}/spots`)
  const body = await res.json()
  const list: Array<{ artist_id: string; name: string }> = body.unassigned_artists ?? []
  const hit = list.find(a => a.name?.includes(name))
  if (!hit) throw new Error(`eligibleArtistId: "${name}" not eligible/unassigned`)
  return hit.artist_id
}

export async function assignArtist(page: Page, festivalId: string, spotId: string, artistId: string): Promise<void> {
  const res = await page.request.put(
    `${API}/festivals/${festivalId}/spots/${spotId}/artist`,
    { data: { artist_id: artistId }, headers: JSON_HEADERS },
  )
  if (!res.ok()) throw new Error(`assignArtist: ${res.status()}`)
}
