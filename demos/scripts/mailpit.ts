import type { Page } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

interface MailpitMessage {
  ID: string
  To: Array<{ Address: string; Name: string }>
  Subject: string
}

interface MailpitListResponse {
  messages: MailpitMessage[]
}

interface MailpitMessageDetail {
  HTML: string
  Text: string
}

async function extractVerificationURL(email: string): Promise<string> {
  const deadline = Date.now() + 10_000
  const normalised = email.toLowerCase()

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`)
    if (!res.ok) throw new Error(`Mailpit API error: ${res.status}`)
    const { messages } = (await res.json()) as MailpitListResponse
    const msg = messages?.find((m) =>
      m.To?.some((t) => t.Address?.toLowerCase() === normalised),
    )
    if (msg) {
      const bodyRes = await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)
      const detail = (await bodyRes.json()) as MailpitMessageDetail
      const html = detail.HTML ?? detail.Text ?? ''
      const match = html.match(/href="([^"]*\/verify-email\?[^"]*)"/)
      if (match) return match[1].replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Verification email for ${email} not found in Mailpit within 10s`)
}

/**
 * Opens Mailpit at localhost:8025, waits for the verification email to appear,
 * clicks it so the inbox is visible on screen, then navigates to the verify URL.
 * After this returns, the page will be at /dashboard (auto-logged in).
 */
export async function verifyEmailViaMailpit(page: Page, email: string): Promise<void> {
  await page.goto(MAILPIT)
  await page
    .getByText('Verify your Painttrace account')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByText('Verify your Painttrace account').first().click()
  const verifyUrl = await extractVerificationURL(email)
  await page.goto(verifyUrl)
}
