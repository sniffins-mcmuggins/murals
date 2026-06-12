---
paths:
  - "api/cmd/api/**"
---

# API handler implementation checklist

@api/cmd/api/main.go

This rule captures the class of bugs that pass code review and pass unit tests but are broken in production — specifically because unit tests bypass the middleware stack.

## Unit tests don't prove route wiring

Every handler in `api/internal/*/` has unit tests that call the handler function directly via `httptest.NewRecorder` after injecting a principal with `auth.WithUserForTest()`. This bypasses:

- JWT parsing in `auth.Middleware`
- `admin.RequireAdmin` (or any other route-group middleware)
- `chi.RealIP`, request ID injection, etc.

If `r.Use(admin.RequireAdmin(pool))` were accidentally removed from the route group in `api/cmd/api/main.go`, every existing unit test would still pass, and regular users would have unrestricted access to all admin endpoints.

**The fix:** for every new protected route group, write one unauthenticated e2e Vitest request as the first test:

```typescript
it('GET /new-protected-resource without token → 401', async () => {
  const res = await fetch(`${API}/new-protected-resource`)
  expect(res.status).toBe(401)
})
```

This has no DB seeding and takes seconds to write. It is the only test that would catch a dropped `r.Use(...)`.

## Route registration order: literals before parameters

In chi, routes within a group are matched top-to-bottom. A literal path segment must be registered **before** any parameterized route at the same level, or chi will parse the literal as the parameter value and your handler will fail trying to parse a UUID.

```go
// CORRECT — register /reorder before /{applicationID}
r.Post("/applications/reorder", festival.ReorderApplicationsHandler(pool))
r.Post("/applications/{applicationID}/waitlist", festival.WaitlistApplicationHandler(pool, mailer))
r.Patch("/applications/{applicationID}", festival.PatchApplicationHandler(pool))
r.Post("/applications/{applicationID}/notes", festival.AddApplicationNoteHandler(pool))

// WRONG — "reorder" is parsed as applicationID, UUID parse fails → 400
r.Post("/applications/{applicationID}/waitlist", ...)
r.Patch("/applications/{applicationID}", ...)
r.Post("/applications/reorder", ...)  // never reached
```

Check this whenever you add a literal sub-path alongside an existing `{id}` route.

## Handler-level auth vs middleware-level auth

Some routes are in a rate-limited group but NOT an auth-required group. The 401 comes from the handler checking `auth.User(r.Context())`, not from middleware. Examples: `/promo/redeem`.

This creates a testing gap: the middleware test says "this route is public" but the handler says "you need auth." Write separate e2e tests for both:

1. **No token → 401** (handler-level check)
2. **Token but wrong input → 400** (validates the handler runs its input check after the auth check)

Document which approach a route uses in a comment on the route registration line:

```go
// Rate-limited but not auth-required — handler checks auth internally
r.Post("/promo/redeem", promo.RedeemHandler(pool))
```

## Concurrent request patterns

For any endpoint that performs "check then act" against a DB constraint (promo redemption, idempotency, "create if not exists"):

- The Go handler should use a conditional UPDATE or `ON CONFLICT` — see `sqlc-and-schema.md`
- The e2e test should fire two concurrent `fetch()` calls via `Promise.all` and assert exactly one succeeds:

```typescript
const [r1, r2] = await Promise.all([
  fetch(`${API}/promo/redeem`, { method: 'POST', ... }),
  fetch(`${API}/promo/redeem`, { method: 'POST', ... }),
])
const statuses = [r1.status, r2.status].sort()
expect(statuses).toEqual([200, 409])
```

Two rapid sequential requests often surface TOCTOU bugs without full concurrent infrastructure.

## Adding a gate to an *existing* endpoint breaks its callers silently

When you bolt a new auth/entitlement/validation gate onto an endpoint that already
ships (e.g. `billing.CanPublish` was added to `PATCH /profiles/me`, so publishing now
402s without a subscription/grant), the endpoint's behaviour changes for everything that
already calls it — including **shared e2e helpers and tooling**. Unit tests for the gate
itself pass, the suite stays green because each test that needs the endpoint patches
*itself* inline, and the **shared helper silently rots**: its contract ("publish this
profile") quietly becomes "attempt to publish; fail unless you separately satisfied the
gate." The next consumer inherits the broken helper. (Lived example: `publishProfile()`
in `e2e/fixtures/helpers.ts` 402'd for the UI health sweep weeks after the gate landed.)

When you gate an existing endpoint:

- **Grep for every caller** of the endpoint and its e2e helper(s) — `grep -rn '/profiles/me'`
  / `grep -rn publishProfile e2e/ scripts/`. A green suite does **not** mean the helper
  still works; it means no *current* test exercised the now-broken path.
- **Fix the shared helper, not each call site.** Fold the gate-satisfying step into the
  helper (e.g. `publishProfile()` now hits the `/_test/grant` backdoor first) so every
  caller — tests *and* tooling — gets a working path through one fetch. Don't copy-paste
  an inline grant into each test.
- If satisfying the gate in tests needs setup an ordinary fetch can't do, add a namespaced
  `/_test/...` backdoor (see `billing.GrantTestHandler`, modelled on `/_test/verify-email`)
  rather than standing up Stripe/admin sessions in every test.

## Pre-merge checklist for new handlers

- [ ] Route registered in `main.go` with the correct middleware group.
- [ ] Literal sub-paths (e.g. `/reorder`) registered before parameterized routes (e.g. `/{id}`) at the same level.
- [ ] If the route is in a new protected group: there is an unauthenticated e2e probe that confirms 401.
- [ ] If the route does its own auth check (not middleware): there is an e2e test for the no-token → 401 path.
- [ ] If the handler can race on a unique constraint: the DB query uses `ON CONFLICT` and there is a concurrent `Promise.all` e2e test.
- [ ] If you added a gate to an **existing** endpoint: you grepped for its callers + e2e helpers and updated the shared helper (not each call site), and added a `/_test/` backdoor if the gate can't be satisfied by a plain fetch.
- [ ] `task api:test` passes.
