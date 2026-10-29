'use client'

import { euro, t, type Locale } from './i18n'

export interface OptionInfo { id: string; label: string; priceDeltaCents: number; durationDeltaMinutes: number }

/** The extras of an appointment as checkboxes, each with what it adds. */
export function BookingOptions({ options, value, onChange, locale = 'de', className = '' }: { options: OptionInfo[]; value: string[]; onChange: (ids: string[]) => void; locale?: Locale; className?: string }) {
  const L = t(locale)
  if (!options.length) return null
  return (
    <fieldset className={`m-0 border-0 p-0 ${className}`}>
      <legend className="mb-2 p-0 text-sm font-semibold uppercase tracking-[0.14em] text-primary-700">{L.options}</legend>
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const on = value.includes(o.id)
          const adds = [o.durationDeltaMinutes ? `+${o.durationDeltaMinutes} min` : '', o.priceDeltaCents ? `${o.priceDeltaCents > 0 ? '+' : ''}${euro(o.priceDeltaCents, locale)}` : ''].filter(Boolean).join(' · ')
          return (
            <label key={o.id} className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border px-4 py-3 transition-colors ${on ? 'border-primary-600 bg-primary-50' : 'border-neutral-200 bg-white hover:border-primary-300'}`}>
              <span className="flex items-center gap-3">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} className="h-4 w-4" />
                <span className="font-medium text-neutral-900">{o.label}</span>
              </span>
              {adds && <span className="shrink-0 text-sm text-neutral-600">{adds}</span>}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
