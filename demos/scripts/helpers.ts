import type { Locator, Page } from '@playwright/test'

/** Deliberate pause — use between major sections or after important actions */
export async function pause(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms))
}

/** Type text character-by-character so the viewer can read what's being entered */
export async function slowType(
  locator: Locator,
  text: string,
  delayMs = 80,
): Promise<void> {
  await locator.click()
  await locator.fill('')
  for (const char of text) {
    await locator.type(char)
    await pause(delayMs)
  }
}

/** Briefly highlight an element with an amber outline before interacting with it */
export async function highlight(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return
    const prev = (el as HTMLElement).style.outline
    ;(el as HTMLElement).style.outline = '3px solid #f59e0b'
    setTimeout(() => { (el as HTMLElement).style.outline = prev }, 800)
  }, selector)
  await pause(900)
}

/** Smooth-scroll an element into view before interacting */
export async function scrollTo(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, selector)
  await pause(600)
}
