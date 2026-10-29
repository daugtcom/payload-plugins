import { mailLayout } from '@daugtcom/payload-mail'
import type { Payload } from 'payload'
import type { ConsentSource, SubscriberStatus } from './constants'
import type { Id, MailContent, ResolvedNewsletterOptions } from './options'
import { makeToken, verifyToken } from './tokens'

type Doc = Record<string, any>

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const normalizeEmail = (v: unknown): string | null => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return e.length <= 254 && EMAIL.test(e) ? e : null
}

const baseUrl = (payload: Payload, o: ResolvedNewsletterOptions) => (o.serverURL ?? payload.config.serverURL ?? '').replace(/\/$/, '')
export const confirmUrl = (payload: Payload, o: ResolvedNewsletterOptions, s: Doc) => `${baseUrl(payload, o)}/api/newsletter/confirm?token=${encodeURIComponent(makeToken(payload, 'confirm', s.id, s.email))}`
export const unsubscribeUrl = (payload: Payload, o: ResolvedNewsletterOptions, s: Doc) => `${baseUrl(payload, o)}/api/newsletter/unsubscribe?token=${encodeURIComponent(makeToken(payload, 'unsubscribe', s.id, s.email))}`

/** Mail failures never break the signup: logged, the visitor still sees the normal answer. */
export async function sendSystemMail(payload: Payload, o: ResolvedNewsletterOptions, to: string, subject: string, content: MailContent): Promise<boolean> {
  try {
    const { html, text } = await (o.mailLayout ?? mailLayout(o.theme))({ signoff: `Herzlich,\n${o.senderName}`, ...content })
    // development has no mail adapter: show the text (with the confirm link) in the server log
    if (process.env.NODE_ENV !== 'production' && !process.env.RESEND_API_KEY) payload.logger.info(`payload-newsletter mail to ${to}: ${subject}\n${text}`)
    await payload.sendEmail({ to, subject, html, text, ...(o.from ? { from: o.from } : {}), ...(o.replyTo ? { replyTo: o.replyTo } : {}) } as never)
    return true
  } catch (err) {
    payload.logger.error({ err, msg: 'payload-newsletter: system mail failed' })
    return false
  }
}

export async function sendOptInMail(payload: Payload, o: ResolvedNewsletterOptions, s: Doc): Promise<boolean> {
  const first = typeof s.name === 'string' && s.name.trim() ? s.name.trim().split(/\s+/)[0] : ''
  const ok = await sendSystemMail(payload, o, s.email, 'Bitte bestätige deine Anmeldung', {
    preheader: 'Ein Klick noch, dann bist du dabei.',
    eyebrow: 'Newsletter',
    heading: 'Bitte bestätige deine Anmeldung',
    paragraphs: [`Hallo${first ? ` ${first}` : ''},`, `schön, dass du den Newsletter von ${o.senderName} lesen möchtest. Damit niemand ohne sein Wissen eingetragen wird, bestätige bitte kurz deine E-Mail-Adresse.`],
    button: { label: 'Anmeldung bestätigen', href: confirmUrl(payload, o, s) },
    note: ['Du hast dich nicht angemeldet? Dann ignoriere diese E-Mail einfach, es passiert nichts und deine Adresse wird nach kurzer Zeit gelöscht.'],
  })
  if (ok) await payload.update({ collection: o.subscribersSlug as never, id: s.id, data: { optInSentAt: new Date().toISOString() } as never, overrideAccess: true, depth: 0 }).catch(() => undefined)
  return ok
}

// ---------------------------------------------------------------- rate limit (in memory, per process)

const hits = new Map<string, number[]>()
/** True when this key has used up its allowance in the window. Counts the attempt. */
export function limited(key: string, max: number, windowMinutes: number, now = Date.now()): boolean {
  const since = now - windowMinutes * 60_000
  const list = (hits.get(key) ?? []).filter((t) => t > since)
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > since)) hits.delete(k)
  return list.length > max
}
export const resetRateLimits = () => hits.clear()

// ---------------------------------------------------------------- subscribe / confirm / unsubscribe

export async function findByEmail(payload: Payload, o: ResolvedNewsletterOptions, email: string): Promise<Doc | null> {
  const res = await payload.find({ collection: o.subscribersSlug as never, where: { email: { equals: email } } as never, limit: 1, depth: 0, overrideAccess: true })
  return (res.docs[0] as Doc | undefined) ?? null
}

/**
 * Public signup. Always ends the same for the caller: confirmed subscribers are left alone (no mail, no change), pending ones get a
 * fresh confirmation mail (at most one per 10 minutes), unsubscribed ones are treated like new ones (their own, fresh consent).
 * Bounced and complained addresses are never mailed again.
 */
export async function subscribe(payload: Payload, o: ResolvedNewsletterOptions, input: { email: string; name?: string; ip?: string | null; source?: ConsentSource }): Promise<void> {
  const email = input.email
  const existing = await findByEmail(payload, o, email)
  const now = new Date()
  if (existing) {
    const status = existing.status as SubscriberStatus
    if (status === 'confirmed' || status === 'bounced' || status === 'complained') return
    if (status === 'pending') {
      const last = existing.optInSentAt ? new Date(existing.optInSentAt).getTime() : 0
      if (now.getTime() - last < 10 * 60_000) return
      await sendOptInMail(payload, o, existing)
      return
    }
    // unsubscribed earlier and signing up again: a new pending consent
    const updated = await payload.update({ collection: o.subscribersSlug as never, id: existing.id, data: { status: 'pending', name: input.name || existing.name, consentAt: now.toISOString(), consentIp: input.ip ?? null, consentSource: input.source ?? 'form', unsubscribedAt: null, confirmedAt: null } as never, overrideAccess: true, depth: 0 })
    await sendOptInMail(payload, o, updated as Doc)
    return
  }
  const created = await payload.create({ collection: o.subscribersSlug as never, data: { email, name: input.name || undefined, status: 'pending', consentAt: now.toISOString(), consentIp: input.ip ?? undefined, consentSource: input.source ?? 'form' } as never, overrideAccess: true, depth: 0 })
  await sendOptInMail(payload, o, created as Doc)
}

export type TokenResult = 'ok' | 'invalid'

async function subscriberByToken(payload: Payload, o: ResolvedNewsletterOptions, purpose: 'confirm' | 'unsubscribe', token: string | null | undefined): Promise<Doc | null> {
  const id = (token ?? '').split('.')[0]
  if (!id) return null
  const s = (await payload.findByID({ collection: o.subscribersSlug as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
  return s && verifyToken(payload, purpose, token, s.email, s.id) ? s : null
}

export async function confirm(payload: Payload, o: ResolvedNewsletterOptions, token: string | null | undefined): Promise<TokenResult> {
  const s = await subscriberByToken(payload, o, 'confirm', token)
  if (!s) return 'invalid'
  if (s.status === 'pending' || s.status === 'unsubscribed') {
    await payload.update({ collection: o.subscribersSlug as never, id: s.id, data: { status: 'confirmed', confirmedAt: new Date().toISOString(), unsubscribedAt: null } as never, overrideAccess: true, depth: 0 })
  }
  return 'ok'
}

export async function unsubscribe(payload: Payload, o: ResolvedNewsletterOptions, token: string | null | undefined): Promise<TokenResult> {
  const s = await subscriberByToken(payload, o, 'unsubscribe', token)
  if (!s) return 'invalid'
  if (s.status === 'confirmed' || s.status === 'pending') {
    await payload.update({ collection: o.subscribersSlug as never, id: s.id, data: { status: 'unsubscribed', unsubscribedAt: new Date().toISOString() } as never, overrideAccess: true, depth: 0 })
  }
  return 'ok'
}

/** Pending signups that never confirmed are removed after `pendingDays`. Returns how many. */
export async function deleteStalePending(payload: Payload, o: ResolvedNewsletterOptions, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - o.pendingDays * 86_400_000).toISOString()
  const res = await payload.delete({ collection: o.subscribersSlug as never, where: { and: [{ status: { equals: 'pending' } }, { or: [{ consentAt: { less_than: before } }, { and: [{ consentAt: { exists: false } }, { createdAt: { less_than: before } }] }] }] } as never, overrideAccess: true })
  return (res.docs ?? []).length
}

export type { Id }
