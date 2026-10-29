import { fileURLToPath, pathToFileURL } from 'node:url'
import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { buildIcs, clearIcsCache, loadBusy, parseBusy } from '../src/ics'

const fixture = fileURLToPath(new URL('../fixtures/busy.ics', import.meta.url))
const TZ = 'Europe/Vienna'
const z = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate()
const local = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toFormat('yyyy-LL-dd HH:mm')

describe('parseBusy', () => {
  const busy = (from: string, to: string) => loadBusy([{ url: pathToFileURL(fixture).href }], z(from), z(to), { timezone: TZ })

  it('expands a weekly recurring event and keeps its wall-clock time across the daylight-saving change', async () => {
    clearIcsCache()
    const r = await busy('2026-03-23T00:00', '2026-04-06T00:00')
    const tue = r.filter((i) => local(i.start).endsWith('10:00'))
    expect(tue.map((i) => local(i.start))).toEqual(['2026-03-24 10:00', '2026-03-31 10:00']) // 31 March is after the switch, still 10:00 local
    expect(tue.map((i) => (i.end.getTime() - i.start.getTime()) / 3_600_000)).toEqual([2, 2])
  })

  it('honours EXDATE, one-off events, all-day events and free time', async () => {
    clearIcsCache()
    const jan = await busy('2026-01-12T00:00', '2026-01-26T00:00')
    expect(jan.map((i) => local(i.start)).filter((s) => s.endsWith('14:00'))).toEqual(['2026-01-22 14:00']) // 15 Jan is excluded
    const nov = await busy('2026-11-01T00:00', '2026-11-30T00:00')
    const starts = nov.map((i) => local(i.start))
    expect(starts).toContain('2026-11-04 11:00')
    expect(starts).toContain('2026-11-26 00:00') // all-day
    expect(starts).not.toContain('2026-11-05 09:00') // TRANSP:TRANSPARENT
    const allDay = nov.find((i) => local(i.start) === '2026-11-26 00:00')!
    expect(local(allDay.end)).toBe('2026-11-27 00:00')
  })

  it('never fails: a missing file or garbage counts as nothing busy', async () => {
    clearIcsCache()
    const warnings: string[] = []
    const r = await loadBusy([{ url: 'file:///does/not/exist.ics' }], z('2026-11-01T00:00'), z('2026-11-30T00:00'), { timezone: TZ, warn: (m) => warnings.push(m) })
    expect(r).toEqual([])
    expect(warnings[0]).toMatch(/could not be read/)
    expect(() => parseBusy('not a calendar', new Date(), new Date())).toThrow()
  })

  it('understands UTC and floating times and moved occurrences', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:a', 'DTSTAMP:20260101T000000Z', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:a', 'DTSTAMP:20260101T000000Z', 'RECURRENCE-ID:20261111T090000Z', 'DTSTART:20261111T140000Z', 'DTEND:20261111T150000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b', 'DTSTAMP:20260101T000000Z', 'DTSTART:20261120T080000', 'DTEND:20261120T090000', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const r = parseBusy(ics, z('2026-11-01T00:00'), z('2026-12-01T00:00'), TZ).map((i) => i.start.toISOString())
    expect(r).toEqual(['2026-11-10T09:00:00.000Z', '2026-11-11T14:00:00.000Z', '2026-11-12T09:00:00.000Z', '2026-11-20T07:00:00.000Z'])
  })
})

describe('buildIcs', () => {
  it('writes a valid, escaped, folded VEVENT in UTC', () => {
    const text = buildIcs({ uid: 'b1@x', start: new Date('2026-11-04T09:00:00Z'), end: new Date('2026-11-04T10:00:00Z'), summary: 'Sitzung, Margaretha; "Deep Dive"', description: 'a'.repeat(200), location: 'Online', url: 'https://example.com/join' }, { now: new Date('2026-11-01T00:00:00Z') })
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('DTSTART:20261104T090000Z')
    expect(text).toContain('DTEND:20261104T100000Z')
    expect(text).toContain('SUMMARY:Sitzung\\, Margaretha\; "Deep Dive"')
    expect(text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
  it('marks a cancellation', () => {
    expect(buildIcs({ uid: 'b1@x', start: new Date(), end: new Date(), summary: 's', cancelled: true, sequence: 1 })).toContain('METHOD:CANCEL')
  })
})
