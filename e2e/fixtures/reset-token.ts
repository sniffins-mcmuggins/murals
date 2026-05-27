// Direct DB access for password-reset tests.
//
// /auth/forgot-password stores SHA-256(token) in password_reset_tokens; the raw
// token only exists in the email body, which the local NoopMailer discards.
// `injectResetToken` generates a token ourselves and inserts the hash so the
// caller can hit /auth/reset-password with the raw bytes. `getLatestResetTokenHash`
// lets a test confirm that the real ForgotPasswordHandler did insert a row.
import { randomBytes, createHash } from 'node:crypto'
import { Client } from 'pg'

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

export async function injectResetToken(userEmail: string): Promise<string> {
  const raw = randomBytes(32)
  const hash = createHash('sha256').update(raw).digest('hex')
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [userEmail.toLowerCase().trim()],
    )
    if (rows.length === 0) throw new Error(`user ${userEmail} not found`)
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + interval '1 hour')`,
      [rows[0].id, hash],
    )
  } finally {
    await client.end()
  }
  return raw.toString('hex')
}

export async function getLatestResetTokenHash(
  userEmail: string,
): Promise<string | null> {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{ token_hash: string }>(
      `SELECT t.token_hash FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE u.email = $1 AND t.used_at IS NULL
       ORDER BY t.created_at DESC LIMIT 1`,
      [userEmail.toLowerCase().trim()],
    )
    return rows[0]?.token_hash ?? null
  } finally {
    await client.end()
  }
}
