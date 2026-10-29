import type { Payload } from 'payload'
import type { Id, ResolvedNewsletterOptions } from './options'
import { personalize, renderNewsletter, type RenderedNewsletter } from './render'
import { unsubscribeUrl } from './subscribe'

type Doc = Record<string, any>

export class SendError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message) }
}

const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The confirmed subscribers who get this newsletter: all of them, or what the site's `audience` hook picks from them. */
export async function audienceOf(payload: Payload, o: ResolvedNewsletterOptions, newsletter: Doc): Promise<Doc[]> {
  const confirmed = (await payload.find({ collection: o.subscribersSlug as never, where: { status: { equals: 'confirmed' } } as never, limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
  if (!o.audience) return confirmed
  const picked = new Set((await o.audience(payload, newsletter)).map((x) => String(x).toLowerCase()))
  return confirmed.filter((s) => picked.has(String(s.id)) || picked.has(String(s.email).toLowerCase()))
}

async function getNewsletter(payload: Payload, o: ResolvedNewsletterOptions, id: Id): Promise<Doc> {
  const n = (await payload.findByID({ collection: o.newslettersSlug as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
  if (!n) throw new SendError('not-found', 'Newsletter nicht gefunden.', 404)
  return n
}

/** Staff action "Jetzt senden" (no `at`) or "Planen" (`at` in the future). Creates one queued delivery per recipient, once. */
export async function startSending(payload: Payload, o: ResolvedNewsletterOptions, id: Id, at?: Date | null): Promise<{ status: 'sending' | 'scheduled'; recipients: number }> {
  const n = await getNewsletter(payload, o, id)
  if (n.status === 'sending' || n.status === 'sent') throw new SendError('already-sent', n.status === 'sent' ? 'Dieser Newsletter wurde schon gesendet.' : 'Dieser Newsletter wird gerade gesendet.')
  if (!n.subject || !Array.isArray(n.blocks) || n.blocks.length === 0) throw new SendError('empty', 'Betreff und mindestens ein Inhaltsblock sind nötig.', 400)
  if (at && at.getTime() > Date.now() + 30_000) {
    await payload.update({ collection: o.newslettersSlug as never, id, data: { status: 'scheduled', scheduledAt: at.toISOString() } as never, overrideAccess: true, depth: 0 })
    return { status: 'scheduled', recipients: (await audienceOf(payload, o, n)).length }
  }
  return { status: 'sending', recipients: await beginSending(payload, o, n) }
}

/** Claims the newsletter (draft/scheduled → sending) and queues a delivery for every recipient that has none yet. */
async function beginSending(payload: Payload, o: ResolvedNewsletterOptions, n: Doc): Promise<number> {
  const claimed = await payload.update({ collection: o.newslettersSlug as never, where: { and: [{ id: { equals: n.id } }, { status: { in: ['draft', 'scheduled'] } }] } as never, data: { status: 'sending', scheduledAt: null } as never, overrideAccess: true, depth: 0 })
  if (claimed.docs.length === 0) throw new SendError('already-sent', 'Dieser Newsletter wird schon gesendet.')
  const audience = await audienceOf(payload, o, n)
  const have = new Set(((await payload.find({ collection: o.deliveriesSlug as never, where: { newsletter: { equals: n.id } } as never, limit: 0, pagination: false, depth: 0, overrideAccess: true, select: { subscriber: true } as never })).docs as Doc[]).map((d) => String(idOf(d.subscriber))))
  for (const s of audience) {
    if (have.has(String(s.id))) continue
    await payload.create({ collection: o.deliveriesSlug as never, data: { newsletter: n.id, subscriber: s.id, email: s.email, status: 'queued' } as never, overrideAccess: true, depth: 0 })
  }
  await payload.update({ collection: o.newslettersSlug as never, id: n.id, data: { stats: { ...(n.stats ?? {}), recipients: audience.length } } as never, overrideAccess: true, depth: 0 }).catch(() => undefined)
  return audience.length
}

/** Staff action: take a scheduled newsletter back to a draft. */
export async function cancelSchedule(payload: Payload, o: ResolvedNewsletterOptions, id: Id): Promise<void> {
  const res = await payload.update({ collection: o.newslettersSlug as never, where: { and: [{ id: { equals: id } }, { status: { equals: 'scheduled' } }] } as never, data: { status: 'draft', scheduledAt: null } as never, overrideAccess: true, depth: 0 })
  if (res.docs.length === 0) throw new SendError('not-scheduled', 'Der Newsletter ist nicht geplant.')
}

const countBy = async (payload: Payload, o: ResolvedNewsletterOptions, newsletter: Id, status: string) =>
  (await payload.count({ collection: o.deliveriesSlug as never, where: { and: [{ newsletter: { equals: newsletter } }, { status: { equals: status } }] } as never, overrideAccess: true })).totalDocs

async function refreshStats(payload: Payload, o: ResolvedNewsletterOptions, n: Doc): Promise<{ done: boolean }> {
  const [queued, sending, sent, failed] = await Promise.all(['queued', 'sending', 'sent', 'failed'].map((s) => countBy(payload, o, n.id, s)))
  const done = queued === 0 && sending === 0
  await payload.update({ collection: o.newslettersSlug as never, id: n.id, data: { stats: { sent, failed, recipients: queued! + sending! + sent! + failed! }, ...(done ? { status: 'sent', sentAt: new Date().toISOString() } : {}) } as never, overrideAccess: true, depth: 0 })
  return { done }
}

/**
 * Sends the next batch of one newsletter that is `sending`. At most once per recipient: a delivery is claimed (queued → sending) before
 * the mail goes out and set to sent/failed after; a crash in between leaves it "sending", which is never retried by itself.
 * Returns how many mails went out in this call.
 */
export async function sendBatch(payload: Payload, o: ResolvedNewsletterOptions, newsletterId: Id, limit = o.batchSize, rendered?: RenderedNewsletter): Promise<{ sent: number; failed: number; done: boolean }> {
  const n = await getNewsletter(payload, o, newsletterId)
  if (n.status !== 'sending') return { sent: 0, failed: 0, done: n.status === 'sent' }
  const queued = (await payload.find({ collection: o.deliveriesSlug as never, where: { and: [{ newsletter: { equals: n.id } }, { status: { equals: 'queued' } }] } as never, limit, sort: 'id', depth: 0, overrideAccess: true })).docs as unknown as Doc[]
  let html: RenderedNewsletter | undefined = rendered
  let sent = 0
  let failed = 0
  for (const d of queued) {
    const claim = await payload.update({ collection: o.deliveriesSlug as never, where: { and: [{ id: { equals: d.id } }, { status: { equals: 'queued' } }] } as never, data: { status: 'sending' } as never, overrideAccess: true, depth: 0 })
    if (claim.docs.length === 0) continue // someone else has it
    const s = (await payload.findByID({ collection: o.subscribersSlug as never, id: idOf(d.subscriber), depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
    try {
      if (!s || s.status !== 'confirmed') throw new Error('nicht (mehr) bestätigt')
      html ??= await renderNewsletter(payload, o, n)
      const unsub = unsubscribeUrl(payload, o, s)
      const body = personalize(html, unsub)
      await payload.sendEmail({
        to: s.email, subject: html.subject, html: body.html, text: body.text,
        ...(o.from ? { from: o.from } : {}), ...(o.replyTo ? { replyTo: o.replyTo } : {}),
        headers: { 'List-Unsubscribe': `<${unsub}>${o.unsubscribeMailto ? `, <mailto:${o.unsubscribeMailto}?subject=unsubscribe>` : ''}`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      } as never)
      await payload.update({ collection: o.deliveriesSlug as never, id: d.id, data: { status: 'sent', sentAt: new Date().toISOString(), error: null } as never, overrideAccess: true, depth: 0 })
      sent++
    } catch (err) {
      await payload.update({ collection: o.deliveriesSlug as never, id: d.id, data: { status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 300) } as never, overrideAccess: true, depth: 0 })
      failed++
    }
    if (o.sendDelayMs > 0) await sleep(o.sendDelayMs)
  }
  const { done } = await refreshStats(payload, o, n)
  return { sent, failed, done }
}

/**
 * What the scheduled job does on every tick: start newsletters whose time has come, then send batches of every `sending` one until
 * the time budget is used up (the next tick goes on).
 */
export async function tick(payload: Payload, o: ResolvedNewsletterOptions, now = new Date()): Promise<{ started: number; sent: number; failed: number }> {
  const started = Date.now()
  let startedCount = 0
  const due = (await payload.find({ collection: o.newslettersSlug as never, where: { and: [{ status: { equals: 'scheduled' } }, { scheduledAt: { less_than_equal: now.toISOString() } }] } as never, limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
  for (const n of due) {
    try { await beginSending(payload, o, n); startedCount++ } catch (err) { payload.logger.error({ err, msg: 'payload-newsletter: could not start a scheduled newsletter' }) }
  }
  let sent = 0
  let failed = 0
  const running = (await payload.find({ collection: o.newslettersSlug as never, where: { status: { equals: 'sending' } } as never, limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
  for (const n of running) {
    let rendered: RenderedNewsletter | undefined
    while (Date.now() - started < o.sendBudgetMs) {
      rendered ??= await renderNewsletter(payload, o, n).catch((err) => { payload.logger.error({ err, msg: 'payload-newsletter: render failed' }); return undefined })
      if (!rendered) break
      const r = await sendBatch(payload, o, n.id, o.batchSize, rendered)
      sent += r.sent
      failed += r.failed
      if (r.done || r.sent + r.failed === 0) break
    }
  }
  return { started: startedCount, sent, failed }
}

/** A mail of the newsletter to one address, for checking how it looks. Not counted anywhere. */
export async function sendTest(payload: Payload, o: ResolvedNewsletterOptions, data: Doc, to: string): Promise<void> {
  const rendered = await renderNewsletter(payload, o, data)
  const body = personalize(rendered, `${(o.serverURL ?? payload.config.serverURL ?? '').replace(/\/$/, '')}/newsletter/abgemeldet`)
  await payload.sendEmail({ to, subject: `[Test] ${rendered.subject}`, html: body.html, text: body.text, ...(o.from ? { from: o.from } : {}) } as never)
}
