/**
 * How a purchased product turns into an entitlement window.
 * Pure. Mirrors the legacy `OrderItem::getInitialAccessTimestampsFromPivot` (see ARCHITECTURE.md §3.2).
 */
export type AccessMode = 'permanent' | 'duration' | 'dates'
export type DurationUnit = 'hour' | 'day' | 'week' | 'month' | 'year'

/** One access item of a product ("buying this unlocks that"). */
export interface AccessRule {
  mode: AccessMode
  /** permanent: open-ended, but only starting at the payment date. */
  permanentFromPaymentDate: boolean
  duration?: number | null
  durationUnit?: DurationUnit | null
  /** dates: fixed window. `end` is exclusive. */
  start?: Date | null
  end?: Date | null
  keepAccessibleAfterExpiry: boolean
  keepUnlockedWhenActive: boolean
}

export interface GrantWindow {
  start: Date | null
  end: Date | null
  keepAccessibleAfterExpiry: boolean
  keepUnlockedWhenActive: boolean
}

/** Calendar addition with the same overflow behaviour as the legacy Carbon::add (Jan 31 + 1 month = Mar 3). */
export function addUnits(date: Date, n: number, unit: DurationUnit): Date {
  const d = new Date(date)
  switch (unit) {
    case 'hour': d.setUTCHours(d.getUTCHours() + n); break
    case 'day': d.setUTCDate(d.getUTCDate() + n); break
    case 'week': d.setUTCDate(d.getUTCDate() + 7 * n); break
    case 'month': d.setUTCMonth(d.getUTCMonth() + n); break
    case 'year': d.setUTCFullYear(d.getUTCFullYear() + n); break
  }
  return d
}

export function computeGrantWindow(rule: AccessRule, paidAt: Date | null, now: Date = new Date()): GrantWindow {
  const flags = { keepAccessibleAfterExpiry: rule.keepAccessibleAfterExpiry, keepUnlockedWhenActive: rule.keepUnlockedWhenActive }
  const from = paidAt ?? now

  switch (rule.mode) {
    case 'permanent':
      return { start: rule.permanentFromPaymentDate ? from : null, end: null, ...flags }
    case 'duration': {
      if (!rule.duration || !rule.durationUnit) throw new Error('A duration access rule needs a duration and a unit')
      return { start: from, end: addUnits(from, rule.duration, rule.durationUnit), ...flags }
    }
    case 'dates':
      return { start: rule.start ?? null, end: rule.end ?? null, ...flags }
  }
}

/** A cancelled/ended subscription ends every window it granted at that instant. */
export function applySubscriptionEnd(window: GrantWindow, endsAt: Date): GrantWindow {
  return { ...window, end: endsAt }
}
