---
name: take-screenshots
description: >
  Take screenshots of the running app for PRs, docs, or visual verification. Use this skill
  whenever the user asks to "screenshot", "take a screenshot", "show me what it looks like",
  "capture the UI", "make a fake account and screenshot", "add screenshots to the PR", "document
  what X looks like", or wants visual evidence of a feature. Also use proactively after
  implementing visible UI changes — offer to take screenshots before creating a PR.
---

# Take Screenshots

Captures real browser screenshots of the running app via Playwright. Handles the worktree→main-repo
mirror, Next.js rebuild wait, test account creation, and authenticated page flows.

## Architecture you must keep in mind

The web container (`infra/docker-compose.yml`) bind-mounts from the **main repo** at
`/Users/adampowis/workspace/murals`, not the current worktree. If you're in a worktree and
have changed frontend files, those changes must be copied to the main repo before the running
app will reflect them.

The stack: API on `localhost:8080`, web on `localhost:3000`.

---

## Step 1 — Verify the stack is up

```bash
docker compose -f infra/docker-compose.yml ps --format "table {{.Name}}\t{{.Status}}"
```

If any service isn't running, tell the user to run `task up` and wait before proceeding. Don't
start the stack yourself — it takes time and the user may have a reason it's down.

Quick health check:
```bash
curl -sf http://localhost:3000 -o /dev/null -w "%{http_code}\n"
```

If this returns 500, check `docker compose -f infra/docker-compose.yml logs web --tail=20` before
proceeding. A 500 at this stage usually means a module error or compile failure.

---

## Step 2 — Mirror worktree files to main repo (if in a worktree)

Detect whether you're in a worktree:
```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
```

If `GIT_DIR != GIT_COMMON`, you're in a worktree. Copy every **staged or committed** web file
that differs from the main repo:

```bash
# For each changed web/src file:
cp <worktree>/web/src/path/to/file.tsx /Users/adampowis/workspace/murals/web/src/path/to/file.tsx
```

After mirroring, restart the web container so Next.js picks up the changes:
```bash
docker compose -f infra/docker-compose.yml restart web
```

Then wait for it to come back up (Next.js dev server typically takes 3–8s to restart):
```bash
# Poll until 200 or timeout after ~20s
for i in $(seq 1 20); do
  STATUS=$(curl -sf http://localhost:3000 -o /dev/null -w "%{http_code}" 2>&1)
  [ "$STATUS" = "200" ] && echo "ready" && break
  sleep 1
done
```

---

## Step 3 — Create a test account (if screenshots need auth)

Use the API directly — no browser signup needed:

```bash
SUFFIX=$(date +%s)
EMAIL="demo-${SUFFIX}@render.test"
PASSWORD="password123"

# Sign up
curl -sf -X POST http://localhost:8080/auth/signup \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" > /dev/null

# Log in — capture token
TOKEN=$(curl -sf -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

echo "EMAIL=$EMAIL PASSWORD=$PASSWORD TOKEN=$TOKEN"
```

If the page needs a full artist profile, create one and seed data via the API before opening
the browser. The API is faster and more reliable than driving the UI for setup.

**API seeding order matters:**
- `POST /profiles` must come before `PATCH /profiles/me` — the PATCH returns 404 if no profile exists yet
- Seed data in this order: signup → login → POST /profiles → PATCH /profiles/me (bio, location, mediumTags, socialLinks)
- For richer screenshots, also create a collection: `POST /collections` — a profile with collections looks much more like a real artist page than a bare name+bio

**What makes a good screenshot:**
A realistic fake account beats a minimal one. Fill in bio, location, medium tags, and at least one collection or social link — whatever is relevant to the feature being shown. Screenshots are often the first thing a reviewer sees; sparse placeholder data makes the feature look unfinished even when it isn't.

---

## Step 4 — Capture screenshots with Playwright

Write an inline Node.js script. Key rules learned from this project:

**Never inject auth via `localStorage`** — Next.js server components run before the client
hydrates, so a token in localStorage won't reach the SSR layer. The page redirects to `/login`
anyway. Always do a real browser login.

**Real login flow:**
```js
await page.goto('http://localhost:3000/login');
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.click('button[type="submit"]');
await page.waitForURL(/profile|dashboard/, { timeout: 10000 });
```

**Full script pattern:**
```js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- Authenticated page ---
  await page.goto('http://localhost:3000/login');
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/profile|dashboard/, { timeout: 10000 });

  await page.goto('http://localhost:3000/profile');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'docs/screenshots/profile-edit.png', fullPage: true });

  // --- Public page (no auth needed) ---
  await page.goto('http://localhost:3000/artists/<profileId>');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'docs/screenshots/artist-public.png', fullPage: false });

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
```

Run with:
```bash
cd /Users/adampowis/workspace/murals && node -e "<script>"
```

Note: `playwright` is available as a project dependency — don't install it separately.

### Screenshot options

- `fullPage: true` — captures the entire scrollable page (good for forms)
- `fullPage: false` — captures only the viewport (good for above-the-fold hero shots)
- `page.setViewportSize({ width: 1280, height: 900 })` — standard desktop viewport
- For mobile: `{ width: 390, height: 844 }` (iPhone 14)

---

## Step 5 — Save screenshots to the right place

Screenshots always go to `docs/screenshots/` in the **main repo**:
```
/Users/adampowis/workspace/murals/docs/screenshots/<feature-name>.png
```

If you're in a worktree and want them committed, copy them back:
```bash
cp /Users/adampowis/workspace/murals/docs/screenshots/*.png \
   <worktree>/docs/screenshots/
```

Then `git add docs/screenshots/` and commit them.

---

## Naming convention

Use descriptive kebab-case names that include the feature and view:
- `social-links-edit-form.png` ✓
- `social-links-public-profile.png` ✓  
- `screenshot1.png` ✗

---

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Page redirects to `/login` | localStorage token injection | Use real browser login (Step 4) |
| `localhost:3000` returns 500 | Module not found or compile error | Check `docker compose logs web --tail=20` |
| Screenshots show old UI | Worktree files not mirrored | Run Step 2 |
| `Cannot find module 'playwright'` | Wrong CWD | Run from `/Users/adampowis/workspace/murals` |
| Login redirects to wrong URL | waitForURL pattern too narrow | Broaden the regex, e.g. `/profile\|dashboard\|/` |
| `PATCH /profiles/me` returns 404 | No profile exists yet | Call `POST /profiles` first to create it |
| Profile page looks sparse | Only name+bio seeded | Add a collection and social links for richer screenshots |
