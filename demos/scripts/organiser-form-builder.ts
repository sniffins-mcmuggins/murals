import { test, expect } from '@playwright/test'
import { pause, highlight, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin, cpfFestivalId, ORGANISER_EMAIL } from './_setup.js'

// The visual application-form builder: add a curated question from the library
// (a media-embed walkthrough/3D field) and save.
test('organiser-form-builder — shape the application form', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page, ORGANISER_EMAIL) // Marcus Webb
  const fid = await cpfFestivalId(page.request)

  await page.goto(`/organiser/festivals/${fid}/form`)
  await expect(page.getByRole('heading', { name: 'Application form' })).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'Organisers shape their own application form — drag, reorder, or pull in ready-made questions.')
  await pause(600)

  await highlight(page, 'button:has-text("Add from library")')
  await page.getByRole('button', { name: 'Add from library' }).click()
  await expect(page.getByTestId('library-panel')).toBeVisible({ timeout: 5000 })
  await pause(900)
  await page.getByTestId('library-panel').getByRole('button', { name: /walkthrough or 3D/i }).first().click()
  await pause(800)

  await highlight(page, 'button:has-text("Save form")')
  await page.getByRole('button', { name: 'Save form' }).click()
  await expect(page.getByText('Saved ✓')).toBeVisible({ timeout: 5000 })
  await pause(2000)
})
