import { zipSync } from 'fflate'
import type { Payload, PayloadRequest } from 'payload'
import { stripeOf, type StripeCheckoutConfig } from '../adapters/stripeCheckout/config'

type Id = string | number
type Doc = Record<string, any> & { id: Id }

export const INVOICE_EXPORTS_SLUG = 'invoiceExports'
export const EXPORT_TASK_SLUG = 'exportInvoices'

export interface ExportEnv {
  cfg: StripeCheckoutConfig
  invoiceFileUrl?: (key: string) => string | Promise<string>
  serverURL?: string
}

/** The PDF bytes of one invoice: Stripe's hosted PDF, or the uploaded legacy file. */
async function pdfOf(env: ExportEnv, invoice: Doc): Promise<{ name: string; bytes: Uint8Array } | null> {
  let url: string | undefined
  let name = String(invoice.id)
  if (invoice.stripeInvoiceID) {
    name = invoice.stripeInvoiceID
    url = (await stripeOf(env.cfg).invoices.retrieve(invoice.stripeInvoiceID)).invoice_pdf ?? undefined
  } else if (invoice.file && env.invoiceFileUrl) {
    name = String(invoice.file).split('/').pop() ?? name
    url = await env.invoiceFileUrl(invoice.file)
  }
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) return null
  return { name: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, bytes: new Uint8Array(await res.arrayBuffer()) }
}

const monthRange = (month: string): { from: Date; to: Date } => {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`)
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  return { from, to: new Date(Date.UTC(Number(m[1]), Number(m[2]), 1)) }
}

/**
 * ZIP of every paid invoice of a month (one PDF per Stripe invoice / uploaded file, de-duplicated),
 * stored on an `invoiceExports` document; the requester gets an email when it is ready.
 */
export async function runInvoiceExport(payload: Payload, env: ExportEnv, o: { exportID: Id; month: string; req?: PayloadRequest }): Promise<{ status: 'ready' | 'empty'; count: number; skipped: number }> {
  const { from, to } = monthRange(o.month)
  const docs = (await payload.find({ collection: env.cfg.invoicesSlug as never, where: { and: [{ status: { equals: 'paid' } }, { createdAt: { greater_than_equal: from.toISOString() } }, { createdAt: { less_than: to.toISOString() } }] }, sort: 'createdAt', limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]

  const seen = new Set<string>()
  const files: Record<string, Uint8Array> = {}
  let skipped = 0
  for (const inv of docs) {
    const key = String(inv.stripeInvoiceID ?? inv.file ?? inv.id)
    if (seen.has(key)) continue
    seen.add(key)
    const pdf = await pdfOf(env, inv).catch(() => null)
    if (!pdf) { skipped++; continue }
    let name = pdf.name
    for (let n = 2; files[name]; n++) name = pdf.name.replace(/(\.pdf)$/i, `-${n}$1`) // two files with the same name must both survive
    files[name] = pdf.bytes
  }

  const export_ = (await payload.findByID({ collection: INVOICE_EXPORTS_SLUG as never, id: o.exportID, depth: 0, overrideAccess: true })) as Doc
  const count = Object.keys(files).length
  const requester = export_.requestedBy ? ((await payload.findByID({ collection: env.cfg.usersSlug as never, id: typeof export_.requestedBy === 'object' ? export_.requestedBy.id : export_.requestedBy, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null) : null

  if (count === 0) {
    await payload.update({ collection: INVOICE_EXPORTS_SLUG as never, id: o.exportID, data: { status: 'empty', count: 0, skipped } as never, overrideAccess: true })
    if (requester) await payload.sendEmail({ to: requester.email, subject: `Invoice export ${o.month}: nothing to export`, text: `There were no paid invoices in ${o.month}.` })
    return { status: 'empty', count: 0, skipped }
  }

  const zip = zipSync(files)
  const filename = `invoice-export-${o.month}.zip`
  await payload.update({
    collection: INVOICE_EXPORTS_SLUG as never,
    id: o.exportID,
    data: { status: 'ready', count, skipped } as never,
    file: { data: Buffer.from(zip), name: filename, mimetype: 'application/zip', size: zip.byteLength },
    overrideAccess: true,
  })
  if (requester) {
    const base = (env.serverURL ?? payload.config.serverURL ?? '').replace(/\/$/, '')
    await payload.sendEmail({ to: requester.email, subject: `Invoice export ${o.month} is ready`, text: `${count} invoices${skipped ? ` (${skipped} could not be fetched)` : ''}: ${base}/api/${INVOICE_EXPORTS_SLUG}/file/${filename}` })
  }
  return { status: 'ready', count, skipped }
}
