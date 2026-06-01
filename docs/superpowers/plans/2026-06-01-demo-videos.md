# Demo Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, automated demo video suite — four MP4s of the real running platform recorded by Playwright scripts against the live Docker Compose stack.

**Architecture:** A standalone `demos/` directory with its own Playwright config and Go seed script. The seed populates the dev DB with demo personas (admin, organiser, 12 fictional artists, Lady Gabe) and a CPF 2027 festival with applications. Four Playwright scripts drive the browser to record each video, then ffmpeg converts `.webm` to MP4.

**Tech Stack:** Playwright (TypeScript), Go + pgx/v5 + bcrypt for seed, ffmpeg for conversion, Taskfile for orchestration.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `demos/.gitignore` | Create | Ignore `output/` |
| `demos/package.json` | Create | Playwright dependency, standalone from `web/` |
| `demos/playwright.config.ts` | Create | Demo-specific config: slowMo, video:on, headless:false |
| `demos/run.sh` | Create | ffmpeg conversion: webm → mp4 for all output files |
| `demos/scripts/helpers.ts` | Create | `slowType`, `pause`, `highlight`, `scrollTo` |
| `demos/scripts/V01-organiser-setup.ts` | Create | Organiser signs up, creates festival, publishes |
| `demos/scripts/V02-organiser-review.ts` | Create | Organiser reviews inbox, accepts, declines, views map |
| `demos/scripts/V03-artist-signup.ts` | Create | Artist signs up, builds profile, uploads image, publishes |
| `demos/scripts/V04-artist-apply.ts` | Create | Lady Gabe logs in, applies to CPF 2027 |
| `demos/seed/go.mod` | Create | Minimal Go module for the seed script |
| `demos/seed/main.go` | Create | Idempotent seed: wipe + reinsert all demo data |
| `Taskfile.yml` | Modify | Add `demo:seed`, `demo:record`, `demo:all` tasks |

---

## Task 1: Bootstrap `demos/` directory

**Files:**
- Create: `demos/.gitignore`
- Create: `demos/package.json`
- Create: `demos/playwright.config.ts`

- [ ] **Step 1: Create `.gitignore`**

```
output/
node_modules/
```

Save to `demos/.gitignore`.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "demos",
  "private": true,
  "scripts": {
    "record": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.44.0",
    "@types/node": "^20.0.0"
  }
}
```

Save to `demos/package.json`.

- [ ] **Step 3: Create `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  testMatch: '**/*.ts',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    headless: false,
    slowMo: 60,
    video: 'on',
    viewport: { width: 1280, height: 800 },
  },
  outputDir: './output/raw',
})
```

Save to `demos/playwright.config.ts`.

- [ ] **Step 4: Install Playwright**

```bash
cd demos && npm install && npx playwright install chromium
```

Expected: `node_modules/` created, chromium browser downloaded.

- [ ] **Step 5: Commit**

```bash
git add demos/.gitignore demos/package.json demos/playwright.config.ts
git commit -m "chore(demos): bootstrap Playwright config"
```

---

## Task 2: Shared Playwright helpers

**Files:**
- Create: `demos/scripts/helpers.ts`

- [ ] **Step 1: Create `helpers.ts`**

```typescript
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
```

Save to `demos/scripts/helpers.ts`.

- [ ] **Step 2: Commit**

```bash
git add demos/scripts/helpers.ts
git commit -m "chore(demos): shared Playwright helpers"
```

---

## Task 3: Demo seed script

**Files:**
- Create: `demos/seed/go.mod`
- Create: `demos/seed/main.go`

The seed is idempotent: it deletes all demo rows by email, then re-inserts everything fresh.
Uses bcrypt cost 12 (matching the API) and pgx/v5 (already used by the API so go.sum entries
are familiar territory).

- [ ] **Step 1: Create `demos/seed/go.mod`**

```
module github.com/sniffins-mcmuggins/render/demos/seed

go 1.22

require (
	github.com/jackc/pgx/v5 v5.5.5
	golang.org/x/crypto v0.22.0
)
```

Run `cd demos/seed && go mod tidy` to generate `go.sum`.

- [ ] **Step 2: Create `demos/seed/main.go`**

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	demoPassword  = "demo-password-2027"
	adminEmail    = "admin@demo.art"
	marcusEmail   = "marcus@cpf-demo.art"
	ladyGabeEmail = "ladygabe@demo.art"
)

// cpfFields is the application form field list for CPF 2027.
// The "id" values are the keys the API validates answers against.
var cpfFields = []map[string]any{
	{"id": "f1", "type": "textarea", "label": "Describe your proposed mural concept", "required": true},
	{"id": "f2", "type": "select", "label": "Preferred wall size", "options": []string{"Small (up to 4m²)", "Medium (4–20m²)", "Large (20m²+)"}, "required": true},
	{"id": "f3", "type": "select", "label": "Primary medium", "options": []string{"Spray paint", "Brush", "Mixed media", "Roller"}, "required": true},
	{"id": "f4", "type": "textarea", "label": "Portfolio links (up to 3 URLs)", "required": true},
	{"id": "f5", "type": "select", "label": "Do you have public liability insurance?", "options": []string{"Yes", "No", "In progress"}, "required": true},
	{"id": "f6", "type": "select", "label": "Full festival availability (10–17 October)?", "options": []string{"Full period", "Partial — specify below"}, "required": true},
	{"id": "f7", "type": "select", "label": "Previous outdoor mural experience", "options": []string{"Yes", "No"}, "required": false},
	{"id": "f8", "type": "textarea", "label": "Anything else you'd like to tell us?", "required": false},
}

type fictionalArtist struct {
	name    string
	email   string
	bio     string
	medium  string
	concept string
	size    string
	status  string  // "submitted", "accepted", "declined", "waitlisted"
	pinLat  float64 // only for accepted artists
	pinLng  float64
}

// artistSeed defines the 12 fictional artists seeded for V02.
// Cheltenham centre is approx 51.9007, -2.0776. Pins are scattered around it.
var artistSeed = []fictionalArtist{
	// Pending — shown in the review inbox for V02
	{"Kit Harrow", "kit@demo-artist.art", "Urban wildlife muralist based in Bristol.", "Spray paint",
		"A series of endangered British species rendered life-size across three panels.", "Large (20m²+)", "submitted", 0, 0},
	{"Tomás Cruz", "tomas@demo-artist.art", "Geometric abstraction in public spaces.", "Mixed media",
		"Fractured geometry reflecting Cheltenham's Regency architecture.", "Medium (4–20m²)", "submitted", 0, 0},
	{"Yuki Tanaka", "yuki@demo-artist.art", "Nature and landscape, Japanese-influenced style.", "Brush",
		"Cherry blossom and oak — a conversation between Japanese and British flora.", "Small (up to 4m²)", "submitted", 0, 0},
	{"Amara Diallo", "amara@demo-artist.art", "Celebrating West African cultural heritage through colour.", "Spray paint",
		"Kente patterns adapted for a Cheltenham townhouse gable end.", "Large (20m²+)", "submitted", 0, 0},
	{"Rosa Vane", "rosa@demo-artist.art", "Community portraiture and local history.", "Brush",
		"Portraits of five unsung figures from Cheltenham's history.", "Medium (4–20m²)", "submitted", 0, 0},
	// Accepted — already pinned to the festival map
	{"Zara Osei", "zara@demo-artist.art", "Colour-field murals celebrating joyful public space.", "Roller",
		"Bold colour blocks celebrating Cheltenham's multicultural community.", "Large (20m²+)", "accepted", 51.9012, -2.0743},
	{"Finn Marlowe", "finn@demo-artist.art", "Typographic murals and text-based public art.", "Spray paint",
		"Poetry lines from Cheltenham Literature Festival past laureates.", "Medium (4–20m²)", "accepted", 51.9001, -2.0801},
	{"Priya Nair", "priya@demo-artist.art", "Botanical illustration at architectural scale.", "Brush",
		"Medicinal plants from Cheltenham's Victorian apothecary tradition.", "Medium (4–20m²)", "accepted", 51.8998, -2.0768},
	{"Cas Rivera", "cas@demo-artist.art", "Afrofuturist imagery and speculative worlds.", "Mixed media",
		"A portal — what Cheltenham looks like in 2127.", "Large (20m²+)", "accepted", 51.9021, -2.0712},
	// Declined
	{"Olly Webb", "olly@demo-artist.art", "Street art and paste-up.", "Spray paint",
		"Hyperrealist portrait series.", "Small (up to 4m²)", "declined", 0, 0},
	{"Jess Kamau", "jess@demo-artist.art", "Landscape and environmental themes.", "Brush",
		"Severn river ecosystem from source to estuary.", "Medium (4–20m²)", "declined", 0, 0},
	{"Bex Thornton", "bex@demo-artist.art", "Abstract expressionism in outdoor spaces.", "Roller",
		"Storm patterns in ink wash at building scale.", "Large (20m²+)", "declined", 0, 0},
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://render:render@localhost:5432/render?sslmode=disable"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	hash, err := bcrypt.GenerateFromPassword([]byte(demoPassword), 12)
	if err != nil {
		log.Fatalf("bcrypt: %v", err)
	}
	pwHash := string(hash)

	// Collect all demo emails for the delete pass
	demoEmails := []string{adminEmail, marcusEmail, ladyGabeEmail}
	for _, a := range artistSeed {
		demoEmails = append(demoEmails, a.email)
	}

	// Cascade deletes handle all child rows (profiles, festivals, applications, grants)
	if _, err := conn.Exec(ctx,
		`DELETE FROM users WHERE email = ANY($1::text[])`, demoEmails,
	); err != nil {
		log.Fatalf("delete demo users: %v", err)
	}
	fmt.Println("Cleared existing demo rows")

	// Admin
	var adminID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, role, is_beta)
		 VALUES ($1, $2, 'admin', true) RETURNING id`,
		adminEmail, pwHash).Scan(&adminID); err != nil {
		log.Fatalf("insert admin: %v", err)
	}
	fmt.Printf("  admin:     %s\n", adminEmail)

	// Marcus Webb — demo organiser
	var marcusID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, role, is_beta)
		 VALUES ($1, $2, 'organiser', true) RETURNING id`,
		marcusEmail, pwHash).Scan(&marcusID); err != nil {
		log.Fatalf("insert marcus: %v", err)
	}
	fmt.Printf("  organiser: %s\n", marcusEmail)

	// Lady Gabe — demo artist, profile already public (for V04)
	var gabeUserID, gabeProfileID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, role, is_beta)
		 VALUES ($1, $2, 'artist', true) RETURNING id`,
		ladyGabeEmail, pwHash).Scan(&gabeUserID); err != nil {
		log.Fatalf("insert ladygabe user: %v", err)
	}
	if err := conn.QueryRow(ctx,
		`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility)
		 VALUES ($1, 'Lady Gabe',
		   'South-West based muralist. Bold colour, mythological themes, outdoor work across the UK.',
		   '{"instagram":"https://instagram.com/ladygabeart","website":"https://ladygabe.com"}',
		   'public') RETURNING id`,
		gabeUserID).Scan(&gabeProfileID); err != nil {
		log.Fatalf("insert ladygabe profile: %v", err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO access_grants (user_id, plan, valid_until, granted_by, note)
		 VALUES ($1, 'artist_basic', now() + interval '2 years', $2, 'Demo account')`,
		gabeUserID, adminID); err != nil {
		log.Fatalf("insert ladygabe grant: %v", err)
	}
	fmt.Printf("  artist:    %s (profile public)\n", ladyGabeEmail)

	// Fictional artists
	type seededArtist struct {
		profileID string
		a         fictionalArtist
	}
	var seeded []seededArtist
	for _, a := range artistSeed {
		var uid, pid string
		if err := conn.QueryRow(ctx,
			`INSERT INTO users (email, password_hash, role, is_beta)
			 VALUES ($1, $2, 'artist', true) RETURNING id`,
			a.email, pwHash).Scan(&uid); err != nil {
			log.Fatalf("insert fictional artist %s: %v", a.email, err)
		}
		handle := a.email[:strings.Index(a.email, "@")]
		socialJSON := fmt.Sprintf(`{"instagram":"https://instagram.com/%s"}`, handle)
		if err := conn.QueryRow(ctx,
			`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility)
			 VALUES ($1, $2, $3, $4, 'public') RETURNING id`,
			uid, a.name, a.bio, socialJSON).Scan(&pid); err != nil {
			log.Fatalf("insert fictional profile %s: %v", a.name, err)
		}
		seeded = append(seeded, seededArtist{pid, a})
	}
	fmt.Printf("  fictional artists: %d\n", len(seeded))

	// CPF 2027 festival
	var festivalID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO festivals
		   (organiser_id, name, slug, description, location_label, start_date, end_date, status)
		 VALUES ($1, 'Cheltenham Paint Festival 2027', 'cpf-2027',
		   'The UK''s premier paint festival returns for 2027. Eight days of live mural creation across the town centre.',
		   'Cheltenham, UK', '2027-10-10', '2027-10-17', 'open')
		 RETURNING id`,
		marcusID).Scan(&festivalID); err != nil {
		log.Fatalf("insert festival: %v", err)
	}
	fmt.Printf("  festival:  cpf-2027 (%s)\n", festivalID)

	// Application form
	fieldsJSON, _ := json.Marshal(cpfFields)
	var formID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO application_forms (festival_id, fields, open_at)
		 VALUES ($1, $2, now()) RETURNING id`,
		festivalID, string(fieldsJSON)).Scan(&formID); err != nil {
		log.Fatalf("insert form: %v", err)
	}

	// Applications for each fictional artist
	for _, s := range seeded {
		answers, _ := json.Marshal(map[string]string{
			"f1": s.a.concept,
			"f2": s.a.size,
			"f3": s.a.medium,
			"f4": "https://portfolio.example/" + s.a.email[:5],
			"f5": "Yes",
			"f6": "Full period",
			"f7": "Yes",
			"f8": "",
		})
		if _, err := conn.Exec(ctx,
			`INSERT INTO applications (form_id, artist_id, status, answers)
			 VALUES ($1, $2, $3, $4)`,
			formID, s.profileID, s.a.status, string(answers)); err != nil {
			log.Fatalf("insert application %s: %v", s.a.name, err)
		}
		// Pin accepted artists to the festival map
		if s.a.status == "accepted" {
			if _, err := conn.Exec(ctx,
				`INSERT INTO festival_artists (festival_id, artist_id, status, pin_lat, pin_lng)
				 VALUES ($1, $2, 'accepted', $3, $4)`,
				festivalID, s.profileID, s.a.pinLat, s.a.pinLng); err != nil {
				log.Fatalf("insert festival_artist %s: %v", s.a.name, err)
			}
		}
	}
	fmt.Printf("  applications: %d\n", len(seeded))
	fmt.Println("Demo seed complete ✓")
}
```

Save to `demos/seed/main.go`.

- [ ] **Step 3: Run `go mod tidy` to generate `go.sum`**

```bash
cd demos/seed && go mod tidy
```

Expected: `go.sum` created, no errors.

- [ ] **Step 4: Verify the seed compiles**

```bash
cd demos/seed && go build .
```

Expected: no output (clean compile). Delete the binary: `rm -f seed`.

- [ ] **Step 5: Commit**

```bash
git add demos/seed/
git commit -m "chore(demos): Go seed script — 12 artists, CPF 2027 festival, applications"
```

---

## Task 4: Taskfile demo tasks

**Files:**
- Modify: `Taskfile.yml`

- [ ] **Step 1: Add demo tasks to `Taskfile.yml`**

Add these tasks after the `billing:stripe-listen` task:

```yaml
  demo:seed:
    desc: "Wipe and re-seed the demo database (idempotent)"
    dir: demos/seed
    cmd: go run .

  demo:record:
    desc: "Record one demo video. Usage: task demo:record V=V02"
    dir: demos
    cmd: npx playwright test scripts/{{.V}}*.ts --config playwright.config.ts

  demo:convert:
    desc: "Convert all recorded .webm files to MP4 (requires ffmpeg)"
    dir: demos
    cmd: bash run.sh

  demo:all:
    desc: "Seed DB then record all four videos in sequence"
    cmds:
      - task: demo:seed
      - task: demo:record
        vars: { V: V01 }
      - task: demo:record
        vars: { V: V02 }
      - task: demo:record
        vars: { V: V03 }
      - task: demo:record
        vars: { V: V04 }
      - task: demo:convert
```

- [ ] **Step 2: Verify Taskfile parses**

```bash
task --list | grep demo
```

Expected output includes `demo:seed`, `demo:record`, `demo:convert`, `demo:all`.

- [ ] **Step 3: Commit**

```bash
git add Taskfile.yml
git commit -m "chore(demos): add demo:seed / demo:record / demo:all Taskfile tasks"
```

---

## Task 5: V01 — Organiser Setup script

**Files:**
- Create: `demos/scripts/V01-organiser-setup.ts`

Signs up as a fresh organiser, creates CPF 2027, sets up the application form via API,
and publishes the festival. Uses a timestamp-based email so re-recording always works.

- [ ] **Step 1: Create the script**

```typescript
import { test, expect } from '@playwright/test'
import { slowType, pause, highlight } from './helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

test('V01 — Organiser Setup', async ({ page }) => {
  const suffix = Date.now()
  const email = `marcus-demo-${suffix}@cpf-demo.art`
  const password = 'demo-password-2027'

  // ── 1. Sign up ───────────────────────────────────────────────────────────────
  await page.goto('/signup')
  await pause(1200)
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await page.selectOption('#role', 'organiser')
  await pause(800)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  await pause(600)

  // ── 2. Log in ─────────────────────────────────────────────────────────────────
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 3. Navigate to festivals list ─────────────────────────────────────────────
  await page.goto('/organiser/festivals')
  await expect(page.getByRole('heading', { name: 'Festivals' })).toBeVisible()
  await pause(1200)

  // ── 4. Create festival ────────────────────────────────────────────────────────
  await highlight(page, '[role=button]')
  await page.getByRole('button', { name: 'New festival' }).click()
  await pause(600)

  await slowType(page.locator('input[placeholder*="Name"], input[name="name"], #name'), 'Cheltenham Paint Festival 2027')
  await pause(400)
  await slowType(page.locator('input[placeholder*="Slug"], input[name="slug"], #slug'), 'cpf-2027-v01')
  await pause(400)
  await slowType(
    page.locator('textarea[placeholder*="Description"], textarea[name="description"], #description'),
    'Eight days of live mural creation across the town centre. Join us for CPF 2027.',
  )
  await pause(400)
  await slowType(page.locator('input[placeholder*="Location"], #location, input[name="location_label"]'), 'Cheltenham, UK')
  await pause(600)

  await highlight(page, 'button[type=submit]')
  await page.getByRole('button', { name: 'Create' }).click()
  await pause(1500)

  // ── 5. Get festival ID from the URL and set up the application form via API ───
  // The form setup is not shown on screen — the API call happens while the festival
  // detail page is visible, giving the impression that the form is ready to go.
  const url = page.url()
  const festivalId = url.split('/').at(-1)!

  const formRes = await page.request.put(`${API}/festivals/${festivalId}/form`, {
    data: {
      fields: [
        { id: 'f1', type: 'textarea', label: 'Describe your proposed mural concept', required: true },
        { id: 'f2', type: 'select', label: 'Preferred wall size', options: ['Small (up to 4m²)', 'Medium (4–20m²)', 'Large (20m²+)'], required: true },
        { id: 'f3', type: 'select', label: 'Primary medium', options: ['Spray paint', 'Brush', 'Mixed media', 'Roller'], required: true },
        { id: 'f4', type: 'textarea', label: 'Portfolio links (up to 3 URLs)', required: true },
        { id: 'f5', type: 'select', label: 'Do you have public liability insurance?', options: ['Yes', 'No', 'In progress'], required: true },
        { id: 'f6', type: 'select', label: 'Full festival availability (10–17 October)?', options: ['Full period', 'Partial — specify below'], required: true },
        { id: 'f7', type: 'select', label: 'Previous outdoor mural experience', options: ['Yes', 'No'], required: false },
        { id: 'f8', type: 'textarea', label: 'Anything else you'd like to tell us?', required: false },
      ],
    },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!formRes.ok()) throw new Error(`Form setup failed: ${formRes.status()}`)
  await page.reload()
  await pause(1500)

  // ── 6. Publish the festival ───────────────────────────────────────────────────
  await highlight(page, 'button')
  await page.getByRole('button', { name: 'Publish' }).click()
  await pause(1000)
  await expect(page.getByText('open')).toBeVisible({ timeout: 8000 })
  await pause(2000)
})
```

Save to `demos/scripts/V01-organiser-setup.ts`.

- [ ] **Step 2: Smoke-run the script (stack must be up)**

```bash
task demo:record V=V01
```

Expected: Chromium opens, actions play out, test passes, `.webm` appears in `demos/output/raw/`.

If the festival detail page URL structure differs from `/organiser/festivals/{id}`, adjust the
`url.split('/').at(-1)` extraction accordingly.

If the "Publish" button selector doesn't match, inspect with `npx playwright test V01 --headed --debug`.

- [ ] **Step 3: Commit**

```bash
git add demos/scripts/V01-organiser-setup.ts
git commit -m "feat(demos): V01 organiser setup script"
```

---

## Task 6: V02 — Organiser Review script

**Files:**
- Create: `demos/scripts/V02-organiser-review.ts`

Logs in as the pre-seeded Marcus Webb. Reviews two applications from the pending inbox —
accepts Kit Harrow, declines Tomás Cruz — then navigates to the map to see Kit's pin appear.

Requires `task demo:seed` to have been run first.

- [ ] **Step 1: Create the script**

```typescript
import { test, expect } from '@playwright/test'
import { pause, highlight, scrollTo } from './helpers.js'

test('V02 — Organiser Review', async ({ page }) => {
  // ── 1. Log in as Marcus ───────────────────────────────────────────────────────
  await page.goto('/login')
  await pause(800)
  await page.fill('#email', 'marcus@cpf-demo.art')
  await page.fill('#password', 'demo-password-2027')
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 2. Navigate to CPF 2027 ───────────────────────────────────────────────────
  await page.goto('/organiser/festivals')
  await expect(page.getByText('Cheltenham Paint Festival 2027')).toBeVisible({ timeout: 8000 })
  await pause(800)
  await page.getByText('Cheltenham Paint Festival 2027').click()
  await pause(1200)

  // ── 3. Open the applications tab ─────────────────────────────────────────────
  // Get the festival ID from the URL
  const festivalId = page.url().split('/').at(-1)!
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await expect(page.getByRole('tab', { name: 'Pending' })).toBeVisible({ timeout: 8000 })
  await pause(1500)

  // ── 4. Click the first pending application (Kit Harrow) ──────────────────────
  // The Pending tab shows applications with status='submitted' and shortlisted=false
  await page.getByRole('tab', { name: 'Pending' }).click()
  await pause(600)
  // Click the first application card
  await page.locator('[data-testid="application-card"]').first().click()
  await pause(1200)

  // ── 5. Review Kit's application — scroll through ──────────────────────────────
  await scrollTo(page, '[data-testid="application-slide-over"], [role="dialog"]')
  await pause(2000) // viewer reads the content

  // ── 6. Accept Kit ────────────────────────────────────────────────────────────
  await highlight(page, '[data-testid="accept-button"], button:has-text("Accept")')
  await page.getByRole('button', { name: /accept/i }).click()
  await pause(1500)
  // Close the slide-over / confirmation
  await page.keyboard.press('Escape')
  await pause(800)

  // ── 7. Navigate to the festival map ──────────────────────────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/map`)
  await pause(2000) // map loads and Kit's pin is visible
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 10000 })
  await pause(2500)

  // ── 8. Back to applications — open Tomás Cruz ────────────────────────────────
  await page.goto(`/organiser/festivals/${festivalId}/applications`)
  await page.getByRole('tab', { name: 'Pending' }).click()
  await pause(600)
  // Click the second application card (Tomás Cruz)
  await page.locator('[data-testid="application-card"]').nth(1).click()
  await pause(1200)
  await scrollTo(page, '[data-testid="application-slide-over"], [role="dialog"]')
  await pause(1500)

  // ── 9. Decline Tomás ─────────────────────────────────────────────────────────
  await highlight(page, '[data-testid="decline-button"], button:has-text("Decline")')
  await page.getByRole('button', { name: /decline/i }).click()
  await pause(1000)
  // If there's a confirmation modal or message field, handle it
  const confirmBtn = page.getByRole('button', { name: /confirm|yes/i })
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click()
  }
  await pause(1500)
  await page.keyboard.press('Escape')
  await pause(2000) // end on the inbox with updated counts
})
```

Save to `demos/scripts/V02-organiser-review.ts`.

**Note:** The selectors `[data-testid="application-card"]`, `[data-testid="accept-button"]`,
`[data-testid="decline-button"]`, and `[data-testid="application-slide-over"]` may not match
the actual component. Run with `--headed --debug` and inspect the real DOM to fix selectors.
The `ApplicationCard` and `ApplicationSlideOver` components in
`web/src/components/ApplicationCard.tsx` and `ApplicationSlideOver.tsx` are the source of truth.

- [ ] **Step 2: Read actual component selectors**

```bash
grep -r "data-testid" /Users/adampowis/workspace/murals/web/src/components/ApplicationCard.tsx \
  /Users/adampowis/workspace/murals/web/src/components/ApplicationSlideOver.tsx 2>/dev/null | head -20
```

Update the script's `data-testid` selectors to match what the components actually render.
If no `data-testid` attrs exist, use `getByRole` or `getByText` as fallbacks (see Playwright
strict-mode section in `e2e-debugging.md`).

- [ ] **Step 3: Smoke-run (seed must be up-to-date)**

```bash
task demo:seed && task demo:record V=V02
```

Expected: Marcus logs in, applications visible, one acceptance, one decline, map shows pins.

- [ ] **Step 4: Commit**

```bash
git add demos/scripts/V02-organiser-review.ts
git commit -m "feat(demos): V02 organiser review script"
```

---

## Task 7: V03 — Artist Signup script

**Files:**
- Create: `demos/scripts/V03-artist-signup.ts`

Signs up as a fresh artist using Lady Gabe's content (but a fresh email so it never conflicts
with the pre-seeded account). After saving the profile, grants access programmatically via the
admin API so the "Go Public" button works without Stripe.

- [ ] **Step 1: Create the script**

```typescript
import { test, expect } from '@playwright/test'
import { slowType, pause, highlight } from './helpers.js'
import * as path from 'path'
import * as fs from 'fs'

const API = process.env.API_URL ?? 'http://localhost:8080'

// Lady Gabe's real content — mirrored from ladygabe.com for the signup demo
const GABE_BIO =
  'South-West based muralist. Bold colour, mythological themes, outdoor work across the UK. ' +
  'Available for festivals, commissions, and residencies.'
const GABE_INSTAGRAM = 'https://instagram.com/ladygabeart'
const GABE_WEBSITE = 'https://ladygabe.com'

// Fixture image: a small JPEG used for the portfolio upload step.
// Place any JPEG at demos/fixtures/demo-artwork.jpg — it doesn't need to be Lady Gabe's work,
// it just needs to upload successfully. Reuse the e2e fixture if convenient:
const FIXTURE_JPG = path.join(__dirname, '../../e2e/fixtures/test.jpg')

test('V03 — Artist Signup', async ({ page }) => {
  const suffix = Date.now()
  const email = `gabe-signup-${suffix}@demo.art`
  const password = 'demo-password-2027'

  // ── 1. Sign up ───────────────────────────────────────────────────────────────
  await page.goto('/signup')
  await pause(1200)
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  // Role defaults to 'artist' — no change needed
  await pause(800)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  await pause(600)

  // ── 2. Log in ─────────────────────────────────────────────────────────────────
  await slowType(page.locator('#email'), email)
  await slowType(page.locator('#password'), password)
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 3. Navigate to profile and fill in details ────────────────────────────────
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible()
  await pause(1000)

  await slowType(
    page.locator('input[name="displayName"], #displayName, input[placeholder*="display name" i]'),
    'Lady Gabe',
  )
  await pause(400)
  await slowType(page.locator('textarea[name="bio"], #bio, textarea'), GABE_BIO)
  await pause(400)
  await slowType(
    page.locator('input[name="instagram"], input[placeholder*="instagram" i]'),
    GABE_INSTAGRAM,
  )
  await pause(400)
  await slowType(
    page.locator('input[name="website"], input[placeholder*="website" i]'),
    GABE_WEBSITE,
  )
  await pause(600)

  // Save profile
  await highlight(page, 'button[type=submit], button:has-text("Save")')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 8000 })
  await pause(1200)

  // ── 4. Grant access so "Go Public" doesn't hit the billing gate ───────────────
  // This happens behind the scenes (not on screen). The viewer sees the profile page.
  const profileRes = await page.request.get(`${API}/profiles/me`)
  if (!profileRes.ok()) throw new Error(`GET /profiles/me failed: ${profileRes.status()}`)
  const profile = await profileRes.json()
  const artistUserId: string = profile.user_id

  // Log in as admin to get an admin token
  const adminLoginRes = await page.request.post(`${API}/auth/login`, {
    data: { email: 'admin@demo.art', password: 'demo-password-2027' },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!adminLoginRes.ok()) throw new Error(`Admin login failed: ${adminLoginRes.status()}`)
  const { token: adminToken } = await adminLoginRes.json()

  // Grant artist_basic access for 2 years
  const grantRes = await page.request.post(`${API}/admin/users/${artistUserId}/grants`, {
    data: { plan: 'artist_basic', duration_days: 730, note: 'Demo access — V03' },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
  })
  if (!grantRes.ok()) throw new Error(`Grant failed: ${grantRes.status()}`)
  await pause(600)

  // ── 5. Upload a portfolio image ───────────────────────────────────────────────
  await page.goto('/collections')
  await expect(page.getByRole('heading', { name: /collections/i })).toBeVisible()
  await pause(800)

  await page.getByRole('button', { name: /new collection/i }).click()
  await pause(400)
  await slowType(page.locator('input[placeholder*="Name"], input[name="name"]'), 'Murals 2027')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Murals 2027')).toBeVisible({ timeout: 6000 })
  await pause(600)

  await page.getByText('Murals 2027').click()
  await expect(page.getByRole('heading', { name: 'Murals 2027' })).toBeVisible()
  await pause(800)

  // Upload via the hidden file input on the drop zone
  if (!fs.existsSync(FIXTURE_JPG)) throw new Error(`Fixture not found: ${FIXTURE_JPG}`)
  await page.locator('input[type=file]').setInputFiles(FIXTURE_JPG)
  // Wait for the upload to complete (the image thumbnail appears)
  await expect(page.locator('img[alt], [data-testid="image-thumb"]').first()).toBeVisible({ timeout: 30000 })
  await pause(1500)

  // ── 6. Go Public ─────────────────────────────────────────────────────────────
  await page.goto('/profile')
  await expect(page.locator('[data-testid="publish-bar"]')).toBeVisible({ timeout: 8000 })
  await pause(1000)
  await highlight(page, '[data-testid="publish-bar"] button')
  await page.locator('[data-testid="publish-bar"] button').filter({ hasText: /go public|publish/i }).click()
  await pause(1200)
  await expect(page.locator('[data-testid="visibility-badge"]')).toContainText(/public/i, { timeout: 8000 })
  await pause(1000)

  // ── 7. View the public profile ────────────────────────────────────────────────
  const profilePageRes = await page.request.get(`${API}/profiles/me`)
  const { slug } = await profilePageRes.json()
  if (slug) {
    await page.goto(`/artists/${slug}`)
    await pause(2500) // end on the live public profile
  }
})
```

Save to `demos/scripts/V03-artist-signup.ts`.

**Notes:**
- `profile.user_id` — verify this field name against `GET /profiles/me` response. Run
  `curl -s http://localhost:8080/profiles/me -H "Authorization: Bearer $T" | python3 -m json.tool`
  to see the actual shape.
- The public profile URL pattern (`/artists/{slug}`) assumes slug-based routing. Verify against
  `web/src/app/(public)/artists/[id]/page.tsx` — the `[id]` segment may be a UUID, not a slug.

- [ ] **Step 2: Smoke-run**

```bash
task demo:seed && task demo:record V=V03
```

Expected: signup flow, profile fill, image upload, publish, public profile.

- [ ] **Step 3: Commit**

```bash
git add demos/scripts/V03-artist-signup.ts
git commit -m "feat(demos): V03 artist signup and profile setup script"
```

---

## Task 8: V04 — Artist Apply script

**Files:**
- Create: `demos/scripts/V04-artist-apply.ts`

Logs in as the pre-seeded Lady Gabe and applies to CPF 2027. Lady Gabe's profile is
already public and she hasn't applied to the festival yet.

Requires `task demo:seed` to have been run.

- [ ] **Step 1: Create the script**

```typescript
import { test, expect } from '@playwright/test'
import { slowType, pause, highlight, scrollTo } from './helpers.js'

test('V04 — Artist Apply', async ({ page }) => {
  // ── 1. Log in as Lady Gabe ────────────────────────────────────────────────────
  await page.goto('/login')
  await pause(800)
  await page.fill('#email', 'ladygabe@demo.art')
  await page.fill('#password', 'demo-password-2027')
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  await pause(1500)

  // ── 2. Find CPF 2027 ──────────────────────────────────────────────────────────
  // Navigate to the applications / festivals page for artists
  await page.goto('/applications')
  await expect(page.getByRole('heading', { name: /applications|festivals/i })).toBeVisible({ timeout: 8000 })
  await pause(1200)

  // Find and click the CPF 2027 festival Apply link
  await expect(page.getByText('Cheltenham Paint Festival 2027')).toBeVisible({ timeout: 8000 })
  await pause(800)
  await highlight(page, 'a[href*="apply"], button:has-text("Apply")')

  // Scope to the CPF 2027 list item to avoid strict-mode violations
  const festivalItem = page.locator('li, [data-testid="festival-row"]').filter({ hasText: 'Cheltenham Paint Festival 2027' })
  await festivalItem.getByRole('link', { name: /apply/i }).click()
  await pause(1200)

  // ── 3. Fill the application form ─────────────────────────────────────────────
  await expect(page.getByRole('heading', { name: /apply|application/i })).toBeVisible({ timeout: 8000 })
  await pause(1000)

  // f1 — concept
  await scrollTo(page, 'textarea:first-of-type, [data-field-id="f1"] textarea')
  await slowType(
    page.locator('textarea').first(),
    'A large-scale triptych exploring the mythology of the River Chelt — its source, journey, and meeting with the Severn. Water, memory, and time rendered in bold colour across three connected walls.',
  )
  await pause(600)

  // f2 — wall size
  await page.selectOption('select:has-option("Large (20m²+)"), [data-field-id="f2"] select', 'Large (20m²+)')
  await pause(400)

  // f3 — medium
  await page.selectOption('select:has-option("Spray paint"), [data-field-id="f3"] select', 'Spray paint')
  await pause(400)

  // f4 — portfolio links
  await slowType(
    page.locator('textarea').nth(1),
    'https://ladygabe.com/portfolio\nhttps://instagram.com/ladygabeart\nhttps://vimeo.com/ladygabe',
  )
  await pause(600)

  // f5 — insurance
  await page.selectOption('select:has-option("Yes")', 'Yes')
  await pause(400)

  // f6 — availability
  await page.selectOption('select:has-option("Full period"), [data-field-id="f6"] select', 'Full period')
  await pause(400)

  // f7 — experience
  await page.selectOption('select:has-option("Yes"):last-of-type, [data-field-id="f7"] select', 'Yes')
  await pause(400)

  // f8 — anything else (leave blank, just scroll past)
  await scrollTo(page, 'button[type=submit]')
  await pause(800)

  // ── 4. Submit ─────────────────────────────────────────────────────────────────
  await highlight(page, 'button[type=submit]')
  await page.click('button[type=submit]')
  await pause(1200)

  // ── 5. Confirmation ───────────────────────────────────────────────────────────
  await expect(page.getByText(/submitted|thank you|we.ll be in touch/i)).toBeVisible({ timeout: 10000 })
  await pause(3000) // end on confirmation
})
```

Save to `demos/scripts/V04-artist-apply.ts`.

**Note:** The form field selectors (`select:has-option(...)`, `[data-field-id="..."]`) are
approximate. The actual selectors depend on how `DynamicForm.tsx` renders each field. Run
`--headed --debug` and use the inspector to find real selectors for the select elements.

The select fields for f5–f7 may all render as `<select>` without individual IDs — use the
option text as a discriminator or add `nth()` to select the correct one.

- [ ] **Step 2: Smoke-run**

```bash
task demo:seed && task demo:record V=V04
```

Expected: Lady Gabe logs in, finds CPF 2027, fills the form, submits, sees confirmation.

- [ ] **Step 3: Commit**

```bash
git add demos/scripts/V04-artist-apply.ts
git commit -m "feat(demos): V04 artist apply to festival script"
```

---

## Task 9: ffmpeg conversion script

**Files:**
- Create: `demos/run.sh`

- [ ] **Step 1: Create `run.sh`**

```bash
#!/usr/bin/env bash
# Converts all .webm files in output/raw/ to MP4 in output/
# Requires ffmpeg. Install: brew install ffmpeg
set -euo pipefail

SRC="$(dirname "$0")/output/raw"
DST="$(dirname "$0")/output"
mkdir -p "$DST"

shopt -s nullglob
for webm in "$SRC"/**/*.webm; do
  name=$(basename "${webm%.webm}")
  out="$DST/${name}.mp4"
  echo "Converting: $webm → $out"
  ffmpeg -y -i "$webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out"
done
echo "Done. MP4s in $DST/"
```

Save to `demos/run.sh`.

- [ ] **Step 2: Make executable and test**

```bash
chmod +x demos/run.sh
which ffmpeg || echo "Install ffmpeg: brew install ffmpeg"
```

If ffmpeg is missing, install it. Then run a quick conversion test if any `.webm` exists
from earlier steps: `bash demos/run.sh`.

- [ ] **Step 3: Commit**

```bash
git add demos/run.sh
git commit -m "chore(demos): ffmpeg webm→mp4 conversion script"
```

---

## Task 10: End-to-end smoke test

Verify the full pipeline works in sequence before declaring the epic done.

- [ ] **Step 1: Ensure the stack is running**

```bash
curl -sf http://localhost:8080/healthz && echo "API ok" && \
curl -sf http://localhost:3000 -o /dev/null -w "Web: %{http_code}\n"
```

If not: `task up && task db:migrate`

- [ ] **Step 2: Run the full demo pipeline**

```bash
task demo:all
```

Expected: seed completes, all four Playwright tests pass, four `.webm` files appear in
`demos/output/raw/`, four `.mp4` files appear in `demos/output/`.

- [ ] **Step 3: Spot-check the videos**

Open each MP4 in QuickTime and verify:
- V01: signup, festival created, status shows "open"
- V02: Marcus's inbox visible, acceptance, map pin, decline
- V03: artist signup, profile filled, image uploaded, "public" badge visible
- V04: Lady Gabe logs in, form filled, submission confirmation

- [ ] **Step 4: Final commit and kanban update**

```bash
git add -p  # stage any remaining fixes
git commit -m "feat(demos): complete V01–V04 demo video suite"
```

Move the GitHub issue to **Done** on the project board.

---

## Troubleshooting

**`task demo:seed` fails with "connect: connection refused"**
Stack is not up. Run `task up && task db:migrate` first.

**`task demo:seed` fails with "column already exists" or constraint violation**
The delete didn't cascade cleanly. Check FK constraints: `DELETE FROM users WHERE email = ...`
should cascade to artist_profiles → collections, applications, etc. If not, temporarily disable
the `ON DELETE CASCADE` issue by deleting child rows manually first.

**Playwright can't find a selector**
Run: `task demo:record V=V01 -- --headed --debug`
This opens the Playwright Inspector where you can step through and inspect the live DOM.

**`page.request.put` for form setup returns 401**
The session cookie isn't being sent. Try calling the API with an explicit Authorization header:
after login, get the JWT from localStorage: `const token = await page.evaluate(() => localStorage.getItem('token'))`.

**Video is too fast / too slow**
Adjust `slowMo` in `demos/playwright.config.ts` (affects all interactions) or adjust individual
`pause()` calls within the failing script. Target: each step visible for at least 1–2 seconds.

**ffmpeg not found**
`brew install ffmpeg` — it's not in the Docker stack, only needed on the host.
