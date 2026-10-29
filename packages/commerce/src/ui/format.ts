import { t, type Locale } from './i18n'

const intl = (locale: string) => (locale === 'de' ? 'de-AT' : locale === 'en' ? 'en-IE' : locale)

export const euro = (cents: number, locale: Locale | string = 'de'): string => new Intl.NumberFormat(intl(locale), { style: 'currency', currency: 'EUR' }).format(cents / 100)

export const formatDate = (iso: string | null | undefined, locale: Locale | string = 'de'): string => (iso ? new Date(iso).toLocaleDateString(intl(locale), { day: 'numeric', month: 'long', year: 'numeric' }) : '')

/** "€12.00", or "€12.00 per month" / "every 3 month" for a subscription product (a `products` doc with the plugin's `commerce` group). */
export function productPriceLabel(product: { priceInEUR?: number | null; commerce?: { billingType?: string | null; intervalCount?: number | null; intervalUnit?: string | null } | null }, locale: Locale = 'de'): string {
  const L = t(locale)
  const c = product.commerce ?? {}
  const every = c.billingType === 'recurring' ? ` ${(c.intervalCount ?? 1) > 1 ? L.everyN(c.intervalCount ?? 1, c.intervalUnit ?? '') : L.monthly}` : ''
  return `${euro(Number(product.priceInEUR ?? 0), locale)}${every}`
}

const TZ = 'Europe/Vienna'
/** dd.mm.yyyy (de) / dd/mm/yyyy (en). */
export const formatDay = (iso: string | null | undefined, locale: Locale | string = 'de'): string => (iso ? new Date(iso).toLocaleDateString(intl(locale), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }) : '')
/** Date and time of day, e.g. "21.10.2026, 14:05". */
export const formatDateTime = (iso: string | null | undefined, locale: Locale | string = 'de'): string => (iso ? new Date(iso).toLocaleString(intl(locale), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '')
