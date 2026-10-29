import type { Payload } from 'payload'
import { BillingPortalButton } from './BillingPortalButton'
import { euro, formatDateTime, formatDay } from './format'
import { t, type Locale } from './i18n'
import { BagIcon, ChevronIcon, FileIcon, LockIcon, UnlockIcon } from './icons'
import { addressLines, hostedInvoice, idOf, orderState, pageOf, stateClass, type Doc, type OrderState } from './orderModel'

export const ORDERS_PAGE_SIZE = 20

export interface OrdersHrefs {
  shop: string
  course: (slug: string) => string
  post: (slug: string) => string
  product: (slug: string) => string
}

export const defaultOrdersHrefs: OrdersHrefs = {
  shop: '/shop',
  course: (slug) => `/access/course/${slug}/all`,
  post: (slug) => `/post/${slug}`,
  product: (slug) => `/shop/${slug}`,
}

export interface OrdersViewProps {
  payload: Payload
  /** The signed-in member (their `id` is enough). Orders are read with this member's rights. */
  user: { id: number | string }
  locale?: Locale
  usersSlug?: string
  entitlementsSlug?: string
  hrefs?: Partial<OrdersHrefs>
  /** Show the billing-portal notice card (default). Pass false to place `<BillingPortalButton/>` yourself. */
  showBillingButton?: boolean
  /** PDF address of an invoice without a Stripe link. Default `/api/commerce/invoices/<id>/pdf`. */
  invoiceHref?: (invoiceID: number | string) => string
  /** The `?page=` value of the request (1-based). */
  page?: number | string | string[] | null
  /** Address of another page of orders. Default `?page=<n>`. */
  pageHref?: (page: number) => string
}

export const chipLabel = (s: OrderState, locale: Locale): string => {
  const L = t(locale)
  return { paid: L.statusPaid, pending: L.statusPending, failed: L.statusFailed, cancelled: L.statusCancelled, refunded: L.statusRefunded }[s]
}

export function StatusChip({ state, locale, className = '' }: { state: OrderState; locale: Locale; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-medium ${stateClass[state]} ${className}`}>{chipLabel(state, locale)}</span>
}

const link = 'font-medium text-primary-800 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600'
const sectionTitle = 'm-0 mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600'

function Address({ title, lines }: { title: string; lines: string[] }) {
  if (!lines.length) return null
  return (
    <section>
      <h4 className={sectionTitle}>{title}</h4>
      <address className="m-0 text-[0.95rem] leading-relaxed text-neutral-800 not-italic">
        {lines.map((l, i) => <span key={i} className="block">{l}</span>)}
      </address>
    </section>
  )
}

/** The member's orders: cards with status, total and expandable details (addresses, items, what the order unlocked, invoices). Heading and page frame are the site's. */
export async function OrdersView({
  payload, user, locale = 'de', usersSlug = 'users', entitlementsSlug = 'entitlements', hrefs, showBillingButton = true,
  invoiceHref = (id) => `/api/commerce/invoices/${id}/pdf`, page, pageHref = (n) => `?page=${n}`,
}: OrdersViewProps) {
  const L = t(locale)
  const h: OrdersHrefs = { ...defaultOrdersHrefs, ...hrefs }
  const current = pageOf(page)
  const asUser = { ...user, collection: usersSlug } as never
  const mine = { overrideAccess: false, user: asUser } as const

  // Ownership is enforced twice: the `customer` filter and the collection's read access (overrideAccess: false).
  const res = await payload.find({ collection: 'orders' as never, where: { customer: { equals: user.id } } as never, sort: ['-orderNumber', '-createdAt'] as never, depth: 2, limit: ORDERS_PAGE_SIZE, page: current, ...mine })
  const orders = res.docs as unknown as Doc[]
  const ids = orders.map((o) => o.id)

  const invoices = ids.length
    ? ((await payload.find({ collection: 'invoices' as never, where: { and: [{ customer: { equals: user.id } }, { order: { in: ids } }] } as never, depth: 0, limit: 0, pagination: false, ...mine })).docs as unknown as Doc[])
    : []
  // Entitlements are read without access checks, but only for this user's own, just-fetched orders.
  const commerce = payload.config.custom?.daugtCommerce as { options?: { accessTargets?: string[]; accessBridge?: unknown } } | undefined
  const grants = ids.length && Boolean(commerce?.options?.accessBridge && commerce.options.accessTargets?.length) && Boolean(payload.config.collections.some((collection) => collection.slug === entitlementsSlug))
    ? ((await payload.find({ collection: entitlementsSlug as never, where: { and: [{ user: { equals: user.id } }, { order: { in: ids } }] } as never, depth: 1, limit: 0, pagination: false, overrideAccess: true })).docs as unknown as Doc[])
    : []

  // Stripe invoice links, in parallel, each with a short timeout; a failure falls back to the PDF endpoint.
  const hosted = new Map<string, { url: string | null; number: string | null }>()
  await Promise.all(invoices.filter((i) => i.stripeInvoiceID).map(async (i) => { hosted.set(String(i.id), await hostedInvoice(payload, String(i.stripeInvoiceID))) }))

  return (
    <div className="max-w-4xl text-neutral-900">
      {showBillingButton && (
        <section aria-label={L.billingPortalRegion} className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
          <p className="m-0 max-w-xl text-[0.95rem] text-neutral-700">{L.billingNotice}</p>
          <BillingPortalButton locale={locale} className="inline-flex items-center justify-center rounded-lg bg-primary-700 px-4 py-2.5 text-[0.95rem] font-semibold text-white hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 disabled:opacity-60" />
        </section>
      )}

      {res.totalDocs === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-10 text-center">
          <p className="m-0 font-display text-xl font-semibold text-primary-950">{L.noOrdersTitle}</p>
          <a href={h.shop} className={`mt-3 inline-flex items-center gap-2 ${link}`}><BagIcon />{L.toShop}</a>
        </div>
      ) : (
        <ul aria-label={L.ordersListLabel} className="m-0 flex list-none flex-col gap-5 p-0">
          {orders.map((o) => {
            const state = orderState(o)
            const own = grants.filter((g) => String(idOf(g.order)) === String(o.id))
            const inv = invoices.filter((i) => String(idOf(i.order)) === String(o.id))
            const shipping = addressLines(o.shippingAddress, locale)
            const billing = addressLines(o.billingAddress, locale)
            const items = (o.items ?? []) as Doc[]
            const number = String(o.orderNumber ?? o.id)
            const stamp = o.createdAt ?? o.paidAt
            const shipLabel: Record<string, string> = { pending: L.shipPending, processing: L.shipProcessing, shipped: L.shipShipped, delivered: L.shipDelivered }
            return (
              <li key={o.id} className="m-0 rounded-2xl border border-neutral-200 bg-white">
                <article aria-labelledby={`order-${o.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
                    <div>
                      <h3 id={`order-${o.id}`} className="m-0 font-display text-2xl font-semibold text-primary-950">{L.orderNumber} #{number}</h3>
                      <p className="m-0 mt-1 text-sm text-neutral-600"><time dateTime={stamp}>{formatDateTime(stamp, locale)}</time></p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusChip state={state} locale={locale} />
                      <p className="m-0 text-right">
                        <span className="text-lg font-semibold tabular-nums text-neutral-900">{euro(Number(o.amount ?? 0), locale)}</span>
                        <span className="ml-1.5 text-sm text-neutral-600">{L.inclVat}</span>
                      </p>
                    </div>
                  </div>

                  <details className="group border-t border-neutral-100">
                    <summary
                      aria-label={`${L.showDetails}: ${L.orderNumber} #${number}`}
                      className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3 text-[0.95rem] font-semibold text-primary-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600 sm:px-6 [&::-webkit-details-marker]:hidden"
                    >
                      <span className="group-open:hidden">{L.showDetails}</span>
                      <span className="hidden group-open:inline">{L.hideDetails}</span>
                      <ChevronIcon className="transition-transform group-open:rotate-180" />
                    </summary>

                    <div className="space-y-6 border-t border-neutral-100 p-5 sm:p-6">
                      {(shipping.length > 0 || billing.length > 0) && (
                        <div className="grid gap-6 sm:grid-cols-2">
                          <Address title={L.deliveryAddress} lines={shipping} />
                          <Address title={L.billingAddress} lines={billing} />
                        </div>
                      )}

                      {items.length > 0 && (
                        <section>
                          <h4 className={sectionTitle}>{L.items}</h4>
                          <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
                            {items.map((i) => {
                              const p = typeof i.product === 'object' && i.product ? (i.product as Doc) : null
                              const media = Array.isArray(p?.gallery) ? p!.gallery.find((m: unknown) => m && typeof m === 'object') : null
                              const thumb = media?.sizes?.thumbnail?.url ?? media?.url
                              const recurring = Boolean(i.stripeSubscriptionID) || p?.commerce?.billingType === 'recurring'
                              return (
                                <li key={i.id ?? idOf(i.product)} className="m-0 flex items-center gap-4 py-3">
                                  {thumb
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={thumb} alt={media?.alt ?? ''} width={56} height={56} loading="lazy" className="h-14 w-14 shrink-0 rounded-lg bg-neutral-100 object-cover" />
                                    : <span aria-hidden className="h-14 w-14 shrink-0 rounded-lg bg-neutral-100" />}
                                  <div className="min-w-0 flex-1">
                                    <p className="m-0 font-medium text-neutral-900">{p?.slug ? <a className={link} href={h.product(p.slug)}>{p.title}</a> : (p?.title ?? '—')}</p>
                                    <p className="m-0 mt-0.5 text-sm text-neutral-600">
                                      <span className="tabular-nums">{L.quantity}: {i.quantity ?? 1}</span>
                                      {i.shippingStatus && shipLabel[i.shippingStatus as string] ? <span> · {shipLabel[i.shippingStatus as string]}</span> : null}
                                      {recurring ? <span> · {L.subscriptionManage}</span> : null}
                                    </p>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        </section>
                      )}

                      {state === 'paid' ? (
                        own.length > 0 && (
                          <section>
                            <h4 className={sectionTitle}>{L.unlocked}</h4>
                            <ul className="m-0 flex list-none flex-col gap-2 p-0">
                              {own.map((g) => {
                                const tg = g.target && typeof g.target.value === 'object' ? (g.target.value as Doc) : null
                                const href = tg?.slug ? (g.target.relationTo === 'courses' ? h.course(tg.slug) : h.post(tg.slug)) : null
                                return (
                                  <li key={g.id} className="m-0 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.95rem]">
                                    <span className="inline-flex items-center gap-2">
                                      <UnlockIcon className="shrink-0 text-green-800" /><span className="sr-only">{L.unlockedIcon}: </span>
                                      {href ? <a className={link} href={href}>{tg!.title}</a> : <span className="font-medium">{tg?.title ?? '—'}</span>}
                                    </span>
                                    <span className="text-sm tabular-nums text-neutral-600">
                                      {g.validityEnd ? `${g.validityStart ? formatDay(g.validityStart, locale) : '…'} – ${formatDay(g.validityEnd, locale)}` : L.unlimited}
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                          </section>
                        )
                      ) : (state === 'pending' || state === 'failed') ? (
                        <p className="m-0 flex items-center gap-2 text-sm text-neutral-700"><LockIcon className="shrink-0" />{L.unlockedPending}</p>
                      ) : null}

                      {inv.length > 0 && (
                        <section>
                          <h4 className={sectionTitle}>{L.invoices}</h4>
                          <ul className="m-0 flex list-none flex-col gap-2 p-0">
                            {inv.map((i) => {
                              const hi = hosted.get(String(i.id))
                              const label = String(hi?.number ?? i.number ?? i.id)
                              return (
                                <li key={i.id} className="m-0 flex flex-wrap items-center justify-between gap-3 text-[0.95rem]">
                                  <span className="inline-flex items-center gap-2 text-neutral-800"><FileIcon className="shrink-0 text-neutral-600" />{L.invoiceNumber(label)}</span>
                                  <a className={link} href={hi?.url ?? invoiceHref(i.id)} target="_blank" rel="noreferrer" aria-label={L.viewInvoiceLabel(label)}>{L.viewInvoice}</a>
                                </li>
                              )
                            })}
                          </ul>
                        </section>
                      )}
                    </div>
                  </details>
                </article>
              </li>
            )
          })}
        </ul>
      )}

      {(res.hasNextPage || current > 1) && res.totalDocs > 0 && (
        <nav aria-label={L.pagination} className="mt-8 flex flex-wrap items-center justify-between gap-4">
          {current > 1 ? <a rel="prev" className={link} href={pageHref(current - 1)}>← {L.newerOrders}</a> : <span />}
          {res.hasNextPage ? <a rel="next" className={link} href={pageHref(current + 1)}>{L.olderOrders} →</a> : null}
        </nav>
      )}
    </div>
  )
}
