import type { DayException, WeeklyRule } from './slots'

export interface BookingOption { id: string; label: string; priceDeltaCents: number; durationDeltaMinutes: number; /** Choosing it records the video call. */ recording?: boolean }

/** The public facts of a bookable product: what the booking widget and the engine work with. */
export interface Bookable {
  id: string | number
  title: string
  /** Base price in minor units, tax inclusive. */
  priceCents: number
  resource: string
  durationMinutes: number
  stepMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minNoticeHours: number
  maxAdvanceDays: number
  cancellationHours: number
  location: 'online' | 'phone' | 'inperson'
  rules: WeeklyRule[]
  exceptions: DayException[]
  options: BookingOption[]
}

type Doc = Record<string, any>

/** Reads the `booking` group of a product document (any depth). `null` when the product is not an enabled, published appointment. */
export function bookableOf(doc: Doc | null | undefined): Bookable | null {
  const b = doc?.booking
  if (!doc || !b?.enabled) return null
  if (doc._status && doc._status !== 'published') return null
  return {
    id: doc.id,
    title: String(doc.title ?? ''),
    priceCents: doc.priceInEURENABLED === false ? 0 : Number(doc.priceInEUR ?? 0),
    resource: b.resource || 'default',
    durationMinutes: Number(b.durationMinutes) || 60,
    stepMinutes: Number(b.stepMinutes) || 30,
    bufferBeforeMinutes: Number(b.bufferBeforeMinutes) || 0,
    bufferAfterMinutes: Number(b.bufferAfterMinutes) || 0,
    minNoticeHours: b.minNoticeHours == null ? 24 : Number(b.minNoticeHours),
    maxAdvanceDays: b.maxAdvanceDays == null ? 60 : Number(b.maxAdvanceDays),
    cancellationHours: b.cancellationHours == null ? 48 : Number(b.cancellationHours),
    location: b.location === 'phone' || b.location === 'inperson' ? b.location : 'online',
    rules: ((b.weekly ?? []) as Doc[]).map((r) => ({ weekday: Number(r.weekday), from: String(r.from ?? ''), to: String(r.to ?? '') })),
    exceptions: ((b.exceptions ?? []) as Doc[]).map((e) => ({ date: String(e.date ?? ''), closed: Boolean(e.closed), from: e.from ?? null, to: e.to ?? null })),
    options: ((b.options ?? []) as Doc[]).filter((o) => o.id && o.label).map((o) => ({ id: String(o.id), label: String(o.label), priceDeltaCents: Number(o.priceDeltaCents) || 0, durationDeltaMinutes: Number(o.durationDeltaMinutes) || 0, ...(o.recording ? { recording: true } : {}) })),
  }
}

/** What the browser needs to render the widget (no opening hours: slots come from the server). */
export interface BookableInfo {
  id: string | number
  title: string
  priceCents: number
  durationMinutes: number
  cancellationHours: number
  location: Bookable['location']
  options: BookingOption[]
}

export const bookableInfo = (doc: Doc | null | undefined): BookableInfo | null => {
  const b = bookableOf(doc)
  return b && { id: b.id, title: b.title, priceCents: b.priceCents, durationMinutes: b.durationMinutes, cancellationHours: b.cancellationHours, location: b.location, options: b.options }
}

export class BookingError extends Error {
  constructor(public code: string, public status = 400, message?: string) {
    super(message ?? code)
  }
}

/** Duration and price of a product with the chosen options. Unknown option ids are an error, so the client cannot invent prices. */
export function priceOf(b: Bookable, optionIds: readonly string[]): { durationMinutes: number; priceCents: number; chosen: BookingOption[] } {
  const ids = [...new Set(optionIds)]
  const chosen = ids.map((id) => {
    const o = b.options.find((x) => x.id === id)
    if (!o) throw new BookingError('unknown-option', 400, `Unknown option ${id}`)
    return o
  })
  return {
    chosen,
    durationMinutes: b.durationMinutes + chosen.reduce((n, o) => n + o.durationDeltaMinutes, 0),
    priceCents: b.priceCents + chosen.reduce((n, o) => n + o.priceDeltaCents, 0),
  }
}
