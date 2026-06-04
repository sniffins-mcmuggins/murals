import { test, expect, Browser } from '@playwright/test'
import {
  createArtist, createOrganiser, createProfile,
  createFestival, setFestivalStatus, upsertForm, submitApplication,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

async function loginAs(browser: Browser, email: string, password: string, baseURL: string) {
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
  return { ctx, page }
}

async function inviteReviewer(orgToken: string, festivalId: string, email: string) {
  const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`Invite failed: ${res.status}`)
}

test.describe('anonymous review', () => {
  const suffix = `anon-browser-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('1 — organiser enables anonymous review toggle on settings page', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org1`)
    const { festivalId } = await createFestival(org.token, {
      name: `Anon Fest ${suffix}`,
      slug: `anon-${suffix}`,
    })
    await upsertForm(org.token, festivalId)

    const { ctx, page } = await loginAs(browser, org.email, org.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}`)
      // Anonymous review section is visible
      await expect(page.getByRole('heading', { name: 'Anonymous review' })).toBeVisible({ timeout: 10_000 })
      // Toggle is off by default
      const checkbox = page.getByRole('checkbox')
      await expect(checkbox).not.toBeChecked()
      // Enable it
      await checkbox.click()
      // Wait for the checkbox to become checked (mutation + query invalidation cycle)
      await expect(page.getByRole('checkbox')).toBeChecked({ timeout: 5_000 })
      // Reload and verify it persisted
      await page.reload()
      await expect(page.getByRole('checkbox')).toBeChecked({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('2 — reviewer sees "Anonymous artist" placeholder before scoring', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org2`)
    const { festivalId } = await createFestival(org.token, {
      name: `Anon Fest 2 ${suffix}`,
      slug: `anon2-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-app2`)
    await createProfile(applicant.token, { displayName: `Real Artist ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-rev2`)
    await inviteReviewer(org.token, festivalId, reviewer.email)

    // Enable anonymous review via API
    await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
      body: JSON.stringify({ anonymous_review: true }),
    })

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      // Shows anonymous placeholder, not real name
      await expect(page.getByText('Anonymous artist')).toBeVisible()
      await expect(page.getByText(`Real Artist ${suffix}`)).not.toBeVisible()
      // Identity stays hidden until the reviewer scores — the Score control is the reveal gate
      await expect(page.getByRole('button', { name: 'Score', exact: true })).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('3 — reviewer scores and real identity is revealed', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org3`)
    const { festivalId } = await createFestival(org.token, {
      name: `Anon Fest 3 ${suffix}`,
      slug: `anon3-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-app3`)
    await createProfile(applicant.token, { displayName: `Reveal Artist ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-rev3`)
    await inviteReviewer(org.token, festivalId, reviewer.email)

    // Enable anonymous review via API
    await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
      body: JSON.stringify({ anonymous_review: true }),
    })

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByText('Anonymous artist')).toBeVisible({ timeout: 10_000 })

      // Open the slide-over and score 3 — scoring reveals the real identity (API flips identity_hidden)
      await page.getByRole('button', { name: 'Score', exact: true }).click()
      await page.getByLabel('Score 3').click()

      // Real name now visible on the revealed panel; placeholder gone.
      // Assert the slide-over heading (font-serif, top-layer, never truncated) rather
      // than the board card's `truncate` div — under CI load that flex cell can momentarily
      // compute to zero width, making the present-but-clipped text report as hidden.
      await expect(page.getByRole('heading', { name: `Reveal Artist ${suffix}` })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('Anonymous artist')).not.toBeVisible()
    } finally {
      await ctx.close()
    }
  })
})
