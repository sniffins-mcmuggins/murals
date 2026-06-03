import type { Page } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

interface MailpitMessage {
  ID: string
  To: Array<{ Address: string; Name: string }>
  Subject: string
}

interface MailpitListResponse {
  messages: MailpitMessage[]
  total: number
}

interface MailpitMessageDetail {
  HTML: string
  Text: string
}

/**
 * Polls the Mailpit REST API until an email arrives for the given address.
 * Extracts and returns the full verification URL from the email body.
 * Times out after 10 seconds.
 */
export async function extractVerificationURL(email: string): Promise<string> {
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

      // Match href containing /verify-email?token=
      const match = html.match(/href="([^"]*\/verify-email\?[^"]*)"/)
      if (match) {
        return match[1].replace(/&amp;/g, '&')
      }
    }

    await new Promise((r) => setTimeout(r, 500))
  }

  throw new Error(`Verification email for ${email} not found in Mailpit within 10s`)
}

/**
 * Navigates the Playwright page to Mailpit's web UI, waits for the
 * verification email to appear, shows it (for demo videos), then navigates
 * the page to the verification URL.
 */
export async function verifyEmailViaMailpit(page: Page, email: string): Promise<void> {
  // Open Mailpit — the inbox is visible on screen (good for demo recording).
  await page.goto(MAILPIT)

  // Wait for the verification email subject line to appear in the message list.
  await page
    .getByText('Verify your Painttrace account')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })

  // Click it so the preview panel shows — the email is visible in the demo.
  await page.getByText('Verify your Painttrace account').first().click()

  // Extract the link via REST API (more reliable than clicking inside iframe).
  const verifyUrl = await extractVerificationURL(email)

  // Navigate to the verify URL — the /verify-email page calls the API,
  // sets the session cookie, and redirects to /dashboard.
  await page.goto(verifyUrl)
}
