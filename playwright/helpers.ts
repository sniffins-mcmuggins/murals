import { Page, Locator } from '@playwright/test';

export async function pause(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function slowType(locator: Locator, text: string, delayMs = 75): Promise<void> {
  try {
    await locator.click();
    await locator.pressSequentially(text, { delay: delayMs });
  } catch {
    console.warn(`slowType: locator not found or not clickable`);
  }
}

export async function scrollTo(page: Page, selector: string): Promise<void> {
  try {
    await page.locator(selector).scrollIntoViewIfNeeded();
  } catch {
    console.warn(`scrollTo: selector "${selector}" not found`);
  }
  await pause(500);
}

export async function highlight(page: Page, selector: string, durationMs = 900): Promise<void> {
  const found = await page.evaluate(
    ({ sel, dur }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) {
        console.warn(`highlight: selector "${sel}" not found`);
        return false;
      }
      const orig = el.style.outline;
      el.style.outline = '3px solid #E8A838';
      el.style.outlineOffset = '3px';
      setTimeout(() => { el.style.outline = orig; el.style.outlineOffset = ''; }, dur);
      return true;
    },
    { sel: selector, dur: durationMs }
  );
  if (found) await pause(durationMs + 200);
}
