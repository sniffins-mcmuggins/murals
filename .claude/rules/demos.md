---
paths:
  - "demos/**"
---

# Demo suite

Short recorded clips (≤ ~30s each) that show a single feature end-to-end. Each clip
is a Playwright test, recorded as a `.webm`, then converted to MP4 via `run.sh`.

## Taskfile

All commands run from the repo root:

```bash
task demos:seed              # full reset (truncate all app tables) + re-seed (run before recording)
task demos:record V=<name>   # re-seed then record one clip (e.g. V=artist-analytics)
task demos:convert           # convert all .webm files to MP4 (requires ffmpeg)
task demos:all               # record every clip in the catalogue, then convert
```

`task demos:record` always re-seeds first. The organiser clips mutate festival state
(open/close rounds, release decisions), so every clip must start from a clean slate.

## seed.yaml — editing seed data

`demos/seed/seed.yaml` is the single source of truth for all demo data. After editing
it, re-run `task demos:seed` — no Go editing required.

### Structure at a glance

```
config:          password shared by all accounts
accounts:        admin + organiser emails
featured_artist: Lady Gabe — profile, images, analytics, access grant
promo_codes:     codes for the artist-onboarding clip (DEMO2027)
festivals:       list of Festival objects (see below)
```

### Festival object

Each festival can be either an **application-based** festival or a **historical** one:

```yaml
# Application-based (has a form, applicants, reviewer)
- slug: cpf-2027
  name: ...
  status: open          # draft | open | live | closed | archived (public map renders only for `live`)
  owner: featured       # optional: "" / "organiser" → shared organiser; "featured" → Lady Gabe owns it
                        #   (so logging in as her shows the organiser dashboard for this festival)
  center_lat / center_lng: ...
  endorsements_for_featured_artist:  # optional — organiser/peer endorsements for Lady Gabe
                        #   (seeded AFTER applicants, so a peer's from_artist resolves)
  application_form:
    fields: [...]       # form field objects (see below)
  reviewer_email: ...
  applicants:           # list of Applicant objects (see below)
  portfolio_images:     # URL pool, 2 per accepted applicant (rotates)

# Historical (map history overlay — no applications)
- slug: cpf-2026
  status: closed
  spots:
    - { lat: ..., lng: ..., mural_status: permanent | temporary | unknown }
```

### Adding / changing an applicant

Each applicant under `festivals[*].applicants`:

```yaml
- name: Kit Harrow
  email: kit@demo-artist.art
  bio: Urban wildlife muralist based in Bristol.
  avatar_url: https://...      # public image URL stored directly as the S3 key
  medium: Spray paint
  concept: ...
  size: "Large (20m²+)"
  status: submitted            # submitted | accepted | declined | waitlisted
  shared_links: [instagram, tiktok, website]   # platforms shown in the slide-over
  reviewer_score: 4            # 0 = no score; 1–5 = pre-seeded for Sophie
  spot_lat: 51.9016            # accepted only — real map coords for the live public-map pin
  spot_lng: -2.0752            #   (omit / 0 → pin lands at 0,0; set these for accepted artists)
```

`shared_links` accepts: `instagram`, `twitter`, `facebook`, `youtube`, `tiktok`,
`linkedin`, `pinterest`, `website`. The Go seed builds the URL from the email handle
(e.g. `kit@...` → `https://instagram.com/kit`). Each applicant should have a distinct
mix so the favicon row visibly changes between triage cards.

### Changing images / analytics

```yaml
featured_artist:
  collection:
    images:       # swap or add URLs — first image is the collection cover
  analytics:
    profile_view: 342   # counts seeded as events spread over 85 days
    qr_scan: 57
    link_click: 124
```

Images are stored as external URLs directly in the S3 key column — MinIO is bypassed.
This means seeded images render without an upload flow but depend on the URL staying live.

### Changing the application form

Edit `festivals[*].application_form.fields`. Each field:

```yaml
- id: f1                        # stable — used as the answer key, never rename
  type: textarea | select | text
  label: ...
  options: [...]                # select only
  required: true | false
  prefill: social.instagram     # optional — pre-fills from artist profile
```

Field `id` values are the answer keys the API validates against. Renaming an `id` is a
breaking change — existing answers will fail re-submission. Add new fields instead.

## Scripts — structure and conventions

Scripts live in `demos/scripts/`. Two shared modules that are never collected as specs:
- `_setup.ts` — auth helpers (`silentLogin`, `silentSignup`, `redeemPromo`), API wrappers
  (lookup festival id, list/find applications, open/close round, stage/release decisions)
- `helpers.ts` — visual chrome (`addCursorOverlay`, `showDialog`, `pause`, `slowType`,
  `highlight`, `scrollTo`)

`playwright.config.ts` collects only `artist-*.ts` and `organiser-*.ts`. Any file with
another prefix is treated as a shared module.

### Writing a new clip

1. Create `demos/scripts/<persona>-<feature>.ts` (e.g. `artist-public-profile.ts`)
2. One `test(...)` block per file — the test name becomes the clip title in the report
3. Start every clip with `addCursorOverlay(page)` then `silentLogin(page)` (or
   `silentSignup` if the clip shows onboarding)
4. Off-screen preconditions (state that doesn't belong on camera) go at the top via
   the API helpers in `_setup.ts` — never in the visible recording
5. Use `showDialog(page, '...')` to narrate each section (amber branded card, fades in
   then out); use `pause(ms)` between sections
6. Keep clips short (≤ ~30s). If a flow needs more than that, split into two clips.

### Minimal script skeleton

```typescript
import { test, expect } from '@playwright/test'
import { pause, showDialog, addCursorOverlay } from './helpers.js'
import { silentLogin } from './_setup.js'

test('artist-<feature> — short human description', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page)  // Lady Gabe by default; pass email arg for other accounts

  await page.goto('/<route>')
  await expect(page.getByRole('heading', { name: /heading text/i })).toBeVisible({ timeout: 8000 })
  await showDialog(page, 'What the viewer should understand about this feature.')
  await pause(2000)
})
```

### Organiser clips that need pre-staged state

Clips that show a post-decision board, map editor with assigned artists, etc. must drive
the precondition off-screen before the recording starts. Use the helpers from `_setup.ts`:

```typescript
import { silentLogin, cpfFestivalId, decideAllAndRelease } from './_setup.js'

test('organiser-decisions-release — ...', async ({ page }) => {
  await addCursorOverlay(page)
  const token = await silentLogin(page, ORGANISER_EMAIL)
  const festId = await cpfFestivalId(page.request)
  // Drive to desired state off-screen (before any page.goto)
  await decideAllAndRelease(page, festId, ['Kit Harrow', 'Amara Diallo'])

  await page.goto(`/dashboard/festivals/${festId}/applications`)
  // ... recording continues
})
```

After writing a new script, add its name to the `demo:all` clip list in
`demos/Taskfile.yml` so it's included in batch recordings.

### Adding a new clip to the catalogue

1. Write the script at `demos/scripts/<name>.ts`
2. Add `- <name>` to the `for:` list in `demos/Taskfile.yml` `all` task
3. Record it: `task demos:record V=<name>`
4. Convert: the next `task demos:all` or `task demos:convert` will pick it up

## Key constants (from _setup.ts)

```
DEMO_PW          demo-password-2027
ARTIST_EMAIL     ladygabe@demo.art        (Lady Gabe — hero artist)
ORGANISER_EMAIL  marcus@cpf-demo.art
```

`silentLogin` defaults to `ARTIST_EMAIL`. Pass a different email for other personas.
