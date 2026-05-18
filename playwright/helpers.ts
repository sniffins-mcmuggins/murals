import { Page, Locator } from '@playwright/test';

export async function pause(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function slowType(locator: Locator, text: string, delayMs = 75): Promise<void> {
  await locator.click();
  await locator.pressSequentially(text, { delay: delayMs });
}

export async function scrollTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await pause(500);
}

export async function highlight(page: Page, selector: string, durationMs = 900): Promise<void> {
  await page.evaluate(
    ({ sel, dur }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return;
      const orig = el.style.outline;
      el.style.outline = '3px solid #E8A838';
      el.style.outlineOffset = '3px';
      setTimeout(() => { el.style.outline = orig; el.style.outlineOffset = ''; }, dur);
    },
    { sel: selector, dur: durationMs }
  );
  await pause(durationMs + 200);
}
