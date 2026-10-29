import type { Payload } from 'payload'
import { stripeOf, type StripeCheckoutConfig } from '../adapters/stripeCheckout/config'
import type { Locale } from './i18n'

export type Doc = Record<string, any> & { id: number | string }
export type OrderState = 'paid' | 'pending' | 'failed' | 'cancelled' | 'refunded'

export const idOf = (v: unknown): number | string => (v && typeof v === 'object' ? (v as Doc).id : (v as number | string))

/** One state per order. `status` (fulfilment) wins for cancelled/refunded, then `paymentStatus`. */
export function orderState(o: Record<string, any>): OrderState {
  if (o.status === 'cancelled') return 'cancelled'
  if (o.status === 'refunded') return 'refunded'
  if (o.paymentStatus === 'failed') return 'failed'
  if (o.paymentStatus === 'paid' || (o.paymentStatus == null && o.status === 'completed')) return 'paid'
  return 'pending'
}

export const stateClass: Record<OrderState, string> = {
  paid: 'bg-green-100 text-green-900',
  pending: 'bg-secondary-100 text-secondary-900',
  failed: 'bg-red-100 text-red-900',
  cancelled: 'bg-neutral-200 text-neutral-800',
  refunded: 'bg-neutral-200 text-neutral-800',
}

/** Page number from a query value; anything unusable is page 1. */
export function pageOf(v: unknown): number {
  const n = Math.floor(Number(Array.isArray(v) ? v[0] : v))
  return Number.isFinite(n) && n >= 1 && n <= 100_000 ? n : 1
}

const countryName = (code: string, locale: Locale) => {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code } catch { return code }
}

/** Lines of an address, only fields that are set. Understands the ecommerce plugin's fields and Stripe's `customer_details` shape. */
export function addressLines(a: unknown, locale: Locale = 'de'): string[] {
  if (!a || typeof a !== 'object') return []
  const r = a as Record<string, any>
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
  const nested = r.address && typeof r.address === 'object' ? (r.address as Record<string, any>) : {}
  const name = s(r.name) || [s(r.title), s(r.firstName), s(r.lastName)].filter(Boolean).join(' ')
  const line1 = s(r.addressLine1) || s(nested.line1)
  const line2 = s(r.addressLine2) || s(nested.line2)
  const zip = s(r.postalCode) || s(nested.postal_code)
  const city = s(r.city) || s(nested.city)
  const state = s(r.state) || s(nested.state)
  const country = s(r.country) || s(nested.country)
  return [name, s(r.company), line1, line2, [zip, city].filter(Boolean).join(' '), state, country ? countryName(country, locale) : '', s(r.phone)].filter(Boolean)
}

/** The Stripe client the plugin was configured with, or null. */
export function stripeClientOf(payload: Payload) {
  const cfg = (payload.config.custom as { payloadCommerce?: { stripe?: StripeCheckoutConfig } } | undefined)?.payloadCommerce?.stripe
  if (!cfg) return null
  try { return stripeOf(cfg) } catch { return null }
}

/** Stripe's hosted page (and number) of an invoice. Never throws: a slow or failing Stripe just means no link. */
export async function hostedInvoice(payload: Payload, stripeInvoiceID: string, timeoutMs = 3000): Promise<{ url: string | null; number: string | null }> {
  const none = { url: null, number: null }
  const stripe = stripeClientOf(payload)
  if (!stripe) return none
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const inv = await Promise.race([
      stripe.invoices.retrieve(stripeInvoiceID),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
    return { url: inv?.hosted_invoice_url ?? null, number: inv?.number ?? null }
  } catch {
    return none
  } finally {
    if (timer) clearTimeout(timer)
  }
}
