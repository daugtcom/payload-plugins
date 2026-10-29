import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ICAL from 'ical.js'
import { DateTime, IANAZone } from 'luxon'
import type { Interval } from './slots'

const toDate = (t: ICAL.Time, tzid: string | undefined, fallbackZone: string): Date => {
  if (t.isDate) return DateTime.fromObject({ year: t.year, month: t.month, day: t.day }, { zone: fallbackZone }).toJSDate()
  if (t.zone === ICAL.Timezone.utcTimezone || tzid === 'UTC') return t.toJSDate()
  const zone = tzid && IANAZone.isValidZone(tzid) ? tzid : fallbackZone
  // wall-clock components in the event's own zone, so a weekly 10:00 event stays 10:00 across daylight-saving changes
  return DateTime.fromObject({ year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second }, { zone }).toJSDate()
}

/**
 * Busy intervals of an iCalendar text that touch [from, to). Handles recurring events (RRULE, EXDATE, moved occurrences), all-day
 * events and zones that the file does not define itself (common IANA names). Cancelled and "free" (TRANSP:TRANSPARENT) events do not block, unless `includeFree`
 * (used for "available" calendars, where the events ARE the open times and Google marks them as free).
 */
export function parseBusy(ics: string, from: Date, to: Date, fallbackZone = 'Europe/Vienna', includeFree = false): Interval[] {
  const root = new ICAL.Component(ICAL.parse(ics))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)

  const events = root.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v))
  const byUid = new Map<string, ICAL.Event>()
  for (const e of events) if (!e.isRecurrenceException()) byUid.set(e.uid, e)
  for (const e of events) if (e.isRecurrenceException()) byUid.get(e.uid)?.relateException(e)

  const out: Interval[] = []
  const tzidOf = (e: ICAL.Event) => (e.component.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined) ?? undefined
  for (const e of byUid.values()) {
    const status = String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase()
    const transp = String(e.component.getFirstPropertyValue('transp') ?? '').toUpperCase()
    if (status === 'CANCELLED' || (transp === 'TRANSPARENT' && !includeFree)) continue
    const tzid = tzidOf(e)
    const push = (s: ICAL.Time, en: ICAL.Time) => {
      const start = toDate(s, tzid, fallbackZone)
      const end = toDate(en, tzidOf(e), fallbackZone)
      if (end > from && start < to) out.push({ start, end: end > start ? end : new Date(start.getTime() + 60_000) })
    }
    if (!e.isRecurring()) {
      push(e.startDate, e.endDate)
      continue
    }
    const it = e.iterator()
    for (let n = 0, next = it.next(); next && n < 5000; next = it.next(), n++) {
      const d = e.getOccurrenceDetails(next)
      if (toDate(d.startDate, tzid, fallbackZone) >= to) break
      push(d.startDate, d.endDate)
    }
  }
  return out
}

const cache = new Map<string, { at: number; text: string | null }>()

/** The text of a calendar source (`file:` for development, `https:` for a Google/Apple secret address). A failure is remembered briefly and counts as "nothing busy". */
export async function fetchIcs(url: string, o: { cacheSeconds?: number; timeoutMs?: number; warn?: (msg: string) => void } = {}): Promise<string | null> {
  const hit = cache.get(url)
  const ttl = (o.cacheSeconds ?? 300) * 1000
  if (hit && Date.now() - hit.at < (hit.text === null ? Math.min(ttl, 60_000) : ttl)) return hit.text
  let text: string | null = null
  try {
    if (url.startsWith('file:')) text = await readFile(fileURLToPath(url), 'utf8')
    else {
      const res = await fetch(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 5000), headers: { accept: 'text/calendar' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      text = await res.text()
    }
  } catch (err) {
    o.warn?.(`Calendar ${url.replace(/\?.*$/, '')} could not be read: ${(err as Error).message}`)
  }
  cache.set(url, { at: Date.now(), text })
  return text
}

export const clearIcsCache = () => cache.clear()

export async function loadBusy(sources: readonly { url: string }[], from: Date, to: Date, o: { timezone: string; cacheSeconds?: number; includeFree?: boolean; warn?: (msg: string) => void }): Promise<Interval[]> {
  const all = await Promise.all(
    sources.map(async (s) => {
      const text = await fetchIcs(s.url, o)
      if (!text) return []
      try {
        return parseBusy(text, from, to, o.timezone, o.includeFree)
      } catch (err) {
        o.warn?.(`Calendar ${s.url.replace(/\?.*$/, '')} is not valid iCalendar: ${(err as Error).message}`)
        return []
      }
    }),
  )
  return all.flat()
}

// ------------------------------------------------------------------ outgoing: the file in the confirmation email

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const utc = (d: Date) => DateTime.fromJSDate(d, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'")
/** RFC 5545: lines are at most 75 octets, continuation lines start with a space. */
const fold = (line: string): string => {
  const bytes = Buffer.from(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let cur = ''
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (parts.length ? 74 : 75)) { parts.push(cur); cur = '' }
    cur += ch
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

export interface IcsEvent { uid: string; start: Date; end: Date; summary: string; description?: string; location?: string; url?: string; cancelled?: boolean; sequence?: number }

export function buildIcs(e: IcsEvent, o: { prodId?: string; now?: Date } = {}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${o.prodId ?? '-//daugt//payload-booking//DE'}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${e.cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${utc(o.now ?? new Date())}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(e.end)}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    `SUMMARY:${esc(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
