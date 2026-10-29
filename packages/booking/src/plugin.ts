import { LINE_RESOLVERS_KEY, type LineResolver } from '@daugtcom/payload-commerce'
import type { CollectionAfterChangeHook, CollectionConfig, Config, Plugin } from 'payload'
import { applyExclusionConstraint } from './constraint'
import { confirmForOrder, ensureHeld, sendDueReminders } from './engine'
import { bookingEndpoints } from './endpoints'
import { bookingProductFields, bookingSettingsGlobal, bookingsCollection } from './fields'
import { BOOKING_CUSTOM_KEY } from './constants'
import { fmtWhen } from './email'
import type { BookingPluginOptions, ResolvedBookingOptions } from './options'

const defaultIsStaff = (user: unknown): boolean => {
  const u = user as { roles?: string[]; role?: string } | null
  return Boolean(u && (u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin'))))
}

export const resolveOptions = (o: BookingPluginOptions = {}): ResolvedBookingOptions => ({
  usersSlug: o.usersSlug ?? 'users',
  productsSlug: o.productsSlug ?? 'products',
  bookingsSlug: o.bookingsSlug ?? 'bookings',
  isStaff: o.isStaff ?? defaultIsStaff,
  timezone: o.timezone ?? 'Europe/Vienna',
  holdMinutes: Math.max(30, o.holdMinutes ?? 35),
  busyCalendars: o.busyCalendars ?? [],
  settingsSlug: o.settingsSlug ?? 'bookingSettings',
  busyCacheSeconds: o.busyCacheSeconds ?? 300,
  live: o.live,
  hostUserIds: o.hostUserIds,
  email: o.email ?? true,
  serverURL: o.serverURL,
  siteName: o.siteName,
  mailTheme: o.mailTheme,
  mailLayout: o.mailLayout,
  reminderHours: [...(o.reminderHours ?? [24, 1])].sort((a, b) => b - a),
})

export { BOOKING_CUSTOM_KEY }

/**
 * Appointment booking for a commerce shop. List it AFTER `payloadCommerce()` (and after `payloadAccess()`): it extends the products,
 * carts and orders that commerce builds. Products with `booking.enabled` become appointments; a chosen slot is held, put into the cart,
 * paid through the normal checkout and confirmed when the order is paid.
 */
export const payloadBooking =
  (options: BookingPluginOptions = {}): Plugin =>
  (incoming: Config): Config => {
    if (options.enabled === false) return incoming
    const o = resolveOptions(options)
    for (const slug of [o.productsSlug, 'carts', 'orders', 'transactions']) {
      if (!incoming.collections?.some((c) => c.slug === slug)) throw new Error(`payloadBooking: collection "${slug}" not found. List payloadBooking() after payloadCommerce() in plugins.`)
    }

    // a cart line that carries a booking is priced and labelled from the booking, not from the product
    const resolver: LineResolver = async ({ req, item, base }) => {
      const id = item.meta?.bookingID
      if (!id) return
      const b = await ensureHeld(req.payload, o, id as string, req)
      return { priceCents: Number(b.priceCents ?? base.priceCents), title: `${base.title} · ${fmtWhen(b.start, o.timezone)}`, metadata: { bookingID: String(b.id) } }
    }

    const confirmHook: CollectionAfterChangeHook = async ({ doc, req }) => {
      try {
        await confirmForOrder(req, o, doc)
      } catch (err) {
        req.payload.logger.error({ err, msg: 'payload-booking: confirming bookings of an order failed' })
      }
      return doc
    }

    return {
      ...incoming,
      collections: [
        ...(incoming.collections ?? []).map((c): CollectionConfig => {
          if (c.slug === o.productsSlug) return { ...c, fields: [...c.fields, bookingProductFields] }
          if (c.slug === 'orders') {
            return {
              ...c,
              hooks: {
                ...c.hooks,
                afterChange: [...(c.hooks?.afterChange ?? []), confirmHook],
              },
            }
          }
          return c
        }),
        bookingsCollection(o),
      ],
      globals: [...(incoming.globals ?? []), bookingSettingsGlobal(o)],
      endpoints: [...(incoming.endpoints ?? []), ...bookingEndpoints(o)],
      // reminders run as a scheduled Payload job (every 10 minutes, queue "default"). Something has to run the queue:
      // `jobs.autoRun` on a long-running server, or a cron calling `GET /api/payload-jobs/run` on serverless.
      jobs: {
        ...incoming.jobs,
        tasks: [
          ...(incoming.jobs?.tasks ?? []),
          {
            slug: 'bookingReminders',
            schedule: [{ cron: '*/10 * * * *', queue: 'default' }],
            handler: async ({ req }) => ({ output: { sent: (await sendDueReminders(req.payload, o)).sent } }),
          },
        ],
      },
      onInit: async (payload) => {
        await incoming.onInit?.(payload)
        await applyExclusionConstraint(payload, o.bookingsSlug)
      },
      custom: {
        ...incoming.custom,
        [BOOKING_CUSTOM_KEY]: { options: o },
        [LINE_RESOLVERS_KEY]: [...(((incoming.custom as Record<string, unknown> | undefined)?.[LINE_RESOLVERS_KEY] as LineResolver[] | undefined) ?? []), resolver],
      },
    }
  }
