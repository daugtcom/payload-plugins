/**
 * Framework-free access rules. No I/O, no Payload imports.
 * All instants are JS Dates (UTC). `null` means "open".
 */

/** The part of an entitlement the rules care about. */
export interface EntitlementWindow {
  /** Access begins at this instant (inclusive). null = from the beginning. */
  start: Date | null
  /** Access ends at this instant (exclusive). null = never. */
  end: Date | null
  /** After `end` the target stays reachable (only meaningful when `end` is set). */
  keepAccessibleAfterExpiry: boolean
  /** While the window is active, the whole series is unlocked regardless of item dates. */
  keepUnlockedWhenActive: boolean
}

export interface Timeslot {
  start: Date | null
  end: Date | null
}

export interface Timeslots {
  /** true = every item of the series is reachable (no date restriction). */
  unrestricted: boolean
  slots: Timeslot[]
}
