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

async function setCriteria(orgToken: string, festivalId: string, criteria: object[]) {
  const res = await fetch(`${API}/festivals/${festivalId}/form`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ review_criteria: criteria }),
  })
  if (!res.ok) throw new Error(`setCriteria failed: ${res.status}`)
  return res.json()
}

async function inviteReviewer(orgToken: string, festivalId: string, email: string) {
  const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`inviteReviewer failed: ${res.status}`)
}

test.describe('rubric scoring', () => {
  const suffix = `rubric-browser-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('1 — organiser adds criteria on the settings page', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org1`)
    const { festivalId } = await createFestival(org.token, {
      name: `Rubric Fest 1 ${suffix}`, slug: `rub1-${suffix}`,
    })
    await upsertForm(org.token, festivalId)

    const { ctx, page } = await loginAs(browser, org.email, org.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}`)
      await expect(page.getByRole('heading', { name: 'Scoring criteria' })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('No criteria set')).toBeVisible()

      await page.fill('input[placeholder="e.g. Artistic Quality"]', 'Artistic Quality')
      await page.getByRole('button', { name: 'Add' }).click()

      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('No criteria set')).not.toBeVisible()

      await page.reload()
      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('2 — reviewer sees per-criterion stars in slide-over (not single star)', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org2`)
    const { festivalId } = await createFestival(org.token, {
      name: `Rubric Fest 2 ${suffix}`, slug: `rub2-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-app2`)
    await createProfile(applicant.token, { displayName: `Rubric Artist ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-rev2`)
    await inviteReviewer(org.token, festivalId, reviewer.email)
    await setCriteria(org.token, festivalId, [
      { label: 'Artistic Quality', min: 1, max: 5 },
      { label: 'Feasibility', min: 1, max: 5 },
    ])

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })

      await expect(page.getByRole('button', { name: /Score/i })).toBeVisible()
      await expect(page.getByLabel('Score 1')).not.toBeVisible()

      await page.getByRole('button', { name: /Score/i }).click()

      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('Feasibility')).toBeVisible()
      await expect(page.getByLabel('Score Artistic Quality 3')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('3 — reviewer scores criteria, panel avg appears in slide-over', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org3`)
    const { festivalId } = await createFestival(org.token, {
      name: `Rubric Fest 3 ${suffix}`, slug: `rub3-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-app3`)
    await createProfile(applicant.token, { displayName: `Rubric Artist 3 ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-rev3`)
    await inviteReviewer(org.token, festivalId, reviewer.email)
    await setCriteria(org.token, festivalId, [
      { label: 'Artistic Quality', min: 1, max: 5 },
    ])

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('button', { name: /Score/i }).first()).toBeVisible({ timeout: 10_000 })

      await page.getByRole('button', { name: /Score/i }).first().click()
      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })

      await page.getByLabel('Score Artistic Quality 4').click()
      await page.waitForTimeout(800)

      await expect(page.getByText(/Panel average/i)).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })
})
