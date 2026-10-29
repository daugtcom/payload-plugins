import { describe, expect, it } from 'vitest'
import {
  accessTimeslots,
  canAccessTarget,
  canViewSeriesItem,
  isActiveAt,
  isDateInSlots,
  isValidAt,
  type EntitlementWindow,
} from '../src/rules'

const d = (iso: string) => new Date(iso)
const T0 = d('2026-01-01T00:00:00Z')
const T1 = d('2026-02-01T00:00:00Z')
const T2 = d('2026-03-01T00:00:00Z')
const T3 = d('2026-04-01T00:00:00Z')

const ent = (over: Partial<EntitlementWindow> = {}): EntitlementWindow => ({
  start: null,
  end: null,
  keepAccessibleAfterExpiry: false,
  keepUnlockedWhenActive: false,
  ...over,
})

describe('isValidAt', () => {
  it('is valid when both dates are open', () => {
    expect(isValidAt(ent(), T1)).toBe(true)
  })

  it('start only: invalid before, valid at and after start', () => {
    const e = ent({ start: T1 })
    expect(isValidAt(e, T0)).toBe(false)
    expect(isValidAt(e, T1)).toBe(true)
    expect(isValidAt(e, T3)).toBe(true)
  })

  it('end only: valid before end, invalid at (exclusive) and after end', () => {
    const e = ent({ end: T2 })
    expect(isValidAt(e, T1)).toBe(true)
    expect(isValidAt(e, T2)).toBe(false)
    expect(isValidAt(e, T3)).toBe(false)
  })

  it('keepAccessibleAfterExpiry keeps it valid after end but never before start', () => {
    const e = ent({ start: T1, end: T2, keepAccessibleAfterExpiry: true })
    expect(isValidAt(e, T0)).toBe(false)
    expect(isValidAt(e, T3)).toBe(true)
  })
})

describe('isActiveAt', () => {
  it('ignores the keep flag: active only inside [start, end)', () => {
    expect(isActiveAt(T1, T2, T0)).toBe(false)
    expect(isActiveAt(T1, T2, T1)).toBe(true)
    expect(isActiveAt(T1, T2, T2)).toBe(false)
    expect(isActiveAt(null, null, T3)).toBe(true)
  })
})

describe('accessTimeslots', () => {
  it('has no access without entitlements', () => {
    expect(accessTimeslots([], T1)).toEqual({ unrestricted: false, slots: [] })
  })

  it('an entitlement without any date is unrestricted', () => {
    expect(accessTimeslots([ent({ start: T1, end: T2 }), ent()], T1)).toEqual({
      unrestricted: true,
      slots: [],
    })
  })

  it('keepUnlockedWhenActive unlocks everything while the window is active, and keeps the slot', () => {
    const r = accessTimeslots([ent({ start: T0, end: T2, keepUnlockedWhenActive: true })], T1)
    expect(r.unrestricted).toBe(true)
    expect(r.slots).toEqual([{ start: T0, end: T2 }])
  })

  it('keepUnlockedWhenActive does nothing outside the window', () => {
    const r = accessTimeslots(
      [ent({ start: T0, end: T1, keepUnlockedWhenActive: true, keepAccessibleAfterExpiry: true })],
      T2,
    )
    expect(r.unrestricted).toBe(false)
    expect(r.slots).toEqual([{ start: T0, end: T1 }])
  })

  it('drops expired windows unless keepAccessibleAfterExpiry', () => {
    const expired = ent({ start: T0, end: T1 })
    const kept = ent({ start: T0, end: T1, keepAccessibleAfterExpiry: true })
    expect(accessTimeslots([expired], T2).slots).toEqual([])
    expect(accessTimeslots([kept], T2).slots).toEqual([{ start: T0, end: T1 }])
  })

  it('includes future windows (they only matter for item dates)', () => {
    expect(accessTimeslots([ent({ start: T2, end: T3 })], T0).slots).toEqual([{ start: T2, end: T3 }])
  })

  it('sorts by start, open start first', () => {
    const r = accessTimeslots(
      [ent({ start: T2, end: T3 }), ent({ start: null, end: T1 }), ent({ start: T1, end: T2 })],
      T0,
    )
    expect(r.slots.map((s) => s.start)).toEqual([null, T1, T2])
  })
})

describe('isDateInSlots', () => {
  const slots = [{ start: T1, end: T2 }]
  it('start inclusive, end exclusive', () => {
    expect(isDateInSlots(T0, slots)).toBe(false)
    expect(isDateInSlots(T1, slots)).toBe(true)
    expect(isDateInSlots(d('2026-02-28T23:59:59Z'), slots)).toBe(true)
    expect(isDateInSlots(T2, slots)).toBe(false)
  })
  it('open ends match everything on that side', () => {
    expect(isDateInSlots(T0, [{ start: null, end: T1 }])).toBe(true)
    expect(isDateInSlots(T3, [{ start: T1, end: null }])).toBe(true)
  })
  it('no date never matches', () => {
    expect(isDateInSlots(null, slots)).toBe(false)
  })
})

describe('canAccessTarget', () => {
  it('is true if any entitlement is valid', () => {
    expect(canAccessTarget([ent({ start: T2, end: T3 }), ent({ start: T0, end: T2 })], T1)).toBe(true)
    expect(canAccessTarget([ent({ start: T2, end: T3 })], T1)).toBe(false)
    expect(canAccessTarget([], T1)).toBe(false)
  })
})

describe('canViewSeriesItem', () => {
  const base = {
    at: T2,
    isStaff: false,
    publishedAt: T1,
    seriesEntitlements: [] as EntitlementWindow[][],
    directEntitlements: [] as EntitlementWindow[],
    freeForAll: false,
  }

  it('staff always may', () => {
    expect(canViewSeriesItem({ ...base, isStaff: true, publishedAt: T3 })).toBe(true)
  })

  it('nobody sees unpublished (future) items', () => {
    const open = [[ent()]]
    expect(canViewSeriesItem({ ...base, publishedAt: T3, seriesEntitlements: open })).toBe(false)
  })

  it('unrestricted series access shows every published item', () => {
    expect(canViewSeriesItem({ ...base, seriesEntitlements: [[ent()]] })).toBe(true)
  })

  it('drip: only items dated inside one of the access windows', () => {
    // member joined Feb 5; "today" is Feb 11
    const s = [[ent({ start: d('2026-02-05T00:00:00Z'), end: d('2027-02-05T00:00:00Z') })]]
    const at = d('2026-02-11T00:00:00Z')
    expect(canViewSeriesItem({ ...base, at, publishedAt: d('2026-02-08T00:00:00Z'), seriesEntitlements: s })).toBe(true)
    // published before the member joined: not part of their window
    expect(canViewSeriesItem({ ...base, at, publishedAt: d('2026-02-01T00:00:00Z'), seriesEntitlements: s })).toBe(false)
  })

  it('expired window with keepAccessibleAfterExpiry still shows items from inside that window only', () => {
    const s = [[ent({ start: T0, end: T1, keepAccessibleAfterExpiry: true })]]
    expect(canViewSeriesItem({ ...base, publishedAt: d('2026-01-10T00:00:00Z'), seriesEntitlements: s })).toBe(true)
    expect(canViewSeriesItem({ ...base, publishedAt: d('2026-02-20T00:00:00Z'), seriesEntitlements: s })).toBe(false)
  })

  it('keepUnlockedWhenActive shows later-dated published items while active', () => {
    const s = [[ent({ start: T0, end: T3, keepUnlockedWhenActive: true })]]
    expect(canViewSeriesItem({ ...base, publishedAt: d('2026-02-20T00:00:00Z'), seriesEntitlements: s })).toBe(true)
  })

  it('freeForAll bypasses the window for anyone with ANY grant on the series (even an expired, dropped one)', () => {
    const expiredDropped = [[ent({ start: T0, end: T1 })]]
    expect(
      canViewSeriesItem({ ...base, publishedAt: T1, freeForAll: true, seriesEntitlements: expiredDropped }),
    ).toBe(true)
    expect(canViewSeriesItem({ ...base, publishedAt: T1, freeForAll: true, seriesEntitlements: [[]] })).toBe(false)
  })

  it('any one of several series is enough', () => {
    const s = [[], [ent()]]
    expect(canViewSeriesItem({ ...base, seriesEntitlements: s })).toBe(true)
  })

  it('a direct entitlement works when valid, ignoring series', () => {
    expect(canViewSeriesItem({ ...base, directEntitlements: [ent({ start: T0, end: T3 })] })).toBe(true)
    expect(canViewSeriesItem({ ...base, directEntitlements: [ent({ start: T0, end: T1 })] })).toBe(false)
  })
})
