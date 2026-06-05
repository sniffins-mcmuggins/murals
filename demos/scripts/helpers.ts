import type { Locator, Page } from '@playwright/test'

/**
 * Inject a visible amber cursor dot that follows mouse movements in the recording.
 * Call once at the top of every demo script (runs on every page navigation automatically).
 * Playwright's synthetic mouse events fire real DOM mousemove events, so the dot
 * stays in sync with page.mouse.move(), clicks, and drags.
 */
export async function addCursorOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const CURSOR_ID = '__demo_cursor__'
    const inject = () => {
      if (document.getElementById(CURSOR_ID)) return
      const dot = document.createElement('div')
      dot.id = CURSOR_ID
      Object.assign(dot.style, {
        position:      'fixed',
        top:           '-40px',
        left:          '-40px',
        width:         '18px',
        height:        '18px',
        borderRadius:  '50%',
        background:    '#E8A838',
        border:        '2px solid rgba(26,26,46,0.35)',
        boxShadow:     '0 2px 8px rgba(0,0,0,0.30)',
        pointerEvents: 'none',
        zIndex:        '2147483647',
        transform:     'translate(-50%,-50%)',
      })
      document.body.appendChild(dot)
      document.addEventListener('mousemove', (e: MouseEvent) => {
        dot.style.left = e.clientX + 'px'
        dot.style.top  = e.clientY + 'px'
      })
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject)
    } else {
      inject()
    }
  })
}

/** Deliberate pause — use between major sections or after important actions */
export async function pause(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms))
}

/** Type text character-by-character so the viewer can read what's being entered */
export async function slowType(
  locator: Locator,
  text: string,
  delayMs = 45,
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
  const el = page.locator(selector).first()
  await el.evaluate((node) => {
    const prev = (node as HTMLElement).style.outline
    ;(node as HTMLElement).style.outline = '3px solid #f59e0b'
    setTimeout(() => { (node as HTMLElement).style.outline = prev }, 800)
  })
  await pause(900)
}

/** Scroll an element into view before interacting */
export async function scrollTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded()
  await pause(600)
}
