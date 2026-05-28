---
name: e2e-gap-analysis
description: Audits e2e test coverage gaps and creates GitHub issues for missing tests, with a security and business-logic focus. Use whenever a new feature is implemented or discussed, after merging PRs, when the user asks "are we covered for X", mentions missing tests, e2e gaps, test coverage, or wants to check what's tested. Also triggers after any implementation task completes — don't wait to be asked, proactively offer the audit when features are freshly added.
---

# E2E Gap Analysis

Audit what's changed since the last run, identify missing e2e tests with a security and business-logic lens, and create well-specced GitHub issues for each gap.

## State

Track last run in `.claude/e2e-audit-state.json` at the repo root:
```json
{"last_run": "2026-05-28T10:00:00Z", "issues_created": [123, 124]}
```

If this file doesn't exist, it's the first run — look at the last 20 merged PRs and all recent git history.

## Step 1: Establish scope

```bash
# Get last_run timestamp from state (or fallback)
cat .claude/e2e-audit-state.json 2>/dev/null || echo '{"last_run":"2000-01-01T00:00:00Z"}'

# Merged PRs since last run
gh pr list --state merged --json number,title,body,mergedAt,files \
  --limit 20 | jq '[.[] | select(.mergedAt > "<last_run>")]'

# Commit context
git log --oneline --since="<last_run>" --no-merges
```

Read each PR title, body, and changed files list to understand what was added or modified. The PR body is the richest source — it usually describes intent, not just mechanics.

## Step 2: Read current coverage

Read all e2e test files to map what's already exercised:

**API (Vitest) — read all `e2e/api/*.test.ts` files:**
```bash
ls e2e/api/*.test.ts
```
Key files and their focus areas:
- `golden-path.test.ts` — sequential happy-path (18 `it()` blocks, shared state)
- `authorization-isolation.test.ts` — IDOR and cross-user resource access
- `admin-auth.test.ts` — RequireAdmin middleware wiring, demoted admin, MFA gate
- `admin-promo.test.ts` — promo code validation, concurrent redemption race
- `billing-guards.test.ts` — RequirePlan middleware, access_grant fallback (B7)
- `application-review.test.ts` — waitlist/patch/reorder/notes workflow
- `auth-*.test.ts` — login, MFA, password reset, edge cases

**Browser (Playwright) — read all `e2e/browser/*.spec.ts` files:**
- `application-flow.spec.ts`, `artist-onboarding.spec.ts`, `organiser-setup.spec.ts`, `public-visitor.spec.ts`

**Also read:** `e2e/fixtures/helpers.ts` — available HTTP helpers and `e2e/fixtures/auth-flows.ts` — `injectResetToken`, `resetPassword`, `enrollMFA`.

Note which routes, user roles, and scenarios are already covered. Pay attention to what's tested for *rejection* (403s, 401s, 422s) as well as *acceptance* — negative path coverage is the most common gap.

## Step 3: Read the implementation

For each changed area, read the relevant handler files. Check `api/cmd/api/main.go` for the full route list and middleware groupings — route groupings reveal which middleware applies where, which is critical for auth gap analysis.

## Step 4: Gap analysis — five lenses

Work through each changed feature area with these five lenses. Be thorough: a gap that "probably" has a test but you haven't confirmed still needs to be checked.

### Lens 1: Auth / Privilege escalation

For every protected route group added or modified, ask:
- Is there a test that verifies a **lower-privileged role is rejected** (not just that the correct role is accepted)?
- Common missing tests: artist hitting `/admin/*`, unauthenticated hitting `/me`, organiser accessing another organiser's resources
- Check the middleware chain: if a route is inside a `RequireAdmin` group, is there a test for what happens when a regular user hits it?

### Lens 2: IDOR (Insecure Direct Object Reference)

For every endpoint that takes a resource ID (festival slug, application ID, artist ID, etc.):
- Is there a test where **user A tries to read or mutate user B's resource**?
- Common missing tests: artist updating a profile with a different `userId`, organiser reading/accepting applications for a festival they don't own, artist accessing another artist's draft collection

### Lens 3: Race conditions

For any endpoint that performs a "check then act" pattern or has a uniqueness constraint:
- Promo code redemption — can the same code be redeemed twice with concurrent requests?
- Application submission — can the same artist submit twice to the same festival?
- Any "create if not exists" flow

These don't need full concurrent test infrastructure — two rapid sequential requests in the same test block often surface the issue.

### Lens 4: Rate limiting

For sensitive endpoints (login, signup, forgot-password, promo redemption, any endpoint that triggers external comms):
- Is there a test that **exceeds the rate limit threshold** and verifies a 429?
- Is there a test that confirms the limit resets correctly?

**Feasibility caveat:** The test stack sets `LOGIN_RATE_LIMIT_BURST=200`. A 429 test for a rate-limited endpoint requires firing 200+ requests, which would exhaust the shared IP bucket and cause other parallel tests to fail. If the threshold is >20, flag the gap as a known limitation rather than creating an issue — document it in the test file with a comment (see `admin-promo.test.ts` for the precedent). Only create an issue if there's a practical way to test it in isolation (e.g., a dedicated test-only endpoint with a configurable per-route limit).

### Lens 5: Input validation edges

For any endpoint that accepts user input:
- Missing required fields → 422 (not 500)
- Invalid enum values → 422
- Oversized strings in text fields (bio, name, description)
- Negative or zero values where positive expected
- Malformed IDs (non-UUID where UUID expected)
- The goal: confirm the API fails gracefully with a clear error, not an internal server error

### Lens 6: Bugs hidden by missing tests

This is the most important lens — sometimes the gap isn't just "we don't test this", it's "this is already broken and the missing test is the only reason nobody noticed."

For each area, ask: **if I wrote this test right now and ran it against the live code, would it pass?**

Common patterns where the answer is "probably not":
- **Stale auth state:** Does the code read live DB state, or trust a claim baked into the JWT at login? E.g. if `is_admin` is only in the JWT claim and never re-checked against the DB, a demoted admin's existing token still grants full access for its TTL. The test doesn't exist — but neither does the revocation.
- **Middleware not wired:** Unit tests often inject fake principals directly, bypassing the actual route group middleware. If `RequireAdmin` were accidentally dropped from the route group in `main.go`, every unit test would still pass. The only test that catches this is one that hits the live server.
- **ON CONFLICT gaps:** A handler that does "look up, then insert" without `ON CONFLICT` may work fine in development but double-inserts under production load. The unit test seeds pre-existing state; the e2e test would fire concurrent requests and catch it.
- **Background goroutine swallowing errors:** A detached goroutine that fires `_ = mailer.Send(...)` will always return 200 to the client even if the email was silently dropped. The test passes; the user never gets their reset email.
- **Session revocation not wired to all state-changing flows:** `IncrementSessionVersion` must be called whenever auth state changes. If a new flow (admin-triggered password reset, MFA disable) is missing the increment, existing sessions stay valid indefinitely after the state change.

When you identify a suspected bug, flag it clearly in the issue — it's a different severity than a missing test, and it likely needs a code fix alongside the test.

## Step 5: Draft issues

For each gap, prepare an issue in this exact format. Be specific — vague issues don't get fixed.

Use `[E2E Gap]` in the title for missing test coverage. Use `[E2E Bug]` if Lens 6 analysis suggests the code is already broken and writing the test would immediately fail — these need a fix, not just a test.

```
Title: [E2E Gap] <Area>: <specific scenario in one line>
  — or —
Title: [E2E Bug] <Area>: <what is broken, not just untested>

## What's missing
<1-2 sentences: what scenario isn't tested, and what the risk is if it goes untested>

> ⚠️ **Potential implementation bug** (include only when Lens 6 applies)
> <One sentence on why you suspect the test would fail against the current code, not just be absent.
>  E.g. "is_admin is never re-checked against DB after JWT issuance — a demoted admin's token
>  stays valid for up to 7 days.">

## Suggested test

**Layer:** Vitest API / Playwright browser  
**File:** e2e/api/golden-path.test.ts / e2e/browser/<spec>.spec.ts

```typescript
// Concrete sketch using the actual helpers and patterns from this codebase.
// Use suffix = Date.now() for unique test data.
// Show the specific assertion that would catch the bug.

const suffix = Date.now();
const { token } = await createArtist(suffix);

const res = await fetch(`${API_URL}/admin/users`, {
  headers: { Authorization: `Bearer ${token}` }
});
expect(res.status).toBe(403);
```

## Implementation notes
<Specifics worked out during analysis: exact route path, which middleware should catch it, expected DB state, any edge cases worth covering in the same test block. If this is a suspected bug: what code change is likely needed alongside the test.>

## Acceptance criteria
- [ ] <specific, checkable thing>
- [ ] <specific, checkable thing>
- [ ] No regression in existing related tests
```

**Deciding Vitest vs Playwright:**
- Use Vitest (API layer) for: auth rejection, IDOR, rate limiting, input validation, race conditions — anything where you're asserting HTTP status codes and response bodies directly
- Use Playwright (browser layer) for: flows that require actual UI interaction, or where the gap is specifically in how the frontend enforces access (e.g. a page that should redirect but doesn't)

## Step 6: Present and confirm

Show the full list before creating anything. Flag suspected bugs distinctly so the user sees them immediately:

```
Found N gaps across M feature areas since <last_run_date>:

 1. [E2E Bug]  Admin: is_admin JWT claim not re-checked against DB — demoted admin retains access ⚠️
 2. [E2E Gap]  Admin: unauthenticated access to /admin/* not tested at integration layer
 3. [E2E Gap]  Promo: concurrent redemption race not tested
 4. ...

Create all N issues? Let me know if any should be skipped.
```

**The confirmation prompt must be the last thing you write.** Do not end on the final issue spec — always close with the prompt above. Wait for the user to respond before proceeding to Step 7. If the user wants to skip some, note which ones and proceed with the rest.

## Step 7: Create issues

For each confirmed issue:

```bash
# Ensure labels exist first
gh label create "e2e" --color "#0075ca" --description "End-to-end test coverage" 2>/dev/null || true
gh label create "security" --color "#e4e669" --description "Security and business-logic gaps" 2>/dev/null || true
gh label create "bug" --color "#d73a4a" --description "Something isn't working" 2>/dev/null || true

# Create the issue — use "e2e,security" for [E2E Gap], "e2e,security,bug" for [E2E Bug]
gh issue create \
  --title "[E2E Gap] ..." \
  --body "$(cat <<'EOF'
## What's missing
...
EOF
)" \
  --label "e2e,security"
```

Capture each created issue number for the state update.

## Step 8: Update state

```bash
cat > .claude/e2e-audit-state.json <<EOF
{
  "last_run": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "issues_created": [<comma-separated issue numbers>]
}
EOF
```

## Test infra quick reference

| Thing | Detail |
|---|---|
| API test runner | Vitest — `task e2e:api` |
| Browser test runner | Playwright (Chromium) — `npx playwright test` |
| Both | `task e2e` (API first, then browser) |
| Unique data | Always `const suffix = Date.now()` |
| HTTP helpers | `createArtist(suffix)`, `createOrganiser(suffix)`, `loginAs(browser, email, password, baseURL)`, `uploadImage(token, collectionId)` |
| DB access | `import { Client } from 'pg'` — `DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'` |
| JWT minting | `signHS256(payload, JWT_SECRET)` — defined in `auth-edge-cases.test.ts`, `admin-auth.test.ts`, `admin-promo.test.ts`. Copy the function into any new file that needs it. |
| Auth fixtures | `injectResetToken(email)`, `resetPassword(token, newPassword)`, `enrollMFA(token)` — from `e2e/fixtures/auth-flows.ts` |
| API URL in tests | `process.env.API_URL` or `http://localhost:8080` |
| Stack must be running | `task up` before either runner |

## Rate limit constraint for test sketches

**Do not use `createArtist` in test sketches for auth-rejection or IDOR tests.** `createArtist` calls `/auth/login` which is rate-limited (burst 200 across all parallel workers). With 16+ test files running concurrently, unnecessary login calls exhaust the burst and cause `Login failed: 429` failures in unrelated tests.

**Use `signupAndMint` instead** for any test that just needs a valid token:
- Auth rejection tests (does this endpoint return 403 for a non-admin?)
- IDOR tests (does user A get 403 when hitting user B's resource?)
- Input validation tests (does this endpoint return 422 for bad input?)

`signupAndMint` calls `/auth/signup` (not rate-limited) then mints a JWT via `signHS256` using a DB query. It requires a `pg Client` — see `admin-auth.test.ts` or `billing-guards.test.ts` for the pattern. The only case where you need `createArtist` (real login) is when the test is asserting something about the login flow or session_version revocation.
