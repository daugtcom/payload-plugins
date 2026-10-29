import { createElement, type ReactElement } from 'react'
import { render } from '@react-email/components'
import { TransactionalMail } from './components'
export { MailShell, MailButton, TransactionalMail } from './components'

/**
 * Themed transactional emails for the member portal. React Email components, with no Payload dependency: every plugin that mails
 * (booking confirmations and reminders, new-content notifications, login codes) builds a `MailContent` and the
 * site's theme turns it into branded HTML plus a plain-text twin.
 */

export interface MailTheme {
  /** Name in the header and footer, e.g. "Margaretha Brunner". */
  siteName: string
  /** Absolute URL of the site (links in the footer). */
  baseUrl?: string
  /** Absolute URL of a logo image (PNG/JPG; most mail clients drop SVG). Shown next to the site name; without it the name alone is set in the display font. */
  logoUrl?: string
  /** Show the logo without the name next to it (when the logo already contains the name). */
  logoOnly?: boolean
  colors: {
    /** Buttons, links, accents. */
    primary: string
    /** Text on the primary colour. Default white. */
    onPrimary?: string
    /** Headings. */
    heading: string
    /** Body text. */
    text: string
    /** Secondary text, footer. */
    muted: string
    /** Page background around the card. */
    background: string
    /** The card itself. Default white. */
    card?: string
    /** Hairlines. */
    border: string
    /** Soft tint behind the facts box. */
    tint: string
  }
  fonts?: {
    /** CSS font stack for headings, with a safe fallback: web fonts rarely load in mail clients. Default Georgia. */
    display?: string
    body?: string
  }
  /** Two lines under the card, e.g. address or "You get this mail because …". */
  footer?: string[]
}

/** Neutral fallback for sites that have not configured branding. */
export function defaultMailTheme(siteName = 'Your site'): MailTheme {
  return { siteName, colors: { primary: '#245b91', heading: '#17212b', text: '#26323c', muted: '#66717a', background: '#f5f6f7', border: '#d6dce0', tint: '#edf2f5' } }
}

export interface MailContent {
  /** Hidden preview line shown next to the subject in the inbox. */
  preheader?: string
  /** Small coloured line above the heading, e.g. "Termin bestätigt". */
  eyebrow?: string
  heading: string
  /** Paragraphs; **bold** is supported. */
  paragraphs?: string[]
  /** A label/value box, e.g. date, place. */
  facts?: { label: string; value: string }[]
  button?: { label: string; href: string }
  /** Paragraphs after the button, smaller. */
  note?: string[]
  /** Appended under the card, e.g. an unsubscribe link. */
  footerLinks?: { label: string; href: string }[]
  /** Sign-off under the body, e.g. "Herzlich, Margaretha". */
  signoff?: string
}

export interface RenderedMail { html: string; text: string }

/** Render arbitrary shared-shell emails such as an editor-built newsletter. */
export async function renderEmail(element: ReactElement): Promise<RenderedMail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { html, text }
}

const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1')

/** Render the built-in transactional template as HTML and text. */
export async function renderMail(theme: MailTheme, c: MailContent): Promise<RenderedMail> {
  const html = await render(createElement(TransactionalMail, { theme, content: c }))
  const text = [c.eyebrow ? c.eyebrow.toUpperCase() : '', plain(c.heading), ...(c.paragraphs ?? []).map(plain), ...(c.facts ?? []).map((f) => `${f.label}: ${plain(f.value)}`), c.button ? `${c.button.label}: ${c.button.href}` : '', ...(c.note ?? []).map(plain), c.signoff ? plain(c.signoff) : '', ...(c.footerLinks ?? []).map((l) => `${l.label}: ${l.href}`)].filter(Boolean).join('\n\n')
  return { html, text }
}

/** `layout` as the plugins take it: content in, branded mail out. */
export const mailLayout = (theme: MailTheme) => (c: MailContent): Promise<RenderedMail> => renderMail(theme, c)

/** A ready `renderEmail` for `createNotifications`: "something new" mails in the theme. */
export const themedNotification = (theme: MailTheme, t: { eyebrow?: string; button?: string; unsubscribe?: string; intro?: (title: string) => string } = {}) =>
  async ({ title, url, unsubscribeUrl }: { title: string; url?: string; unsubscribeUrl: string; recipient: { email: string } }) => {
    const m = await renderMail(theme, {
      preheader: title,
      eyebrow: t.eyebrow ?? 'Neu für dich',
      heading: title,
      paragraphs: [t.intro?.(title) ?? 'Im Mitgliederbereich gibt es etwas Neues.'],
      button: url ? { label: t.button ?? 'Jetzt ansehen', href: url } : undefined,
      footerLinks: [{ label: t.unsubscribe ?? 'Benachrichtigungen für diesen Kurs abbestellen', href: unsubscribeUrl }],
    })
    return { subject: title, ...m }
  }

/** A ready `renderEmail` for the passwordless plugin's login mail. */
export const themedLoginEmail = (theme: MailTheme) =>
  async ({ code, link, ttlMinutes }: { code: string; link: string; ttlMinutes: number }) => {
    const m = await renderMail(theme, {
      preheader: `Dein Anmeldecode: ${code}`,
      eyebrow: 'Anmeldung',
      heading: 'Dein Anmeldecode',
      paragraphs: ['Gib diesen Code ein oder melde dich direkt mit dem Button an.'],
      facts: [{ label: 'Code', value: `**${code}**` }],
      button: { label: 'Direkt anmelden', href: link },
      note: [`Code und Link gelten ${ttlMinutes} Minuten. Falls du dich nicht anmelden wolltest, kannst du diese E-Mail einfach ignorieren.`],
    })
    return { subject: `Dein Anmeldecode: ${code}`, ...m }
  }

/** A ready `renderEmailChange` for the passwordless plugin ("confirm your new address"). */
export const themedEmailChangeEmail = (theme: MailTheme) =>
  async ({ code, ttlMinutes }: { email: string; code: string; ttlMinutes: number }) => {
    const m = await renderMail(theme, {
      preheader: `Dein Bestätigungscode: ${code}`,
      eyebrow: 'Neue E-Mail-Adresse',
      heading: 'Bitte bestätige deine neue Adresse',
      paragraphs: ['Gib diesen Code im Konto ein, um die neue E-Mail-Adresse zu bestätigen.'],
      facts: [{ label: 'Code', value: `**${code}**` }],
      note: [`Der Code gilt ${ttlMinutes} Minuten. Falls du das nicht angefordert hast, ignoriere diese E-Mail einfach.`],
    })
    return { subject: `Neue E-Mail-Adresse bestätigen: ${code}`, ...m }
  }
