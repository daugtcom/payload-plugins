import { describe, expect, it } from 'vitest'
import { applySubscriptionEnd, computeGrantWindow, type AccessRule } from '../src/access/grantWindow'

const d = (iso: string) => new Date(iso)
const PAID = d('2026-01-31T10:00:00Z')

const rule = (over: Partial<AccessRule>): AccessRule => ({
  mode: 'permanent',
  permanentFromPaymentDate: false,
  keepAccessibleAfterExpiry: false,
  keepUnlockedWhenActive: false,
  ...over,
})

describe('computeGrantWindow', () => {
  it('permanent: open window, or open-ended from the payment date', () => {
    expect(computeGrantWindow(rule({}), PAID)).toMatchObject({ start: null, end: null })
    expect(computeGrantWindow(rule({ permanentFromPaymentDate: true }), PAID)).toMatchObject({ start: PAID, end: null })
  })

  it('duration: starts at payment, ends after N units', () => {
    const w = (duration: number, unit: AccessRule['durationUnit']) => computeGrantWindow(rule({ mode: 'duration', duration, durationUnit: unit }), PAID)
    expect(w(3, 'hour').end).toEqual(d('2026-01-31T13:00:00Z'))
    expect(w(2, 'day').end).toEqual(d('2026-02-02T10:00:00Z'))
    expect(w(1, 'week').end).toEqual(d('2026-02-07T10:00:00Z'))
    expect(w(1, 'year').end).toEqual(d('2027-01-31T10:00:00Z'))
    expect(w(1, 'year').start).toEqual(PAID)
  })

  it('month arithmetic overflows like the legacy Carbon::add (Jan 31 + 1 month = Mar 3)', () => {
    const w = computeGrantWindow(rule({ mode: 'duration', duration: 1, durationUnit: 'month' }), PAID)
    expect(w.end).toEqual(d('2026-03-03T10:00:00Z'))
  })

  it('dates: fixed window from the rule, independent of the payment date', () => {
    const w = computeGrantWindow(rule({ mode: 'dates', start: d('2026-03-01T00:00:00Z'), end: d('2026-06-01T00:00:00Z') }), PAID)
    expect(w).toMatchObject({ start: d('2026-03-01T00:00:00Z'), end: d('2026-06-01T00:00:00Z') })
  })

  it('carries the per-rule flags onto the entitlement', () => {
    const w = computeGrantWindow(rule({ keepAccessibleAfterExpiry: true, keepUnlockedWhenActive: true }), PAID)
    expect(w).toMatchObject({ keepAccessibleAfterExpiry: true, keepUnlockedWhenActive: true })
  })

  it('a duration rule without duration/unit is a configuration error', () => {
    expect(() => computeGrantWindow(rule({ mode: 'duration' }), PAID)).toThrow(/duration/)
  })

  it('uses "now" when the payment date is unknown', () => {
    const now = d('2026-05-05T00:00:00Z')
    expect(computeGrantWindow(rule({ mode: 'duration', duration: 1, durationUnit: 'day' }), null, now).start).toEqual(now)
  })
})

describe('applySubscriptionEnd', () => {
  it('ends every window at the subscription end (also fixed-date rules), keeping the start', () => {
    const w = computeGrantWindow(rule({ mode: 'dates', start: d('2026-03-01T00:00:00Z'), end: d('2026-06-01T00:00:00Z') }), PAID)
    const ended = applySubscriptionEnd(w, d('2026-04-15T00:00:00Z'))
    expect(ended.start).toEqual(d('2026-03-01T00:00:00Z'))
    expect(ended.end).toEqual(d('2026-04-15T00:00:00Z'))
  })
})
