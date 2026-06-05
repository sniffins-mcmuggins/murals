// Minimal index math for the triage overlay. Kept pure so it is unit-testable
// independently of React. Accepts any object with a `shortlisted` flag.
export function initialTriageIndex(apps: { shortlisted?: boolean | null }[]): number {
  const i = apps.findIndex(a => !a.shortlisted)
  return i === -1 ? 0 : i
}

export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0
  return Math.max(0, Math.min(i, len - 1))
}
