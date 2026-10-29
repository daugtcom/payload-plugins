import type { CollectionBeforeChangeHook } from 'payload'
import { COMMERCE_SETTINGS_SLUG } from '../globals/commerceSettings'
import { nextOrderNumber } from './orderNumber'

/** Give new orders the next number unless they already have one (imports keep their legacy numbers). */
export const assignOrderNumber =
  (ordersSlug: string): CollectionBeforeChangeHook =>
  async ({ data, operation, req }) => {
    if (operation !== 'create' || data.orderNumber) return data
    const [last, settings] = await Promise.all([
      req.payload.find({ collection: ordersSlug as never, sort: '-orderNumber', limit: 1, depth: 0, overrideAccess: true, req, select: { orderNumber: true } as never }),
      req.payload.findGlobal({ slug: COMMERCE_SETTINGS_SLUG as never, depth: 0, overrideAccess: true, req }).catch(() => null),
    ])
    const maxExisting = (last.docs[0] as { orderNumber?: number } | undefined)?.orderNumber ?? 0
    return { ...data, orderNumber: nextOrderNumber({ setting: (settings as { nextOrderNumber?: number } | null)?.nextOrderNumber, maxExisting }) }
  }

/** A paid order without a paid date gets one. */
export const stampPaidAt: CollectionBeforeChangeHook = ({ data }) => {
  if (data.paymentStatus === 'paid' && !data.paidAt) return { ...data, paidAt: new Date().toISOString() }
  return data
}
