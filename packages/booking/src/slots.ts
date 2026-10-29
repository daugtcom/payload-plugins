import { DateTime } from 'luxon'

/** ISO weekday: 1 = Monday … 7 = Sunday (what luxon's `weekday` returns). */
export interface WeeklyRule { weekday: number; from: string; to: string }
/** `date` is `YYYY-MM-DD` in the plugin's time zone. `closed` blocks the day; otherwise `from`/`to` replace the weekly windows of that day. */
export interface DayException { date: string; closed?: boolean | null; from?: string | null; to?: string | null }
export interface Interval { start: Date; end: Date }
export interface Slot { start: Date; end: Date }

export interface SlotInput {
  rules: readonly WeeklyRule[]
  exceptions?: readonly DayException[]
  durationMinutes: number
  /** Free time kept before / after the appointment. They count as occupied, so neighbours cannot sit closer than this. */
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  minNoticeHours?: number
  maxAdvanceDays?: number
  timezone: string
  now: Date
  /** Time that is not available (calendar events). */
  busy?: readonly Interval[]
  /**
   * "Available" calendar mode: when given, these intervals ARE the open times and the weekly rules are ignored (day exceptions that
   * close a day still apply). Everything else (busy time, bookings, notice) subtracts as usual.
   */
  available?: readonly Interval[]
  /** The occupied blocks (buffers included) of existing bookings. */
  bookings?: readonly Interval[]
  /** Slots start inside [from, to). */
  from: Date
  to: Date
  /** Distance between possible start times. Default 30. */
  stepMinutes?: number
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/
export const isHHMM = (s: unknown): s is string => typeof s === 'string' && HHMM.test(s)

const at = (date: DateTime, hhmm: string): DateTime => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return date.set({ hour: h, minute: m, second: 0, millisecond: 0 })
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end

/** The block an appointment occupies: itself plus its buffers. */
export const blockOf = (start: Date, durationMinutes: number, before = 0, after = 0): Interval => ({
  start: new Date(start.getTime() - before * 60_000),
  end: new Date(start.getTime() + (durationMinutes + after) * 60_000),
})

/** The windows (local wall-clock times resolved in `zone`) a given day is open. */
function windowsOf(day: DateTime, rules: readonly WeeklyRule[], exceptions: readonly DayException[]): Interval[] {
  const ex = exceptions.find((e) => e.date === day.toISODate())
  const raw = ex ? (ex.closed || !isHHMM(ex.from) || !isHHMM(ex.to) ? [] : [{ from: ex.from, to: ex.to }]) : rules.filter((r) => r.weekday === day.weekday && isHHMM(r.from) && isHHMM(r.to))
  return raw.flatMap((w) => {
    const start = at(day, w.from)
    const end = at(day, w.to)
    return end > start ? [{ start: start.toJSDate(), end: end.toJSDate() }] : []
  })
}

/** Open windows of a day: from the "available" calendar when there is one (clipped to the day), else the weekly rules. */
function windowsFor(day: DateTime, i: SlotInput): Interval[] {
  if (!i.available) return windowsOf(day, i.rules, i.exceptions ?? [])
  if ((i.exceptions ?? []).some((e) => e.date === day.toISODate() && e.closed)) return []
  const from = day.toJSDate()
  const to = day.plus({ days: 1 }).startOf('day').toJSDate()
  return i.available.filter((w) => w.end > from && w.start < to).map((w) => ({ start: w.start < from ? from : w.start, end: w.end > to ? to : w.end }))
}

/**
 * Free start times, in order. Pure: everything it needs is passed in. Days and windows are local to `timezone`, so a 09:00 slot
 * stays 09:00 across daylight-saving changes. The appointment itself must fit into an opening window; its buffers may stick out.
 */
export function computeSlots(i: SlotInput): Slot[] {
  const step = Math.max(5, i.stepMinutes ?? 30)
  const before = i.bufferBeforeMinutes ?? 0
  const after = i.bufferAfterMinutes ?? 0
  const earliest = Math.max(i.from.getTime(), i.now.getTime() + (i.minNoticeHours ?? 0) * 3_600_000)
  const latest = Math.min(i.to.getTime(), i.maxAdvanceDays == null ? Infinity : i.now.getTime() + i.maxAdvanceDays * 86_400_000)
  const taken = [...(i.busy ?? []), ...(i.bookings ?? [])]
  const out: Slot[] = []

  // one day of slack on both sides: a window belongs to its local day, which can start before `from` in UTC
  let day = DateTime.fromJSDate(i.from, { zone: i.timezone }).startOf('day').minus({ days: 1 })
  const last = DateTime.fromJSDate(i.to, { zone: i.timezone }).startOf('day').plus({ days: 1 })
  for (; day <= last; day = day.plus({ days: 1 }).startOf('day')) {
    for (const w of windowsFor(day, i)) {
      for (let t = w.start.getTime(); t + i.durationMinutes * 60_000 <= w.end.getTime(); t += step * 60_000) {
        if (t < earliest || t >= latest) continue
        const start = new Date(t)
        const block = blockOf(start, i.durationMinutes, before, after)
        if (taken.some((x) => overlaps(block, x))) continue
        out.push({ start, end: new Date(t + i.durationMinutes * 60_000) })
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}
