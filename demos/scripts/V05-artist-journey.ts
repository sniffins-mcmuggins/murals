import { test, expect } from "@playwright/test";
import { slowType, pause, highlight, scrollTo, addCursorOverlay } from "./helpers.js";
import * as path from "path";
import * as fs from "fs";

const API = process.env.API_URL ?? "http://localhost:8080";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const GABE_BIO =
  "South-West muralist. Bold colour, mythological themes, outdoor work.";
const GABE_INSTAGRAM = "https://instagram.com/ladygabeart";

const GABE_AVATAR = path.join(__dirname, "../fixtures/lady-gabe-portrait.jpg");
const GABE_1 = path.join(__dirname, "../fixtures/lady-gabe-1.jpg");
const GABE_2 = path.join(__dirname, "../fixtures/lady-gabe-2.jpg");
const GABE_3 = path.join(__dirname, "../fixtures/lady-gabe-3.jpg");

test("V05 — Artist Journey", async ({ page }) => {
  // Inject amber cursor dot — visible in the recording on every page.
  await addCursorOverlay(page)

  const suffix = Date.now();
  const email = `gabe-${suffix}@demo.art`;
  const password = "demo-password-2027";

  // ── 1. Sign up with Google ────────────────────────────────────────────────────
  // Intercept the Google OAuth redirect before it leaves the browser.
  // Behind the scenes we create a real account and set the session cookie,
  // so the rest of the demo runs against a live user — the viewer just sees
  // the signup page → click "Continue with Google" → land on dashboard.
  await page.route(`${API}/auth/oauth/google`, async (route) => {
    await page.request.post(`${API}/auth/signup`, {
      data: { email, password },
      headers: { "Content-Type": "application/json" },
    });
    await page.request.post(`${API}/_test/verify-email`, {
      data: { email },
      headers: { "Content-Type": "application/json" },
    });
    const loginRes = await page.request.post(`${API}/auth/login`, {
      data: { email, password },
      headers: { "Content-Type": "application/json" },
    });
    const { token } = await loginRes.json();
    await page.context().addCookies([{
      name: "session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
    await route.fulfill({
      status: 302,
      headers: { Location: `${BASE_URL}/dashboard` },
    });
  });

  await page.goto("/signup");
  await pause(1200);
  await highlight(page, 'a[href*="oauth/google"]');
  await pause(800);
  await page.click('a[href*="oauth/google"]');
  await expect(page).toHaveURL("/dashboard", { timeout: 25000 });
  await pause(1500);

  // ── 3. Build profile ──────────────────────────────────────────────────────────
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await pause(1000);

  for (const f of [GABE_AVATAR, GABE_1, GABE_2, GABE_3]) {
    if (!fs.existsSync(f)) throw new Error(`Fixture not found: ${f}`);
  }

  // Profile picture (avatar — round slot, first file input on this page)
  await page.locator("input[type=file]").nth(0).setInputFiles(GABE_AVATAR);
  await expect(
    page.getByRole("button", { name: "Upload Profile pic" }).locator("img"),
  ).toBeVisible({ timeout: 30000 });
  await pause(600);

  // Headline photo (second file input — Photo 1 slot)
  await page.locator("input[type=file]").nth(1).setInputFiles(GABE_1);
  await expect(
    page.getByRole("button", { name: "Upload Photo 1" }).locator("img"),
  ).toBeVisible({ timeout: 30000 });
  await pause(600);

  await slowType(page.locator('input[name="displayName"]'), "Lady Gabe");
  await pause(400);
  await slowType(page.locator("textarea").first(), GABE_BIO);
  await pause(400);
  await slowType(page.locator('input[aria-label="Instagram"]'), GABE_INSTAGRAM);
  await pause(600);

  await highlight(page, "button[type=submit]");
  await page.getByRole("button", { name: /save profile/i }).click();
  await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 8000 });
  await pause(1200);

  // ── 4. Grant access (behind the scenes — not shown on screen) ─────────────────
  const redeemRes = await page.request.post(`${API}/promo/redeem`, {
    data: { code: "DEMO2027" },
    headers: { "Content-Type": "application/json" },
  });
  if (!redeemRes.ok()) throw new Error(`Promo redeem: ${redeemRes.status()}`);
  await pause(600);

  // ── 5. Build portfolio collection ─────────────────────────────────────────────
  await page.goto("/collections");
  await expect(
    page.getByRole("heading", { name: /collections/i }),
  ).toBeVisible();
  await pause(800);

  await page.getByRole("button", { name: /new collection/i }).click();
  await pause(400);
  await slowType(
    page.locator('input[placeholder*="Name" i], input[name="name"]').first(),
    "Murals 2027",
  );
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Murals 2027")).toBeVisible({ timeout: 6000 });
  await pause(600);

  await page.getByText("Murals 2027").click();
  await expect(
    page.getByRole("heading", { name: "Murals 2027" }),
  ).toBeVisible();
  await pause(800);

  await page.locator("input[type=file]").setInputFiles(GABE_2);
  await expect(page.locator("img").first()).toBeVisible({ timeout: 30000 });
  await pause(800);
  await page.locator("input[type=file]").setInputFiles(GABE_3);
  await expect(page.locator("img").nth(1)).toBeVisible({ timeout: 30000 });
  await pause(1000);

  // Set the first image as the collection cover (off-screen — no UI for this yet).
  // Without this the collection card on the public profile shows no thumbnail.
  {
    const collectionId = page.url().split("/").at(-1)!;
    const cookies = await page.context().cookies();
    const token = cookies.find((c) => c.name === "session")?.value ?? "";
    const imagesRes = await page.request.get(
      `${API}/collections/${collectionId}/images`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const images: Array<{ s3_key: string }> = await imagesRes.json();
    if (images.length > 0) {
      await page.request.patch(`${API}/collections/${collectionId}`, {
        data: { coverS3Key: images[0].s3_key },
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      await page.reload();
      // Wait for the cover thumbnail to appear in the UI
      await expect(page.locator('img[alt="Cover"]')).toBeVisible({ timeout: 10000 });
      await pause(1000);
    }
  }
  await pause(600);

  // ── 6. Publish profile ────────────────────────────────────────────────────────
  await page.goto("/profile");
  await expect(page.locator('[data-testid="publish-bar"]')).toBeVisible({
    timeout: 8000,
  });
  await pause(1000);
  await highlight(page, '[data-testid="publish-bar"] button');
  await page
    .locator('[data-testid="publish-bar"]')
    .getByRole("button", { name: /go public|publish/i })
    .click();
  await pause(1200);
  await expect(page.locator('[data-testid="visibility-badge"]')).toContainText(
    /public/i,
    { timeout: 8000 },
  );
  await pause(1000);

  // ── 7. View public artist page ────────────────────────────────────────────────
  const profileRes = await page.request.get(`${API}/profiles/me`);
  const { id: profileId } = await profileRes.json();
  await page.goto(`/artists/${profileId}`);
  await pause(2000);
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "smooth" }));
  await pause(1500);
  await page.evaluate(() => window.scrollTo({ top: 1400, behavior: "smooth" }));
  await pause(2000);

  // ── 8. Apply to CPF 2027 — still in the same session ─────────────────────────
  await page.goto("/applications");
  await expect(
    page.getByRole("heading", { name: "Applications", exact: true }),
  ).toBeVisible({ timeout: 8000 });
  await pause(1200);

  const openSection = page
    .locator("section")
    .filter({ hasText: "Open festivals" });
  await expect(
    openSection.getByText("Cheltenham Paint Festival 2027").first(),
  ).toBeVisible({ timeout: 8000 });
  await pause(800);
  await highlight(page, 'a[href*="apply"]');

  const festivalItem = openSection
    .locator("li")
    .filter({ hasText: "Cheltenham Paint Festival 2027" })
    .first();
  await festivalItem.getByRole("link", { name: "Apply" }).click();
  await pause(1200);

  // ── 9. Fill the application form ─────────────────────────────────────────────
  await expect(
    page.getByRole("heading", { name: /apply|application/i }),
  ).toBeVisible({ timeout: 8000 });
  await pause(1000);

  await scrollTo(page, 'textarea[name="f1"]');
  await slowType(
    page.locator('textarea[name="f1"]'),
    "A large-scale triptych exploring the mythology of the River Chelt — its source, journey, and meeting with the Severn. Water, memory, and time rendered in bold colour across three connected walls.",
  );
  await pause(600);

  await page.selectOption('select[name="f2"]', "Large (20m²+)");
  await pause(400);
  await page.selectOption('select[name="f3"]', "Spray paint");
  await pause(400);

  await scrollTo(page, 'textarea[name="f4"]');
  await slowType(
    page.locator('textarea[name="f4"]'),
    "https://ladygabe.com/portfolio\nhttps://instagram.com/ladygabeart\nhttps://vimeo.com/ladygabe",
  );
  await pause(600);

  await page.selectOption('select[name="f5"]', "Yes");
  await pause(400);
  await page.selectOption('select[name="f6"]', "Full period");
  await pause(400);
  await page.selectOption('select[name="f7"]', "Yes");
  await pause(400);

  await scrollTo(page, "button[type=submit]");
  await pause(800);

  // ── 10. Submit ────────────────────────────────────────────────────────────────
  await highlight(page, "button[type=submit]");
  await page.click("button[type=submit]");
  await pause(1200);

  // ── 11. Confirmation ──────────────────────────────────────────────────────────
  await expect(
    page.getByRole("heading", { name: "Application submitted" }),
  ).toBeVisible({ timeout: 10000 });
  await pause(3000);
});
