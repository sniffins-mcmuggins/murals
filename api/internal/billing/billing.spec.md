# billing Spec
**Path:** `api/internal/billing/`
**Last updated:** 2026-06-12

## Contract
- Creates Stripe Checkout Sessions for artist subscriptions (basic/pro, monthly/annual) via `ArtistCheckoutHandler`
- Creates Stripe Checkout Sessions for organiser setup and festival activation via `OrganiserCheckoutHandler`
- Opens Stripe billing portal sessions via `ArtistPortalHandler`
- Handles Stripe webhook events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- `billing.CanPublish(ctx, pool, userUUID) (bool, error)` — returns true when the user has a qualifying artist entitlement (paid subscription or access grant)
- `billing.RequirePlan(plan string)` middleware — gates a route to users with an active subscription or grant for `plan`

## Boundaries
- Does NOT manage admin access grants directly — `admin.GrantHandler` creates rows in `access_grants`; billing reads them
- Does NOT manage promo code redemption — that is `admin.RedeemPromoHandler`
- Does NOT handle refunds — managed in the Stripe dashboard
- Does NOT decide what product features each plan unlocks beyond access gating

## Key Decisions
- **Subscriptions AND grants**: `CanPublish` and `RequirePlan` check both `subscriptions` and `access_grants` tables so admin comps and promo codes work identically to paid plans without special-casing
- **`RequirePlan` middleware vs handler-level check**: use middleware when the entire route is plan-gated; call `CanPublish` directly in handlers when only part of the response is gated (e.g. analytics window size)
- **Festival activation = one-off charge**: `FestivalActivation` price is a single payment (`mode: payment`), not a subscription; festivals also have an annual listing subscription (`FestivalAnnual`)
- **Stripe customer creation is get-or-create**: `getOrCreateStripeCustomer` looks up `users.stripe_customer_id` before calling the Stripe API; concurrent requests must not create two customers — the DB unique constraint on `stripe_customer_id` is the hard guard
- **Webhook events drive subscription state**: the DB subscription row is only created/updated from webhook events, never from the checkout response — this handles async payment methods (BACS, bank transfers)

## Invariants
- `RequirePlan` MUST read entitlement from DB — never from JWT claims — so downgrades/upgrades take effect on the next request
- Webhook handlers MUST verify the Stripe signature via `stripe.ConstructEvent` before processing — return 400 on failure
- Webhook handlers MUST be idempotent — Stripe replays events on timeout/failure
- Plan names in the DB are: `artist_basic`, `artist_pro`, `festival_annual` — never Stripe Price IDs, never display names
- `subscriptions.stripe_subscription_id` has a unique constraint — INSERT must use `ON CONFLICT DO UPDATE` to handle replayed `checkout.session.completed` events

## AI Context
- `stripe.go`: `NewStripeClient`, `Prices` struct, `PlanFromPriceID`, `IntervalFromPriceID` — utility mapping between Stripe price IDs and internal plan names
- `artist.go`: `ArtistCheckoutHandler`, `ArtistPortalHandler` — artist subscription flows
- `organiser.go`: `OrganiserCheckoutHandler` — organiser/festival billing flows
- `webhook.go`: all Stripe webhook handling — idempotency logic and subscription state transitions live here
- `middleware.go`: `RequirePlan(plan)` — route-level billing gate
- `entitlement.go`: `CanPublish` — the handler-level entitlement check used when you need a bool not a middleware
- `testsupport.go`: `GrantTestHandler` — **test-only** endpoint (wired at `POST /_test/grant` in `main.go`) that mints a 24h `artist_basic`/`artist_pro` grant for the calling principal, so e2e tests and the UI health sweep satisfy `CanPublish` without Stripe or an admin session. Like all `/_test/` routes, prod safety relies on the deployment not exposing the path, not a code guard.
- `festival.go`: festival billing helpers
- `Prices` is constructed in `api/cmd/api/main.go` from env vars — if a price ID is blank, `PlanFromPriceID` returns `"unknown"` and the checkout will fail with a Stripe 400

## Changelog
2026-05-31 — initial spec
2026-06-12 — added `GrantTestHandler` (`testsupport.go`, `POST /_test/grant`): test-only entitlement backdoor so e2e/tooling can satisfy the publish gate without Stripe/admin
