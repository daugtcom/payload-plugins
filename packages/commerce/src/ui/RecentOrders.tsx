import type { Payload } from 'payload'
import { euro, formatDay } from './format'
import { t, type Locale } from './i18n'
import { BagIcon } from './icons'
import { StatusChip } from './OrdersView'
import { orderState, type Doc } from './orderModel'

export interface RecentOrdersProps {
  payload: Payload
  user: { id: number | string }
  locale?: Locale
  usersSlug?: string
  /** `orders`: the full orders page. Default `/access/orders`. */
  hrefs?: { orders?: string }
  /** How many orders to show (default 5). */
  limit?: number
}

/** Dashboard card "Letzte Bestellungen": the newest orders with date, status and total. Self-contained, meant as a slot of the member dashboard. */
export async function RecentOrders({ payload, user, locale = 'de', usersSlug = 'users', hrefs, limit = 5 }: RecentOrdersProps) {
  const L = t(locale)
  const res = await payload.find({
    collection: 'orders' as never, where: { customer: { equals: user.id } } as never, sort: ['-orderNumber', '-createdAt'] as never,
    depth: 0, limit, pagination: false, overrideAccess: false, user: { ...user, collection: usersSlug } as never,
  })
  const orders = res.docs as unknown as Doc[]
  return (
    <section aria-labelledby="recent-orders-heading" className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 id="recent-orders-heading" className="m-0 font-display text-2xl font-semibold text-primary-950">{L.recentOrders}</h2>
      {orders.length === 0 ? (
        <p className="mt-3 mb-0 text-[0.95rem] text-neutral-700">{L.noRecentOrders}</p>
      ) : (
        <ul className="mt-3 mb-0 list-none divide-y divide-neutral-100 p-0">
          {orders.map((o) => (
            <li key={o.id} className="m-0 flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="m-0 font-semibold text-neutral-900">{L.orderNumber} #{o.orderNumber ?? o.id}</p>
                <p className="m-0 text-sm text-neutral-600"><time dateTime={o.createdAt}>{formatDay(o.createdAt, locale)}</time> · <span className="tabular-nums">{euro(Number(o.amount ?? 0), locale)}</span></p>
              </div>
              <StatusChip state={orderState(o)} locale={locale} className="!px-2.5 !py-0.5 !text-xs" />
            </li>
          ))}
        </ul>
      )}
      <a href={hrefs?.orders ?? '/access/orders'} className="mt-3 inline-flex items-center gap-2 text-[0.95rem] font-semibold text-primary-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"><BagIcon />{L.allOrders}</a>
    </section>
  )
}
