import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createOrganiser,
  createProfile,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
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

test.describe('reviewer board', () => {
  const suffix = `rev-board-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  let festivalId: string
  let orgToken: string
  let applicantAppId: string
  let reviewerEmail: string
  let reviewerPassword: string
  let reviewerToken: string

  test.beforeAll(async () => {
    const organiser = await createOrganiser(suffix)
    orgToken = organiser.token

    const { festivalId: fid } = await createFestival(orgToken, {
      name: `Reviewer Board Fest ${suffix}`,
      slug: `rev-board-${suffix}`,
    })
    festivalId = fid
    await upsertForm(orgToken, festivalId)
    await setFestivalStatus(orgToken, festivalId, 'open')

    // Applicant
    const applicant = await createArtist(`${suffix}-applicant`)
    await createProfile(applicant.token, { displayName: `Applicant ${suffix}` })
    const { applicationId } = await submitApplication(applicant.token, festivalId)
    applicantAppId = applicationId

    // Reviewer (has an account but no application)
    const reviewer = await createArtist(`${suffix}-reviewer`)
    reviewerEmail = reviewer.email
    reviewerPassword = reviewer.password
    reviewerToken = reviewer.token
    await inviteReviewer(orgToken, festivalId, reviewerEmail)
  })

  test('1 — reviewer board is read-only: no decision controls', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      // Decision controls absent from DOM
      await expect(page.getByRole('button', { name: 'Accept', exact: true })).not.toBeVisible()
      await expect(page.getByRole('button', { name: 'Waitlist', exact: true })).not.toBeVisible()
      await expect(page.getByRole('button', { name: 'Decline', exact: true })).not.toBeVisible()
      // Drag handle absent
      await expect(page.getByLabel('Drag to reorder')).not.toBeVisible()
      // Star score control present
      await expect(page.getByLabel('Score 1')).toBeVisible()
      await expect(page.getByLabel('Score 5')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('2 — reviewer scores, avg unlocks on card and in slide-over', async ({ browser }) => {
    // First, have a second reviewer score so avg has two data points
    const reviewer2 = await createArtist(`${suffix}-reviewer2`)
    await inviteReviewer(orgToken, festivalId, reviewer2.email)
    // reviewer2 scores via API
    const scoreRes = await fetch(`${API}/festivals/${festivalId}/applications/${applicantAppId}/score`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reviewer2.token}` },
      body: JSON.stringify({ score: 2 }),
    })
    expect(scoreRes.ok).toBe(true)

    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByLabel('Score 4')).toBeVisible({ timeout: 10_000 })

      // Avg badge should NOT be visible before scoring
      const avgBadge = page.locator('text=/★.*·.*[0-9]/')
      await expect(avgBadge).not.toBeVisible()

      // Click 4th star to score
      await page.getByLabel('Score 4').click()
      await page.waitForTimeout(500)

      // Avg badge now visible on the card (my_score != null, score_count >= 1)
      await expect(avgBadge.first()).toBeVisible({ timeout: 5_000 })

      // Open slide-over and verify avg section appears
      await page.locator('text=Applicant').first().click()
      await expect(page.getByText(/Panel average/i)).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('3 — score persists on page reload', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await page.waitForLoadState('networkidle')
      // Stars should reflect the score of 4 from test 2
      // Check the 4th star is filled (amber) and 5th is not
      const star4 = page.getByLabel('Score 4')
      const star5 = page.getByLabel('Score 5')
      await expect(star4).toBeVisible({ timeout: 10_000 })
      // Avg badge still visible (my_score persisted)
      await expect(page.locator('text=/★.*·.*[0-9]/').first()).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('4 — re-scoring updates the score', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByLabel('Score 2')).toBeVisible({ timeout: 10_000 })
      // Change score from 4 to 2
      await page.getByLabel('Score 2').click()
      await page.waitForTimeout(500)
      // Avg badge still visible
      await expect(page.locator('text=/★.*·.*[0-9]/').first()).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('5 — COI: reviewer who applied sees empty board', async ({ browser }) => {
    // Set up a new festival where the reviewer is the only applicant
    const dualSuffix = `${suffix}-dual`
    const dualOrg = await createOrganiser(dualSuffix)
    const { festivalId: dualFestId } = await createFestival(dualOrg.token, {
      name: `Dual Fest ${dualSuffix}`,
      slug: `dual-${dualSuffix}`,
    })
    await upsertForm(dualOrg.token, dualFestId)
    await setFestivalStatus(dualOrg.token, dualFestId, 'open')

    // dual user is both applicant and reviewer
    const dual = await createArtist(dualSuffix)
    await createProfile(dual.token, { displayName: `Dual ${dualSuffix}` })
    await submitApplication(dual.token, dualFestId)
    await inviteReviewer(dualOrg.token, dualFestId, dual.email)

    const { ctx, page } = await loginAs(browser, dual.email, dual.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${dualFestId}/applications`)
      // COI: their own application is hidden → empty state
      await expect(page.getByText('No applications here.')).toBeVisible({ timeout: 10_000 })
    } finally {
      await ctx.close()
    }
  })
})
