import { renderEmail } from '@daugtcom/payload-mail'
import { createElement } from 'react'
import type { Payload } from 'payload'
import type { ResolvedNewsletterOptions } from '../options'
import { Newsletter, UNSUBSCRIBE_PLACEHOLDER } from './Newsletter'
import { resolveNewsletter } from './resolve'

export { UNSUBSCRIBE_PLACEHOLDER } from './Newsletter'
export { resolveNewsletter, absoluteUrl, type ResolvedBlock, type ResolvedNewsletter } from './resolve'

export interface RenderedNewsletter { subject: string; html: string; text: string }

/**
 * A newsletter as HTML and text, in the site's mail theme. `data` is a saved newsletter or the editor's unsaved form values.
 * The unsubscribe link is a placeholder; `personalize` puts each recipient's own in.
 */
export async function renderNewsletter(payload: Payload, o: ResolvedNewsletterOptions, data: Record<string, any>): Promise<RenderedNewsletter> {
  const newsletter = await resolveNewsletter(payload, o, data)
  const el = createElement(Newsletter, { theme: o.theme, newsletter, postalAddress: o.postalAddress })
  return { subject: newsletter.subject, ...(await renderEmail(el)) }
}

export const personalize = (r: RenderedNewsletter, unsubscribeUrl: string): { html: string; text: string } => ({
  html: r.html.split(UNSUBSCRIBE_PLACEHOLDER).join(unsubscribeUrl),
  text: r.text.split(UNSUBSCRIBE_PLACEHOLDER).join(unsubscribeUrl),
})
