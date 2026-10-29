import type { EntitlementWindow } from './types'
import { accessTimeslots, isDateInSlots } from './timeslots'
import { canAccessTarget } from './validity'

export interface SeriesItemInput {
  at: Date
  isStaff: boolean
  /** The item's date. Items dated after `at` are not published yet. */
  publishedAt: Date | null
  /** One list of entitlements per series the item belongs to. */
  seriesEntitlements: readonly (readonly EntitlementWindow[])[]
  /** Entitlements granted directly on the item. */
  directEntitlements: readonly EntitlementWindow[]
  /**
   * The item is open to everyone with ANY entitlement on one of its series,
   * whatever that entitlement's dates are (legacy behavior, kept for parity).
   */
  freeForAll: boolean
}

/** May the user see this series item? */
export function canViewSeriesItem(i: SeriesItemInput): boolean {
  if (i.isStaff) return true
  if (!i.publishedAt || i.publishedAt.getTime() > i.at.getTime()) return false

  for (const entitlements of i.seriesEntitlements) {
    if (i.freeForAll && entitlements.length > 0) return true
    const { unrestricted, slots } = accessTimeslots(entitlements, i.at)
    if (unrestricted) return true
    if (isDateInSlots(i.publishedAt, slots)) return true
  }

  return canAccessTarget(i.directEntitlements, i.at)
}
