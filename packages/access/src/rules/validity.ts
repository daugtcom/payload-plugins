import type { EntitlementWindow } from './types'

const before = (a: Date, b: Date) => a.getTime() < b.getTime()
const atOrAfter = (a: Date, b: Date) => a.getTime() >= b.getTime()

/**
 * Active = inside [start, end). The keep flag is deliberately ignored here.
 * End is exclusive (the legacy app was inclusive; it only matters at the exact instant).
 */
export function isActiveAt(start: Date | null, end: Date | null, at: Date): boolean {
  if (start && before(at, start)) return false
  if (end && atOrAfter(at, end)) return false
  return true
}

/** Is the entitlement currently granting access to its target? */
export function isValidAt(e: EntitlementWindow, at: Date): boolean {
  if (!e.start && !e.end) return true
  if (e.start && before(at, e.start)) return false
  if (!e.keepAccessibleAfterExpiry && e.end && atOrAfter(at, e.end)) return false
  return true
}

/** True if any of the entitlements grants access to the target at `at`. */
export function canAccessTarget(entitlements: readonly EntitlementWindow[], at: Date): boolean {
  return entitlements.some((e) => isValidAt(e, at))
}
