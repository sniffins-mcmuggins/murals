# Admin TUI Design

**Date:** 2026-05-28  
**Status:** Approved  
**Depends on:** `2026-05-27-admin-panel-design.md` (admin HTTP API — must be deployed)

## Overview

A terminal UI (TUI) for internal admin operations, built with [Bubbletea](https://github.com/charmbracelet/bubbletea). Lives at `api/cmd/admin-tui` in the existing monorepo. Talks exclusively to the admin HTTP API — no direct database access. Surfaces all four admin domains: users, access grants, promo codes, and festivals.

The target user is a developer or ops person running the tool locally against the production API URL. It is not a web UI and not served over HTTP.

## Architecture

### Binary location

`api/cmd/admin-tui/main.go` — a new Go binary inside the existing `api/` module. No new `go.mod`. Three new dependencies added to `api/go.mod`:

- `github.com/charmbracelet/bubbletea` — TUI framework (Elm architecture / message passing)
- `github.com/charmbracelet/bubbles` — pre-built components: list, viewport, textinput, spinner
- `github.com/charmbracelet/lipgloss` — styling and two-column layout

### Flags

```
--api-url   Base URL of the admin HTTP API (default: http://localhost:8080)
--version   Print version and exit
```

A `task admin-tui:run` entry in `api/Taskfile.yml` wraps the common local invocation:

```yaml
admin-tui:run:
  desc: "Run the admin TUI against the local stack"
  cmd: go run ./cmd/admin-tui --api-url http://localhost:8080
```

### File structure

```
api/cmd/admin-tui/
  main.go              Entry point: parse flags, initialise tea.Program
  client/
    client.go          Typed HTTP client wrapping all admin API calls
  ui/
    app.go             Top-level model: owns nav + active section, routes Tab
    login.go           Login screen model (email → password → TOTP steps)
    nav.go             Left nav model (3 items, arrow key selection)
    users.go           Users section: list → detail → inline forms
    promos.go          Promo codes section: list → create form → revoke confirm
    festivals.go       Festivals section: read-only list → detail view
    forms.go           Shared components: ConfirmPrompt, PlanPicker, InputField
    styles.go          Lipgloss styles using project design system colours
```

No TUI unit tests in v1. The business logic and validation live in the HTTP API and its test suite. TUI code is thin view/interaction logic that is impractical to unit test without a real terminal.

## Auth Flow

On launch the TUI renders a full-screen login form. The main explorer is not shown until auth succeeds.

**Steps:**

1. Email input → Enter
2. Password input (characters masked with `*`) → Enter → `POST /auth/login`
3. If the `200 OK` response body includes `mfa_token` (MFA required): TOTP code input → Enter → `POST /auth/mfa/verify`
4. JWT received and stored in-memory for the session lifetime

Login errors (wrong password, bad TOTP code, non-admin account) show an inline error line beneath the form. The admin can correct and retry. No lockout in the TUI itself — the API's rate limiter handles brute-force protection.

JWT is never written to disk. Quitting the TUI discards it.

Admin accounts always have MFA enrolled (enforced by `RequireAdmin` middleware), so the TOTP step is always reached.

## Layout

Explorer-style: persistent left nav with a wider right content pane. `Tab` toggles focus between them.

```
┌─ Nav ─────┬─ Content ────────────────────────────────────────────┐
│           │                                                        │
│  Users    │  Filter: [                    ]                        │
│  Promos   │                                                        │
│  Festivals│  alice@example.com    admin  MFA  2026-01-10          │
│           │  bob@example.com             MFA  2026-02-03  ←       │
│           │  carol@example.com                2026-03-15          │
│           │                                                        │
│           │  [enter] detail  [g] grant  [p] reset password        │
└───────────┴────────────────────────────────────────────────────────┘
 q quit  tab switch pane  / filter
```

- Left nav: 3 items (Users / Promo Codes / Festivals), styled with amber accent on active item
- Right pane: section content — default is a filterable list
- Status bar at bottom: persistent key hint line
- Styles use project design system: `--ink #1A1A2E`, `--amber #E8A838`, `--clay #C45C3A`, `--offwhite #FAF7F2`

## Section Behaviour

Access grants are **not** a standalone nav section. The API scopes grants to a user, so grant management lives inside user detail. This matches the natural workflow: find user → inspect → act.

### Users

**List view** — loads on section enter: `GET /admin/users?email=&page=1&per_page=50`

- Type to filter by email (debounced 300 ms, re-queries the API)
- Columns: email, admin flag, MFA status, created date
- Keys: `Enter` → detail, `g` → create grant form, `p` → confirm password reset

**Detail view** — `GET /admin/users/{id}`

- Shows: email, is_admin, mfa_enabled, created_at
- Subscription block: plan, status, billing interval, current period end
- Active grants list: plan, valid_until, note
- Keys on a grant row: `r` → confirm → `DELETE /admin/grants/{id}`
- Keys anywhere in detail: `g` → create grant form, `p` → confirm password reset, `Esc` → back to list

**Create grant form** — inline in right pane

- Plan picker: `artist_basic` / `artist_pro` / `organiser_setup` / `festival_activation` (arrow keys or number)
- Duration days: numeric input
- Festival ID: conditional text input (shown only when plan = `festival_activation`)
- Note: optional text input
- Submit → `POST /admin/users/{id}/grants` → success flash → return to user detail

**Password reset confirm** — `p` on any user shows `Reset password for <email>? [y/N]`. `y` → `POST /admin/users/{id}/password-reset` (202 Accepted) → success flash.

### Promo Codes

**List view** — loads on section enter: `GET /admin/promo-codes`

- Columns: code, plan, use_count / max_uses (shown as `3/10` or `3/∞`), expires, revoked status
- Keys: `n` → create form, `d` on a row → revoke confirm

**Create form**

- Code: text input
- Plan picker: same set as grants (minus `festival_activation` — blocked by the API)
- Duration days: numeric input
- Max uses: optional numeric input (leave blank for unlimited)
- Expires at: optional date input (YYYY-MM-DD, converted to RFC3339 at midnight UTC on submit)
- Submit → `POST /admin/promo-codes` → success flash → return to list (list reloads)

**Revoke confirm** — `d` on a row: `Revoke promo code "<code>"? [y/N]`. `y` → `DELETE /admin/promo-codes/{id}` → row updates in place.

### Festivals

Read-only in v1. No application management API exists yet.

**List view** — `GET /public/festivals` (or whichever list endpoint is available)

- Columns: name, slug, status, start date, end date
- `Enter` → detail view

**Detail view** — viewport showing festival metadata. Displays a notice: "Application management not yet available in the TUI — use the admin API directly." `Esc` → back to list.

This section is a placeholder; it will expand when application review endpoints are added to the admin API.

## Error Handling

All API calls run as Bubbletea commands (async). While a command is in flight, a spinner replaces the content pane. On error:

- `401` / `403`: display "Session expired or permission denied. Press q to quit." — no auto-retry.
- `404`: show inline "Not found" message, return to previous view.
- Network error / 5xx: show error message with the raw error string, offer `r` to retry or `Esc` to go back.

The TUI never silently swallows errors. Every failed API call produces a visible message.

## API Client (`client/client.go`)

Thin wrapper over `net/http`. All methods accept a `context.Context`. No retries — errors are surfaced to the TUI immediately.

Methods:

```go
Login(ctx, email, password) (token, mfaToken string, mfaRequired bool, err error)
VerifyMFA(ctx, mfaToken, totpCode string) (token string, err error)
ListUsers(ctx, email string, page, perPage int) ([]UserListItem, error)
GetUser(ctx, userID string) (UserDetail, error)
TriggerPasswordReset(ctx, userID string) error
CreateGrant(ctx, userID string, req CreateGrantRequest) (Grant, error)
RevokeGrant(ctx, grantID string) error
ListPromoCodes(ctx) ([]PromoCode, error)
CreatePromoCode(ctx, req CreatePromoCodeRequest) (PromoCode, error)
RevokePromoCode(ctx, codeID string) error
ListFestivals(ctx) ([]Festival, error)
```

Response types mirror the API's JSON shapes (defined locally in `client/client.go`, not imported from the server package).

## Keyboard Reference

| Key | Context | Action |
|-----|---------|--------|
| `Tab` | anywhere | Switch focus: nav ↔ content |
| `↑` / `k`, `↓` / `j` | lists, nav | Navigate rows |
| `Enter` | list row | Open detail |
| `Esc` | detail / form | Back to list |
| `/` | list view | Focus filter input |
| `n` | Promos list | New promo code form |
| `g` | Users list/detail | Create grant form |
| `p` | Users list/detail | Trigger password reset |
| `d` | Promos list row | Revoke promo code |
| `r` | Grant row in user detail | Revoke grant |
| `y` / `n` | confirm prompt | Confirm or cancel action |
| `q` | anywhere | Quit |

## Out of Scope (v1)

- Persisting the JWT to disk (keychain, file) — session is ephemeral
- Application review actions (accept/decline) — no admin API endpoints exist yet
- Setting a user's `is_admin` flag via TUI — too dangerous to expose without audit logging
- Bulk operations
- Mouse support
