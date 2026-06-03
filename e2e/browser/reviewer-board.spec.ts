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
      // Reviewer board is read-only: no staging buttons, no release, no drag handle
      await expect(page.getByRole('button', { name: '✓ Accept' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '~ Waitlist' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '✗ Decline' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Release/ })).toHaveCount(0)
      await expect(page.getByLabel('Drag to reorder')).toHaveCount(0)
      // Scoring IS available — open the slide-over and confirm the 1–5 star control
      await page.getByRole('button', { name: 'Score', exact: true }).click()
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
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })

      // Open the slide-over. Panel average is hidden until THIS reviewer scores.
      await page.getByRole('button', { name: 'Score', exact: true }).click()
      await expect(page.getByText(/Panel average/i)).toHaveCount(0)

      // Score 4 → my_score set, panel average unlocks (avg of reviewer2=2 and me=4)
      await page.getByLabel('Score 4').click()
      await expect(page.getByText(/Panel average/i)).toBeVisible({ timeout: 5_000 })

      // ...and the card carries an average badge once the slide-over is closed
      await page.keyboard.press('Escape')
      await expect(page.getByText(/★ \d/).first()).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('3 — score persists on page reload', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      // Scored in test 2 → card shows "Edit score" and the average badge persists across reload
      await expect(page.getByRole('button', { name: 'Edit score' })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/★ \d/).first()).toBeVisible()
      // Open and confirm my score persisted as 4 / 5
      await page.getByRole('button', { name: 'Edit score' }).click()
      await expect(page.getByText('4 / 5 · click to change')).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('4 — re-scoring updates the score', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      // Open the (already scored) slide-over and change the score from 4 to 2
      await page.getByRole('button', { name: 'Edit score' }).click()
      await page.getByLabel('Score 2').click()
      await expect(page.getByText('2 / 5 · click to change')).toBeVisible({ timeout: 5_000 })
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
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      // COI: their own application is hidden → no card for them, columns show the empty placeholder
      await expect(page.getByText(`Dual ${dualSuffix}`)).toHaveCount(0)
      await expect(page.getByText('empty').first()).toBeVisible({ timeout: 10_000 })
    } finally {
      await ctx.close()
    }
  })
})
