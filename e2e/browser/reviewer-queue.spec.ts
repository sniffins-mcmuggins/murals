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

async function inviteReviewer(orgToken: string, festivalId: string, email: string): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`Invite failed: ${res.status}`)
}

test.describe('reviewer queue', () => {
  const suffix = `rev-queue-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  let festivalId: string
  let orgToken: string
  let reviewerEmail: string
  let reviewerPassword: string

  test.beforeAll(async () => {
    const organiser = await createOrganiser(suffix)
    orgToken = organiser.token
    const { festivalId: fid } = await createFestival(orgToken, {
      name: `Reviewer Queue Fest ${suffix}`,
      slug: `rev-queue-${suffix}`,
    })
    festivalId = fid
    await upsertForm(orgToken, festivalId)
    await setFestivalStatus(orgToken, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-applicant`)
    await createProfile(applicant.token, { displayName: `Applicant ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-reviewer`)
    reviewerEmail = reviewer.email
    reviewerPassword = reviewer.password
    await inviteReviewer(orgToken, festivalId, reviewerEmail)
  })

  test('reviewer sees the queue, not the kanban, and can score', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)

      // Queue UI present; kanban columns absent.
      await expect(page.getByText(/You've scored 0 of 1/)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('heading', { name: 'Undecided' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '✓ Accept' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Release/ })).toHaveCount(0)

      // Score via the slide-over.
      await page.getByRole('button', { name: 'Score →' }).click()
      await page.getByRole('button', { name: 'Score 4' }).click()
      await page.keyboard.press('Escape')

      // Progress advances; no Decision controls were ever shown.
      await expect(page.getByText(/You've scored 1 of 1/)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Decision' })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
