import type { EntitlementWindow, Timeslot, Timeslots } from './types'
import { isActiveAt } from './validity'

const compareStart = (a: Timeslot, b: Timeslot): number => {
  if (a.start === b.start) return 0
  if (a.start === null) return -1
  if (b.start === null) return 1
  return a.start.getTime() - b.start.getTime()
}

/**
 * The time windows during which a user has access to a series, derived from the
 * entitlements on that series.
 *
 * - An entitlement without any date makes the series unrestricted.
 * - `keepUnlockedWhenActive` makes it unrestricted while its window is active.
 * - Expired windows are dropped unless `keepAccessibleAfterExpiry`.
 * - Future windows are kept (they matter for item dates).
 */
export function accessTimeslots(entitlements: readonly EntitlementWindow[], at: Date): Timeslots {
  let unrestricted = false
  const slots: Timeslot[] = []

  for (const e of entitlements) {
    if (!e.start && !e.end) return { unrestricted: true, slots: [] }
    if (e.keepUnlockedWhenActive && isActiveAt(e.start, e.end, at)) unrestricted = true
    const expired = e.end !== null && at.getTime() >= e.end.getTime()
    if (expired && !e.keepAccessibleAfterExpiry) continue
    slots.push({ start: e.start, end: e.end })
  }

  slots.sort(compareStart)
  return { unrestricted, slots }
}

/** Is `date` inside any slot ([start, end), open ends allowed)? A missing date never matches. */
export function isDateInSlots(date: Date | null, slots: readonly Timeslot[]): boolean {
  if (!date) return false
  return slots.some((s) => isActiveAt(s.start, s.end, date))
}
