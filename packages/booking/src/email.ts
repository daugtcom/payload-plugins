import { defaultMailTheme, mailLayout } from '@daugtcom/payload-mail'
import { DateTime } from 'luxon'
import type { Payload } from 'payload'
import { buildIcs } from './ics'
import type { Id, ResolvedBookingOptions } from './options'

type Doc = Record<string, any>

export const fmtWhen = (d: Date | string, tz: string) => DateTime.fromJSDate(new Date(d), { zone: tz }).setLocale('de').toFormat("cccc, d. LLLL yyyy 'um' HH:mm 'Uhr'")
const LOCATION = { online: 'Online (Videoanruf im Mitgliederbereich)', phone: 'Telefon', inperson: 'Vor Ort' } as const

export const joinUrl = (o: ResolvedBookingOptions, base: string | undefined, sessionId: Id) => {
  const path = o.live?.joinHref?.(sessionId) ?? `/access/live/${sessionId}`
  return /^https?:/.test(path) ? path : `${(base ?? '').replace(/\/$/, '')}${path}`
}

export interface MailContent {
  preheader?: string
  eyebrow?: string
  heading: string
  paragraphs?: string[]
  facts?: { label: string; value: string }[]
  button?: { label: string; href: string }
  note?: string[]
  signoff?: string
}
export type MailLayout = (c: MailContent) => { html: string; text: string } | Promise<{ html: string; text: string }>

/** Default branded layout; the site may replace it through mailLayout. */
export const defaultLayout: MailLayout = mailLayout(defaultMailTheme())

/** Emails never break a booking: a failure is logged and the booking stands. */
export async function send(payload: Payload, o: ResolvedBookingOptions, msg: { to: string | string[]; subject: string; content: MailContent; ics?: string }): Promise<void> {
  if (!o.email || !msg.to.length) return
  try {
    const { html, text } = await (o.mailLayout ?? mailLayout(o.mailTheme ?? defaultMailTheme(o.siteName)))({ signoff: o.siteName ? `Herzlich,\n${o.siteName}` : undefined, ...msg.content })
    await payload.sendEmail({
      to: msg.to,
      subject: msg.subject,
      text,
      html,
      ...(msg.ics ? { attachments: [{ filename: 'termin.ics', content: msg.ics, contentType: 'text/calendar; charset=utf-8' }] } : {}),
    } as never)
  } catch (err) {
    payload.logger.error({ err, msg: 'payload-booking: email failed' })
  }
}

const eventOf = (b: Doc, o: ResolvedBookingOptions, base: string | undefined, cancelled = false) => ({
  uid: `booking-${b.id}@${(base ?? 'booking').replace(/^https?:\/\//, '').replace(/[/:]/g, '')}`,
  start: new Date(b.start),
  end: new Date(b.end),
  summary: String(b.title ?? 'Termin'),
  location: LOCATION[(b.location as keyof typeof LOCATION) ?? 'online'] ?? undefined,
  url: b.liveSession ? joinUrl(o, base, b.liveSession) : undefined,
  cancelled,
  sequence: cancelled ? 1 : 0,
})

const first = (name?: string | null) => (name ? name.split(' ')[0] : '')
const hello = (name?: string | null) => `Hallo${first(name) ? ` ${first(name)}` : ''},`
const dateOnly = (d: Date | string, tz: string) => DateTime.fromJSDate(new Date(d), { zone: tz }).setLocale('de').toFormat('d. LLLL')
/** "Einzelsitzung online (Demo) · Dienstag, 27. Oktober 2026 um 10:00 Uhr" → the part before the date. */
const nameOf = (b: Doc) => String(b.title ?? 'Termin').split(' · ')[0] ?? 'Termin'
const facts = (b: Doc, o: ResolvedBookingOptions) => [
  { label: 'Termin', value: nameOf(b) },
  { label: 'Wann', value: fmtWhen(b.start, o.timezone) },
  { label: 'Wo', value: LOCATION[(b.location as keyof typeof LOCATION) ?? 'online'] ?? LOCATION.online },
]
const manageUrl = (base: string | undefined) => (base ? `${base.replace(/\/$/, '')}/access/termine` : undefined)

type Customer = { email?: string; name?: string | null }

export async function mailConfirmed(payload: Payload, o: ResolvedBookingOptions, b: Doc, customer: Customer, base: string | undefined): Promise<void> {
  if (!customer.email) return
  const join = b.liveSession ? joinUrl(o, base, b.liveSession) : undefined
  const manage = manageUrl(base)
  await send(payload, o, {
    to: customer.email,
    subject: `Dein Termin: ${nameOf(b)} am ${dateOnly(b.start, o.timezone)}`,
    content: {
      preheader: `${fmtWhen(b.start, o.timezone)} · ${nameOf(b)}`,
      eyebrow: 'Termin bestätigt',
      heading: 'Dein Termin steht',
      paragraphs: [hello(customer.name), 'danke für deine Buchung. Ich freue mich auf unsere gemeinsame Zeit.', ...(b.liveSession ? ['Zum Termin trittst du ganz einfach hier im Browser bei, es ist keine App nötig.'] : []), ...(b.recording ? ['Wie gebucht wird der Videoanruf aufgezeichnet. Du siehst im Raum, dass die Aufnahme läuft, und findest sie danach in deinem Mitgliederbereich unter „Aufnahmen“.'] : [])],
      facts: facts(b, o),
      button: join ? { label: 'Zum Videoanruf', href: join } : manage ? { label: 'Meine Termine', href: manage } : undefined,
      note: [
        'Die Kalenderdatei im Anhang trägt den Termin in deinen Kalender ein.',
        ...(manage ? [`Absagen oder verschieben kannst du unter „Termine“ in deinem Mitgliederbereich, kostenlos bis ${b.cancellationHours ?? 48} Stunden vorher: ${manage}`] : []),
      ],
    },
    ics: buildIcs(eventOf(b, o, base)),
  })
}

export async function mailCancelled(payload: Payload, o: ResolvedBookingOptions, b: Doc, customer: Customer, base: string | undefined, by: 'customer' | 'staff'): Promise<void> {
  if (!customer.email) return
  await send(payload, o, {
    to: customer.email,
    subject: `Termin abgesagt: ${nameOf(b)}`,
    content: {
      preheader: `${fmtWhen(b.start, o.timezone)} wurde abgesagt`,
      eyebrow: 'Termin abgesagt',
      heading: by === 'customer' ? 'Du hast den Termin abgesagt' : 'Dein Termin wurde abgesagt',
      paragraphs: [hello(customer.name), by === 'customer' ? 'der folgende Termin ist abgesagt und aus deinem Kalender entfernt, sobald du die Datei im Anhang öffnest.' : 'leider muss der folgende Termin entfallen.', ...(b.refundNeeded ? ['Die Rückerstattung veranlassen wir in Kürze.'] : [])],
      facts: facts(b, o),
      button: shopButton(base),
    },
    ics: buildIcs(eventOf(b, o, base, true)),
  })
}

const shopButton = (base: string | undefined) => (base ? { label: 'Neuen Termin wählen', href: base.replace(/\/$/, '') } : undefined)

/** `hoursBefore` is what was configured (24, 1, …): the wording follows it. */
export async function mailReminder(payload: Payload, o: ResolvedBookingOptions, b: Doc, customer: Customer, base: string | undefined, hoursBefore: number): Promise<void> {
  if (!customer.email) return
  const join = b.liveSession ? joinUrl(o, base, b.liveSession) : undefined
  const manage = manageUrl(base)
  const soon = hoursBefore <= 2
  await send(payload, o, {
    to: customer.email,
    subject: soon ? `Gleich geht es los: ${nameOf(b)}` : `Erinnerung: ${nameOf(b)} am ${dateOnly(b.start, o.timezone)}`,
    content: {
      preheader: fmtWhen(b.start, o.timezone),
      eyebrow: soon ? 'In Kürze' : 'Erinnerung',
      heading: soon ? `In ${hoursBefore === 1 ? 'einer Stunde' : `${hoursBefore} Stunden`} geht es los` : 'Morgen sehen wir uns',
      paragraphs: [hello(customer.name), soon ? (join ? 'du kannst schon ein paar Minuten vorher beitreten, der Raum ist dann offen.' : 'ich freue mich auf dich.') : 'eine kleine Erinnerung an deinen Termin.'],
      facts: facts(b, o),
      button: join ? { label: 'Zum Videoanruf', href: join } : manage ? { label: 'Meine Termine', href: manage } : undefined,
      note: !soon && manage ? [`Falls etwas dazwischenkommt, kannst du unter „Termine“ absagen oder verschieben: ${manage}`] : [],
    },
  })
}

export async function mailHost(payload: Payload, o: ResolvedBookingOptions, hosts: string[], subject: string, b: Doc, customer: Customer, extra = '', base?: string): Promise<void> {
  await send(payload, o, {
    to: hosts,
    subject,
    content: { eyebrow: 'Für dich als Gastgeberin', heading: subject, paragraphs: extra ? [extra] : [], button: base ? { label: 'Alle Termine ansehen', href: `${base.replace(/\/$/, '')}/access/termine` } : undefined, facts: [...facts(b, o), { label: 'Kundin', value: `${customer.name ?? ''} ${customer.email ?? ''}`.trim() || '–' }] },
  })
}
