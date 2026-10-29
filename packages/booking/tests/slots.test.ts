import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { blockOf, computeSlots, type SlotInput } from '../src/slots'

const TZ = 'Europe/Vienna'
const d = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate()
const local = (date: Date) => DateTime.fromJSDate(date, { zone: TZ }).toFormat('yyyy-LL-dd HH:mm')

const base = (o: Partial<SlotInput> = {}): SlotInput => ({
  rules: [{ weekday: 2, from: '10:00', to: '13:00' }], // Tuesdays
  durationMinutes: 60,
  timezone: TZ,
  now: d('2026-11-01T08:00'),
  from: d('2026-11-03T00:00'),
  to: d('2026-11-04T00:00'),
  ...o,
})

describe('computeSlots', () => {
  it('opens a window on its weekday in steps of 30 minutes, the appointment fitting inside', () => {
    expect(computeSlots(base()).map((s) => local(s.start))).toEqual(['2026-11-03 10:00', '2026-11-03 10:30', '2026-11-03 11:00', '2026-11-03 11:30', '2026-11-03 12:00'])
  })

  it('has no slots on other weekdays', () => {
    expect(computeSlots(base({ from: d('2026-11-04T00:00'), to: d('2026-11-05T00:00') }))).toEqual([])
  })

  it('a closed exception removes the day, a window exception replaces the weekly one', () => {
    expect(computeSlots(base({ exceptions: [{ date: '2026-11-03', closed: true }] }))).toEqual([])
    const r = computeSlots(base({ exceptions: [{ date: '2026-11-03', from: '15:00', to: '16:30' }] }))
    expect(r.map((s) => local(s.start))).toEqual(['2026-11-03 15:00', '2026-11-03 15:30'])
  })

  it('supports several windows a day (lunch break)', () => {
    const r = computeSlots(base({ rules: [{ weekday: 2, from: '09:00', to: '10:00' }, { weekday: 2, from: '14:00', to: '15:00' }] }))
    expect(r.map((s) => local(s.start))).toEqual(['2026-11-03 09:00', '2026-11-03 14:00'])
  })

  it('respects the minimum notice and the booking horizon', () => {
    const notice = computeSlots(base({ now: d('2026-11-03T08:00'), minNoticeHours: 3 })) // earliest 11:00
    expect(notice.map((s) => local(s.start))[0]).toBe('2026-11-03 11:00')
    expect(computeSlots(base({ now: d('2026-10-01T08:00'), maxAdvanceDays: 7 }))).toEqual([])
    expect(computeSlots(base({ now: d('2026-10-28T08:00'), maxAdvanceDays: 7 }))).not.toEqual([])
  })

  it('removes slots that touch busy calendar time', () => {
    const r = computeSlots(base({ busy: [{ start: d('2026-11-03T10:45'), end: d('2026-11-03T11:15') }] }))
    // 10:00-11:00 overlaps 10:45, 10:30-11:30 and 11:00-12:00 overlap too, 11:30 is free again
    expect(r.map((s) => local(s.start))).toEqual(['2026-11-03 11:30', '2026-11-03 12:00'])
  })

  it('treats existing bookings as occupied blocks (their buffers included)', () => {
    const existing = blockOf(d('2026-11-03T10:00'), 60, 0, 15) // 10:00-11:15
    const r = computeSlots(base({ bookings: [existing] }))
    expect(r.map((s) => local(s.start))).toEqual(['2026-11-03 11:30', '2026-11-03 12:00'])
  })

  it('keeps its own buffers free: a new slot may not sit closer to a neighbour than the buffer', () => {
    const existing = blockOf(d('2026-11-03T10:00'), 60) // 10:00-11:00, no buffer
    const noBuffer = computeSlots(base({ bookings: [existing] })).map((s) => local(s.start))
    expect(noBuffer[0]).toBe('2026-11-03 11:00')
    const buffered = computeSlots(base({ bookings: [existing], bufferBeforeMinutes: 30 })).map((s) => local(s.start))
    expect(buffered[0]).toBe('2026-11-03 11:30') // 30 free minutes before the new appointment
  })

  it('a buffer may stick out of the opening window', () => {
    const r = computeSlots(base({ rules: [{ weekday: 2, from: '10:00', to: '11:00' }], bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }))
    expect(r.map((s) => local(s.start))).toEqual(['2026-11-03 10:00'])
  })

  it('a longer appointment needs a longer free gap', () => {
    const r = computeSlots(base({ durationMinutes: 120, busy: [{ start: d('2026-11-03T12:00'), end: d('2026-11-03T13:00') }] }))
    expect(r.map((s) => local(s.start))).toEqual(['2026-11-03 10:00'])
  })

  it('stays at the same local time across the daylight-saving change (29 March 2026)', () => {
    const rules = [{ weekday: 7, from: '09:00', to: '10:00' }, { weekday: 6, from: '09:00', to: '10:00' }]
    const r = computeSlots(base({ rules, now: d('2026-03-20T08:00'), from: d('2026-03-28T00:00'), to: d('2026-03-30T00:00') }))
    expect(r.map((s) => local(s.start))).toEqual(['2026-03-28 09:00', '2026-03-29 09:00'])
    // 23 hours apart in absolute time: the day before the switch is one hour longer than the offset suggests
    expect(r[1]!.start.getTime() - r[0]!.start.getTime()).toBe(23 * 3_600_000)
  })

  it('counts real hours in a window that spans the change (25 hours / 23 hours days)', () => {
    const rules = [{ weekday: 7, from: '00:00', to: '06:00' }]
    const spring = computeSlots(base({ rules, durationMinutes: 60, stepMinutes: 60, now: d('2026-03-20T08:00'), from: d('2026-03-29T00:00'), to: d('2026-03-30T00:00') }))
    expect(spring).toHaveLength(5) // 02:00 does not exist
    const autumn = computeSlots(base({ rules, durationMinutes: 60, stepMinutes: 60, now: d('2026-10-20T08:00'), from: d('2026-10-25T00:00'), to: d('2026-10-26T00:00') }))
    expect(autumn).toHaveLength(7) // 02:00 happens twice
  })

  it('only returns starts inside [from, to)', () => {
    const r = computeSlots(base({ from: d('2026-11-03T11:00'), to: d('2026-11-03T12:00') }))
    expect(r.map((s) => local(s.start))).toEqual(['2026-11-03 11:00', '2026-11-03 11:30'])
  })

  it('ignores malformed windows instead of throwing', () => {
    expect(computeSlots(base({ rules: [{ weekday: 2, from: 'abc', to: '12:00' }, { weekday: 2, from: '12:00', to: '10:00' }] }))).toEqual([])
  })

  it('"available" intervals replace the weekly rules; busy time and closed days still subtract', () => {
    const available = [{ start: d('2026-11-04T13:00'), end: d('2026-11-04T16:00') }] // a Wednesday, rules only open Tuesdays
    const from = d('2026-11-03T00:00'), to = d('2026-11-06T00:00')
    expect(computeSlots(base({ available, from, to })).map((s) => local(s.start))).toEqual(['2026-11-04 13:00', '2026-11-04 13:30', '2026-11-04 14:00', '2026-11-04 14:30', '2026-11-04 15:00'])
    expect(computeSlots(base({ available, from, to, busy: [{ start: d('2026-11-04T14:00'), end: d('2026-11-04T15:00') }] })).map((s) => local(s.start))).toEqual(['2026-11-04 13:00', '2026-11-04 15:00'])
    expect(computeSlots(base({ available, from, to, exceptions: [{ date: '2026-11-04', closed: true }] }))).toEqual([])
    expect(computeSlots(base({ available: [], from, to }))).toEqual([]) // an available calendar with nothing in it: nothing is bookable
  })
})
