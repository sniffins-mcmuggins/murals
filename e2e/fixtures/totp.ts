// Mirrors api/internal/auth/totp.go which uses pquerna/otp defaults
// (RFC 6238: SHA1, 6 digits, 30s period). Those are otplib's defaults too,
// so codes match. The `secret` field returned by /auth/mfa/enroll is base32
// and feeds directly into generateSync.
import { generateSync } from 'otplib'

export function totpCode(base32Secret: string, when: Date = new Date()): string {
  return generateSync({
    secret: base32Secret,
    epoch: Math.floor(when.getTime() / 1000),
  })
}
