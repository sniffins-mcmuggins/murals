// Thin HTTP helpers for the auth endpoints touched by E14 tests.
// Re-exports the DB and TOTP helpers so callers can import everything
// from one place.
import { injectResetToken, getLatestResetTokenHash } from './reset-token.js'
import { totpCode } from './totp.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

export async function requestPasswordReset(email: string): Promise<Response> {
  return fetch(`${API}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

export async function resetPassword(token: string, newPassword: string): Promise<Response> {
  return fetch(`${API}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  })
}

export interface MFAEnrolResponse {
  secret: string
  qrDataUrl: string
}

export async function enrollMFA(token: string, currentCode?: string): Promise<MFAEnrolResponse> {
  const body = currentCode ? JSON.stringify({ current_code: currentCode }) : '{}'
  const res = await fetch(`${API}/auth/mfa/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  })
  if (!res.ok) throw new Error(`MFA enroll failed: ${res.status}`)
  const data = await res.json()
  return { secret: data.secret, qrDataUrl: data.qr_data_url }
}

export async function confirmMFA(token: string, code: string): Promise<Response> {
  return fetch(`${API}/auth/mfa/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  })
}

export async function verifyMFA(mfaToken: string, code: string): Promise<Response> {
  return fetch(`${API}/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mfaToken}` },
    body: JSON.stringify({ code }),
  })
}

export { injectResetToken, getLatestResetTokenHash, totpCode }
