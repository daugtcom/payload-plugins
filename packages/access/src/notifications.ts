import { defaultMailTheme, renderMail } from '@daugtcom/payload-mail'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'
import type { AccessService } from './service'
import type { TargetRef } from './types'

type Id = string | number
type Doc = Record<string, any> & { id: Id }

export interface NotificationOptions {
  logSlug?: string
  subscriptionsSlug?: string
  usersSlug?: string
  /** Public base URL for the unsubscribe link. Default: `payload.config.serverURL`. */
  serverURL?: string
  /** Optional shared site theme for the built-in notification email. */
  mailTheme?: import('@daugtcom/payload-mail').MailTheme
  /** Build the email for one recipient. Default: plain message with the title and a link. */
  renderEmail?: (i: { title: string; url?: string; unsubscribeUrl: string; recipient: { email: string } }) => { subject: string; text: string; html?: string } | Promise<{ subject: string; text: string; html?: string }>
  /** Send it. Default: `payload.sendEmail`. */
  sendEmail?: (payload: Payload, to: string, c: { subject: string; text: string; html?: string }) => Promise<void>
}

export interface Recipient {
  userId: Id
  email: string
  reasons: ('subscribed' | 'direct-access')[]
}

export interface RecipientPreview {
  recipients: Recipient[]
  /** Subscribed, but cannot see the content (yet): not mailed, and why. */
  excluded: { userId: Id; email: string; reason: 'no-access' }[]
}

const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

/**
 * Who gets the "something new" mail for a piece of content:
 *  - members subscribed to one of its courses who can actually see it (access windows decide), and
 *  - members who bought the content directly.
 * Preview shows both lists and the reasons, so staff see exactly who is mailed and who is left out.
 */
export async function previewRecipients(payload: Payload, service: AccessService, o: { target: TargetRef; seriesField?: string; courseCollection?: string } & NotificationOptions): Promise<RecipientPreview> {
  const usersSlug = o.usersSlug ?? 'users'
  const subsSlug = o.subscriptionsSlug ?? 'notificationSubscriptions'
  const content = (await payload.findByID({ collection: o.target.relationTo as never, id: o.target.value, depth: 0, overrideAccess: true })) as Doc
  const courses = ((content[o.seriesField ?? 'series'] as unknown[] | undefined) ?? []).map(idOf)

  const byUser = new Map<string, Recipient>()
  const excluded = new Map<string, { userId: Id; email: string; reason: 'no-access' }>()
  const emailOf = async (id: Id) => ((await payload.findByID({ collection: usersSlug as never, id, depth: 0, overrideAccess: true })) as Doc).email as string
  const add = async (userId: Id, reason: Recipient['reasons'][number]) => {
    const key = String(userId)
    const existing = byUser.get(key)
    if (existing) { if (!existing.reasons.includes(reason)) existing.reasons.push(reason); return }
    byUser.set(key, { userId, email: await emailOf(userId), reasons: [reason] })
  }

  for (const course of courses) {
    const subs = await payload.find({ collection: subsSlug as never, where: { and: [{ 'target.relationTo': { equals: o.courseCollection ?? 'courses' } }, { 'target.value': { equals: course } }] }, limit: 0, pagination: false, depth: 0, overrideAccess: true })
    for (const s of subs.docs as unknown as Doc[]) {
      const userId = idOf(s.user)
      if (await service.can('view', { id: userId }, o.target)) await add(userId, 'subscribed')
      else if (!byUser.has(String(userId))) excluded.set(String(userId), { userId, email: await emailOf(userId), reason: 'no-access' })
    }
  }
  for (const userId of await service.usersWithAccessToTarget(o.target)) await add(userId, 'direct-access')

  for (const key of byUser.keys()) excluded.delete(key)
  return { recipients: [...byUser.values()], excluded: [...excluded.values()] }
}

const sign = (secret: string, userId: Id, courseId: Id) => createHmac('sha256', secret).update(`unsubscribe:${userId}:${courseId}`).digest('hex')

export const unsubscribeToken = (payload: Payload, userId: Id, courseId: Id) => sign(payload.secret, userId, courseId)

export const verifyUnsubscribeToken = (payload: Payload, userId: Id, courseId: Id, token: string): boolean => {
  const expected = Buffer.from(sign(payload.secret, userId, courseId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export interface SendResult {
  sent: number
  failed: { email: string; error: string }[]
  logId: Id
}

/** Mail every recipient (in small batches), then write what was sent into the notification log. */
export async function sendContentNotification(payload: Payload, service: AccessService, o: { target: TargetRef; title: string; url?: string; seriesField?: string; courseCollection?: string } & NotificationOptions): Promise<SendResult> {
  const preview = await previewRecipients(payload, service, o)
  const base = (o.serverURL ?? payload.config.serverURL ?? '').replace(/\/$/, '')
  const content = (await payload.findByID({ collection: o.target.relationTo as never, id: o.target.value, depth: 0, overrideAccess: true })) as Doc
  const course = ((content[o.seriesField ?? 'series'] as unknown[] | undefined) ?? []).map(idOf)[0]
  const send = o.sendEmail ?? (async (p: Payload, to: string, c) => void (await p.sendEmail({ to, subject: c.subject, text: c.text, html: c.html })))
  const render: NonNullable<NotificationOptions['renderEmail']> = o.renderEmail ?? (async ({ title, url, unsubscribeUrl }) => ({
    subject: title,
    ...await renderMail(o.mailTheme ?? defaultMailTheme(), { heading: title, button: url ? { label: 'View', href: url } : undefined, footerLinks: [{ label: 'Unsubscribe', href: unsubscribeUrl }] }),
  }))

  let sent = 0
  const failed: SendResult['failed'] = []
  for (let i = 0; i < preview.recipients.length; i += 25) {
    await Promise.all(
      preview.recipients.slice(i, i + 25).map(async (r) => {
        const token = course === undefined ? '' : unsubscribeToken(payload, r.userId, course)
        const unsubscribeUrl = `${base}/api/access/notifications/unsubscribe?user=${r.userId}&course=${course ?? ''}&token=${token}`
        try {
          await send(payload, r.email, await render({ title: o.title, url: o.url, unsubscribeUrl, recipient: r }))
          sent++
        } catch (err) {
          failed.push({ email: r.email, error: (err as Error).message })
        }
      }),
    )
  }

  const log = (await payload.create({
    collection: (o.logSlug ?? 'notificationLog') as never,
    data: { title: o.title, preview: o.title + (o.url ? `\n${o.url}` : ''), recipientsCount: sent, target: o.target } as never,
    overrideAccess: true,
  })) as unknown as Doc
  return { sent, failed, logId: log.id }
}
