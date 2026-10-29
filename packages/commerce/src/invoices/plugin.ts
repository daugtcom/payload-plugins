import type { CollectionConfig, CollectionSlug, Endpoint, TaskConfig } from 'payload'
import type { StripeCheckoutConfig } from '../adapters/stripeCheckout/config'
import { EXPORT_TASK_SLUG, INVOICE_EXPORTS_SLUG, runInvoiceExport, type ExportEnv } from './export'

/** Where the finished ZIPs are stored. A client with a storage adapter can add this collection to its adapter instead. */
export const invoiceExports = (o: { usersSlug: CollectionSlug; isStaff: (u: unknown) => boolean; dir: string }): CollectionConfig => {
  const staff = ({ req }: { req: { user?: unknown } }) => Boolean(req.user && o.isStaff(req.user))
  return {
    slug: INVOICE_EXPORTS_SLUG,
    admin: { group: 'Ecommerce', defaultColumns: ['month', 'status', 'count', 'createdAt'] },
    upload: { staticDir: o.dir, mimeTypes: ['application/zip'], filesRequiredOnCreate: false },
    access: { read: staff, create: () => false, update: () => false, delete: staff },
    fields: [
      { name: 'month', type: 'text', required: true, index: true },
      { name: 'status', type: 'select', defaultValue: 'queued', options: ['queued', 'ready', 'empty', 'failed'] },
      { name: 'count', type: 'number' },
      { name: 'skipped', type: 'number', admin: { description: 'Invoices whose PDF could not be fetched.' } },
      { name: 'requestedBy', type: 'relationship', relationTo: o.usersSlug },
    ],
  }
}

export const exportTask = (env: ExportEnv): TaskConfig<never> =>
  ({
    slug: EXPORT_TASK_SLUG,
    retries: 2,
    inputSchema: [{ name: 'exportID', type: 'text', required: true }, { name: 'month', type: 'text', required: true }],
    handler: async ({ input, req }: { input: { exportID: string; month: string }; req: import('payload').PayloadRequest }) => {
      try {
        const r = await runInvoiceExport(req.payload, env, { exportID: input.exportID, month: input.month, req })
        return { output: r }
      } catch (err) {
        await req.payload.update({ collection: INVOICE_EXPORTS_SLUG as never, id: input.exportID, data: { status: 'failed' } as never, overrideAccess: true }).catch(() => undefined)
        throw err
      }
    },
  }) as unknown as TaskConfig<never>

/** `POST /api/commerce/invoice-exports { month: "2026-09" }` (staff): queues the export. A job runner (cron or `payload.jobs.run()`) does the work. */
export function exportEndpoint(cfg: StripeCheckoutConfig, isStaff: (u: unknown) => boolean): Endpoint {
  return {
    path: '/commerce/invoice-exports',
    method: 'post',
    handler: async (req) => {
      if (!req.user || !isStaff(req.user)) return Response.json({ error: 'forbidden' }, { status: 403 })
      const month = ((await req.json?.().catch(() => ({}))) as { month?: string })?.month
      if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({ error: 'month-required (YYYY-MM)' }, { status: 400 })
      const doc = (await req.payload.create({ collection: INVOICE_EXPORTS_SLUG as never, data: { month, status: 'queued', requestedBy: (req.user as { id: string | number }).id } as never, overrideAccess: true })) as unknown as { id: string | number }
      await req.payload.jobs.queue({ task: EXPORT_TASK_SLUG as never, input: { exportID: String(doc.id), month } as never })
      void cfg
      return Response.json({ id: doc.id, status: 'queued' }, { status: 202 })
    },
  }
}
