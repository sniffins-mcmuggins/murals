// db-helpers.ts
// DB-level test helpers for e2e tests that need to bypass API gates.
// These exist specifically for tests that test OTHER features with a public
// profile as a prerequisite — they must NOT be used to test the publish gate itself.
// Import `Client` from 'pg' in the test file and pass it here.
import type { Client } from 'pg'

// forcePublish sets a profile's visibility to 'public' directly in the DB,
// bypassing the entitlement gate. Use only in tests that are NOT testing the
// publish gate (social links, images, collections, analytics, etc.).
export async function forcePublish(db: Client, userId: string): Promise<void> {
  await db.query(
    `UPDATE artist_profiles SET visibility = 'public' WHERE user_id = $1`,
    [userId],
  )
}

// forceGrant inserts an access_grants row for the given user so they pass
// billing.CanPublish. Use only in tests that are NOT testing the grant flow.
// Uses the userId as granted_by (self-grant shortcut — valid FK, test-only).
export async function forceGrant(db: Client, userId: string, plan = 'artist_basic'): Promise<void> {
  await db.query(
    `INSERT INTO access_grants (user_id, plan, valid_until, granted_by)
     VALUES ($1, $2, now() + interval '30 days', $1)`,
    [userId, plan],
  )
}
