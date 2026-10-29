'use client'

import { de, enGB } from 'date-fns/locale'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { api } from './api'
import { calendarClassNames } from './classNames'
import { t, type Locale } from './i18n'

type Id = string | number
interface Slot { start: string; end: string }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` // the visitor's own calendar day
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

export interface SlotPickerProps {
  productId: Id
  /** Chosen option ids: they change the duration, so the free slots depend on them. */
  options?: string[]
  locale?: Locale
  /** Where to go after the slot is reserved (it is in the cart then). Default `/checkout`. */
  checkoutHref?: string
  loginHref?: string
  /** Name of the query parameter the login page reads to come back here. Default `redirect`. */
  loginRedirectParam?: string
  className?: string
  /** Overrides single classes of the calendar (react-day-picker `classNames` keys), merged over the defaults. */
  classNames?: Partial<Record<keyof typeof calendarClassNames, string>>
  /** Called after a successful reservation instead of navigating. */
  onReserved?: (r: { bookingID: Id; cartID: Id; priceCents: number; holdExpiresAt: string }) => void
}

/**
 * Calendar plus time buttons. Days without free slots are disabled; slots come from the server for the visible month and are shown in
 * the visitor's own time zone. Picking a time reserves it (it goes into the cart) and continues to checkout.
 */
export function SlotPicker({ productId, options = [], locale = 'de', checkoutHref = '/checkout', loginHref = '/login', loginRedirectParam = 'redirect', className = '', classNames, onReserved }: SlotPickerProps) {
  const L = t(locale)
  const optionKey = options.join(',')
  const [month, setMonth] = useState(() => monthStart(new Date()))
  const [cache, setCache] = useState<Record<string, Slot[]>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [day, setDay] = useState<Date | undefined>()
  const [slot, setSlot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const advanced = useRef(0)
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const key = (m: Date) => `${optionKey}|${m.getFullYear()}-${m.getMonth()}`

  const load = useCallback(async (m: Date): Promise<Slot[]> => {
    const k = `${optionKey}|${m.getFullYear()}-${m.getMonth()}`
    const from = new Date(Math.max(m.getTime(), Date.now()))
    const to = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    setLoading(k)
    const r = await api<{ slots?: Slot[] }>(`/booking/slots?product=${productId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${optionKey ? `&options=${encodeURIComponent(optionKey)}` : ''}`)
    const slots = r.ok ? (r.data.slots ?? []) : []
    setCache((c) => ({ ...c, [k]: slots }))
    setLoading((l) => (l === k ? null : l))
    return slots
  }, [productId, optionKey])

  // new options = new durations = other free slots
  useEffect(() => { setCache({}); setSlot(null); setDay(undefined); advanced.current = 0 }, [optionKey])

  useEffect(() => {
    if (cache[key(month)]) return
    let live = true
    load(month).then((slots) => {
      // the current month can be used up: show the next one with something free (at most a few months ahead)
      if (live && slots.length === 0 && advanced.current < 3 && !day) { advanced.current++; setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)) }
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, optionKey, load])

  const slots = cache[key(month)] ?? []
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>()
    for (const s of slots) { const k = dayKey(new Date(s.start)); m.set(k, [...(m.get(k) ?? []), s]) }
    return m
  }, [slots])
  const times = day ? (byDay.get(dayKey(day)) ?? []) : []
  const fmtTime = (iso: string) => new Intl.DateTimeFormat(locale === 'de' ? 'de-AT' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  const isLoading = loading === key(month)

  async function reserve() {
    if (!slot) return
    setBusy(true)
    setError(null)
    const r = await api<any>('/booking/hold', { body: { product: productId, start: slot, options } })
    if (r.status === 401) {
      window.location.assign(`${loginHref}?${loginRedirectParam}=${encodeURIComponent(window.location.pathname + window.location.search)}`)
      return
    }
    if (!r.ok) {
      setBusy(false)
      setError(r.status === 409 ? L.errTaken : r.status === 429 ? L.errTooMany : L.errGeneric)
      if (r.status === 409) { setSlot(null); setCache({}); void load(month) }
      return
    }
    if (onReserved) { setBusy(false); onReserved(r.data); return }
    window.location.assign(checkoutHref)
  }

  const noSlotsAtAll = !isLoading && slots.length === 0 && advanced.current >= 3

  return (
    <div className={`grid gap-8 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] ${className}`}>
      <div>
        <DayPicker
          mode="single"
          locale={locale === 'de' ? de : enGB}
          weekStartsOn={1}
          labels={locale === 'de' ? { labelPrevious: () => 'Voriger Monat', labelNext: () => 'Nächster Monat' } : undefined}
          month={month}
          onMonthChange={(m) => { setMonth(monthStart(m)); setDay(undefined); setSlot(null) }}
          selected={day}
          onSelect={(d) => { setDay(d); setSlot(null); setError(null) }}
          startMonth={monthStart(new Date())}
          disabled={(d) => !byDay.has(dayKey(d))}
          showOutsideDays={false}
          classNames={{ ...calendarClassNames, ...classNames }}
        />
        {isLoading && <p className="mt-3 flex items-center gap-2 text-sm text-neutral-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{L.loading}</p>}
        {!isLoading && slots.length === 0 && <p className="mt-3 text-sm text-neutral-600">{noSlotsAtAll ? L.noSlotsAtAll : L.noSlotsMonth}</p>}
      </div>

      <div aria-live="polite">
        <h3 className="m-0 font-display text-xl text-primary-950">{day ? new Intl.DateTimeFormat(locale === 'de' ? 'de-AT' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(day) : L.times}</h3>
        {!day ? (
          <p className="mt-2 text-neutral-600">{slots.length ? L.chooseDay : ''}</p>
        ) : (
          <>
            <ul className="mt-4 grid list-none gap-2 p-0 [grid-template-columns:repeat(auto-fill,minmax(5.5rem,1fr))]">
              {times.map((s) => (
                <li key={s.start} className="m-0">
                  <button type="button" aria-pressed={slot === s.start} onClick={() => { setSlot(s.start); setError(null) }}
                    className={`w-full whitespace-nowrap rounded-full border px-3 py-2 text-[0.95rem] font-medium tabular-nums transition-colors ${slot === s.start ? 'border-primary-700 bg-primary-700 text-white' : 'border-neutral-300 bg-white text-neutral-800 hover:border-primary-400 hover:bg-primary-50'}`}>
                    {fmtTime(s.start)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-neutral-500">{L.timesIn(tz)}</p>
          </>
        )}
        {slot && (
          <div className="mt-6">
            <button type="button" onClick={reserve} disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-600 px-7 py-3 text-base font-medium text-white transition-colors duration-300 hover:bg-primary-700 disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{busy ? L.reserving : L.reserve}
            </button>
            <p className="mt-2 text-sm text-neutral-600">{L.reservedHint}</p>
          </div>
        )}
        {error && <p role="alert" className="mt-4 rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-900">{error}</p>}
      </div>
    </div>
  )
}
