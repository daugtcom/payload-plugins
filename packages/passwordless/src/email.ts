import { defaultMailTheme, renderMail, type MailTheme } from '@daugtcom/payload-mail'
import type { Payload } from 'payload'
import type { EmailChangeInput, EmailContent, LoginEmailInput } from './options'

export const defaultLoginEmail = async ({ code, link, ttlMinutes }: LoginEmailInput, theme: MailTheme = defaultMailTheme()): Promise<EmailContent> => ({
  subject: `Your login code: ${code}`,
  ...await renderMail(theme, { heading: 'Your login code', paragraphs: [`Your login code is ${code}.`], button: { label: 'Log in directly', href: link }, note: [`The code and the link work for ${ttlMinutes} minutes. If you did not ask for it, you can ignore this email.`] }),
})

export const defaultSend = async (payload: Payload, to: string, c: EmailContent): Promise<void> => {
  await payload.sendEmail({ to, subject: c.subject, text: c.text, html: c.html })
}

export const defaultEmailChangeEmail = async ({ code, ttlMinutes }: EmailChangeInput, theme: MailTheme = defaultMailTheme()): Promise<EmailContent> => ({
  subject: `Neue E-Mail-Adresse bestätigen: ${code} / Confirm your new address: ${code}`,
  ...await renderMail(theme, { heading: 'E-Mail-Adresse bestätigen / Confirm your email address', paragraphs: [`Dein Code zum Bestätigen deiner neuen E-Mail-Adresse lautet ${code}.`, `Der Code ist ${ttlMinutes} Minuten gültig. Falls du das nicht angefordert hast, ignoriere diese E-Mail einfach.`, `Your code to confirm your new email address is ${code}.`, `The code works for ${ttlMinutes} minutes. If you did not ask for it, you can ignore this email.`] }),
})
