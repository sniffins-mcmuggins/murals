# Running a local demo

How to stand up the full Painttrace platform on your machine and demo it live,
plus how the seed data works and how to edit it.

> This is for **manual / live demos** (showing the product to someone). The
> automated demo-clip recording pipeline (`task demo:record`, `scripts/`,
> `output/`) is a separate concern and not covered here.

---

## 1. Start the stack

From the **repo root**:

```bash
task up          # start Docker Compose: api, web, db, minio, mailpit, prometheus
task db:migrate  # apply DB migrations (run once after a fresh `task up`)
```

When it's ready:

| Service | URL |
|---|---|
| **Web platform** | http://localhost:3000 |
| API | http://localhost:8080 |
| **Mailpit** (catches all outgoing email) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

`task down` stops everything. `task down -v` (or `task e2e:clean`) also wipes the
DB and MinIO volumes for a truly fresh start.

### What `/` does now

The root URL has **no landing page**. Visiting http://localhost:3000:

- **not logged in** → redirects to `/login`
- **logged in** → redirects to `/dashboard`

(`web/src/app/page.tsx` — it validates the session cookie via `GET /me`.)

---

## 2. Seed demo data

```bash
task demo:seed   # wipe + re-seed the demo accounts and content
```

This is **idempotent** — it deletes the known demo rows first, so you can run it
as often as you like and always get the same clean slate. Run it whenever you
want to reset the demo (e.g. between practice run-throughs).

### Demo accounts

Every seeded account shares one password: **`demo-password-2027`**

| Email | Use it to show… |
|---|---|
| `ladygabe@demo.art` | **The hero artist.** Public profile, real images, live analytics (342 views · 57 scans · 124 clicks), endorsements. Start here. |
| `marcus@cpf-demo.art` | **The organiser.** Owns *Cheltenham Paint Festival 2027*, the application form, and the review board. |
| `sophie@cpf-reviewer.art` | **A review panellist** with scores already entered, so star averages show on the board. |
| `admin@demo.art` | **Platform admin** (`is_admin`) — admin tooling. |
| `kit@`, `tomas@`, `amara@`, `rosa@demo-artist.art` | Fictional applicants who have applied to CPF 2027 (populate the review board). |

All accounts are pre-`email_verified` and `is_beta`, so they skip the email
verification and beta gates entirely.

Other seeded fixtures worth knowing:
- **Festival:** `cpf-2027` (status `open` — artists can apply) and a closed
  `cpf-2026` used for the map history overlay.
- **Promo code:** `DEMO2027` (grants `artist_basic` for ~2 years).

---

## 3. Demoing a fresh signup (email verification)

If you want to show the *real* new-user flow live (sign up → verify → log in):

1. Sign up at http://localhost:3000/signup with any email.
2. Open **Mailpit at http://localhost:8025** — the verification email is waiting
   there (nothing actually leaves your machine; Mailpit catches all SMTP).
3. Click the verification link in the email → the account is verified.
4. Log in.

There is **no "skip verification" backdoor** — Mailpit is the intended local
path, and it's instant. For a smooth scripted demo, prefer the pre-seeded
accounts above and avoid live signups.

---

## 4. Editing the seed

It's a single Go program: **`demos/seed/main.go`** (plain Go with inline SQL
`INSERT`s — edit it directly, no migration needed). After editing, re-run
`task demo:seed`.

| To change… | Edit… |
|---|---|
| The shared password | `demoPassword` const (top of the file) |
| An applicant (name, bio, medium, concept, status) | the `artistSeed` slice |
| An applicant's avatar | the `avatarURLs` map (keyed by name) |
| The application questions | the `cpfFields` slice |
| The festival (name, dates, status, location) | the `INSERT INTO festivals` block |
| Lady Gabe's profile / images / analytics | her block (`ladygabe@demo.art`) |

### Image gotcha

The seed stores image URLs **directly** as the S3 key / `cdn_url` (external
Unsplash / Squarespace / Wix URLs) — it bypasses MinIO, which is why seeded
images render without going through the upload flow. The upside: to add or swap
an image, just paste a public image URL. The downside: those images depend on
the external URLs staying live, so an offline machine or a dead link shows a
broken image.
