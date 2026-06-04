import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  createProfile,
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

test.describe('reviewer management', () => {
  const suffix = `rev-mgmt-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('1 — organiser invites reviewer, pending badge appears in settings', async ({ browser }) => {
    const organiser = await createOrganiser(`${suffix}-inv`)
    const { festivalId } = await createFestival(organiser.token, {
      name: `Invite Fest ${suffix}`,
      slug: `invite-${suffix}`,
    })
    const reviewer = await createArtist(`${suffix}-inv-rev`)

    const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}`)
      await expect(page.getByRole('heading', { name: 'Reviewers' })).toBeVisible({ timeout: 10_000 })

      // Invite via the UI
      await page.fill('input[placeholder="email@example.com"]', reviewer.email)
      await page.getByRole('button', { name: 'Invite' }).click()

      // Reviewer row appears with pending badge
      await expect(page.getByText(reviewer.email)).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('pending')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('2 — invited reviewer gets read-only board', async ({ browser }) => {
    const organiser = await createOrganiser(`${suffix}-ro`)
    const { festivalId } = await createFestival(organiser.token, {
      name: `RO Fest ${suffix}`,
      slug: `ro-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const applicant = await createArtist(`${suffix}-ro-app`)
    await createProfile(applicant.token, { displayName: `RO Applicant ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-ro-rev`)
    await inviteReviewer(organiser.token, festivalId, reviewer.email)

    // Open the review round so the reviewer can score
    const open = await fetch(`${API}/festivals/${festivalId}/review/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${organiser.token}` },
    })
    if (!open.ok) throw new Error(`Open round failed: ${open.status}`)

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      // Reviewer sees the queue (h1 = festival name), not the kanban
      await expect(page.getByRole('heading', { name: `RO Fest ${suffix}`, exact: false })).toBeVisible({ timeout: 10_000 })
      // Read-only queue: no staging buttons, but scoring is available
      await expect(page.getByRole('button', { name: '✓ Accept' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Score/i }).first()).toBeVisible()
      await page.getByRole('button', { name: /Score/i }).first().click()
      await expect(page.getByLabel('Score 1')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('3 — full entry-point flow: dashboard card → reviewing page → board', async ({ browser }) => {
    const organiser = await createOrganiser(`${suffix}-flow`)
    const { festivalId } = await createFestival(organiser.token, {
      name: `Flow Fest ${suffix}`,
      slug: `flow-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const applicant = await createArtist(`${suffix}-flow-app`)
    await createProfile(applicant.token, { displayName: `Flow Applicant ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-flow-rev`)
    await inviteReviewer(organiser.token, festivalId, reviewer.email)

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      // Navigate to organiser dashboard where the Reviewing card lives
      await page.goto('/organiser/dashboard')
      await expect(page.getByRole('heading', { name: /Reviewing \(\d+\)/ })).toBeVisible({ timeout: 10_000 })
      await page.getByRole('heading', { name: /Reviewing \(\d+\)/ }).click()

      // /organiser/reviewing lists the festival
      await expect(page).toHaveURL('/organiser/reviewing')
      await expect(page.getByText(`Flow Fest ${suffix}`)).toBeVisible({ timeout: 10_000 })
      await page.getByRole('link', { name: 'Go to applications →' }).click()

      // Lands on reviewer queue (h1 = festival name, no kanban)
      await expect(page.getByRole('heading', { name: `Flow Fest ${suffix}`, exact: false })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: 'Accept', exact: true })).not.toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('4 — dual-role: organiser invited to review peer festival sees both dashboard cards', async ({ browser }) => {
    const userA = await createOrganiser(`${suffix}-dual-a`)
    const userB = await createOrganiser(`${suffix}-dual-b`)

    // userA owns festival A
    await createFestival(userA.token, {
      name: `User A Fest ${suffix}`,
      slug: `user-a-${suffix}`,
    })

    // userB owns festival B and invites userA as a reviewer
    const { festivalId: festB } = await createFestival(userB.token, {
      name: `User B Fest ${suffix}`,
      slug: `user-b-${suffix}`,
    })
    await inviteReviewer(userB.token, festB, userA.email)

    const { ctx, page } = await loginAs(browser, userA.email, userA.password, baseURL)
    try {
      // Navigate to organiser dashboard where both cards appear
      await page.goto('/organiser/dashboard')
      // Both cards visible
      await expect(page.getByRole('heading', { name: 'Festivals', exact: true })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('heading', { name: /Reviewing \(\d+\)/ })).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('5 — reviewing page lists multiple festivals when invited to two', async ({ browser }) => {
    const org1 = await createOrganiser(`${suffix}-multi1`)
    const org2 = await createOrganiser(`${suffix}-multi2`)
    const reviewer = await createArtist(`${suffix}-multi-rev`)

    const { festivalId: fid1 } = await createFestival(org1.token, {
      name: `Multi Fest 1 ${suffix}`,
      slug: `multi-1-${suffix}`,
    })
    const { festivalId: fid2 } = await createFestival(org2.token, {
      name: `Multi Fest 2 ${suffix}`,
      slug: `multi-2-${suffix}`,
    })
    await inviteReviewer(org1.token, fid1, reviewer.email)
    await inviteReviewer(org2.token, fid2, reviewer.email)

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto('/organiser/reviewing')
      await expect(page.getByText(`Multi Fest 1 ${suffix}`)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(`Multi Fest 2 ${suffix}`)).toBeVisible()
      // Both "Go to applications" links present
      const links = page.getByRole('link', { name: 'Go to applications →' })
      await expect(links).toHaveCount(2)
    } finally {
      await ctx.close()
    }
  })
})
