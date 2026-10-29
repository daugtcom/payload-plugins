/** Shipping cost for a basket and a destination. Pure. Port of statamic-commerce's ShippingRateCalculator. */

export interface ShippingSize {
  rates: { country: string; amount: number }[]
  fallbackRate?: number | null
}

export interface ShippingSettings {
  /** flat = one rate for everything, dynamic = per size and country. */
  mode: 'flat' | 'dynamic'
  /** Flat / last-resort rate in major currency units (euros). */
  flatRate: number | null
  /** Several shipped items: add them up, or charge only the most expensive one. */
  method: 'sum' | 'max'
  /** ISO-2 codes. Empty = no restriction. */
  allowedCountries: string[]
}

export interface ShippingLine {
  quantity: number
  requiresShipping: boolean
  size?: ShippingSize | null
}

const NAMES: Record<string, string> = {
  österreich: 'AT', austria: 'AT', oesterreich: 'AT',
  deutschland: 'DE', germany: 'DE',
  schweiz: 'CH', switzerland: 'CH',
}

/** ISO-2 code from an ISO code or a common country name. Unknown input yields ''. */
export function toIso2(country: string | null | undefined): string {
  if (!country) return ''
  const t = country.trim()
  if (/^[a-z]{2}$/i.test(t)) return t.toUpperCase()
  return NAMES[t.toLowerCase()] ?? ''
}

export function isCountryAllowed(country: string, s: ShippingSettings): boolean {
  if (s.allowedCountries.length === 0) return true
  return s.allowedCountries.map(toIso2).includes(toIso2(country))
}

function rateFor(line: ShippingLine, country: string, s: ShippingSettings): number | null {
  if (s.mode === 'dynamic' && line.size) {
    const match = line.size.rates.find((r) => toIso2(r.country) === country)
    if (match) return match.amount
    if (typeof line.size.fallbackRate === 'number') return line.size.fallbackRate
  }
  return s.flatRate
}

/** Shipping in cents, or null if nothing ships / a shipped item has no applicable rate. */
export function calculateShippingCents(country: string, lines: readonly ShippingLine[], s: ShippingSettings): number | null {
  const iso = toIso2(country)
  let total = 0
  let max = 0
  let ships = false

  for (const line of lines) {
    if (!line.requiresShipping) continue
    ships = true
    const rate = rateFor(line, iso, s)
    if (rate === null) return null
    total += rate * Math.max(1, line.quantity)
    max = Math.max(max, rate)
  }

  if (!ships) return null
  return Math.round((s.method === 'max' ? max : total) * 100)
}
