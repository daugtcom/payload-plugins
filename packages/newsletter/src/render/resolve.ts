import type { Payload } from 'payload'
import type { Id, ResolvedNewsletterOptions } from '../options'

type Doc = Record<string, any>

/** A block with everything the mail needs, no database ids left: addresses are absolute, documents loaded. */
export type ResolvedBlock =
  | { type: 'heading'; text: string; level: 'h1' | 'h2' | 'h3'; align: 'left' | 'center' }
  | { type: 'text'; content: unknown }
  | { type: 'image'; src: string; alt: string; caption?: string; href?: string }
  | { type: 'button'; label: string; href: string; align: 'left' | 'center' }
  | { type: 'divider'; large: boolean }
  | { type: 'columns'; src: string; alt: string; imageSide: 'left' | 'right'; heading?: string; content?: unknown; buttonLabel?: string; buttonHref?: string }
  | { type: 'teaser'; title: string; excerpt?: string; src?: string; href: string; label: string }

export interface ResolvedNewsletter { subject: string; preheader?: string; blocks: ResolvedBlock[] }

export const absoluteUrl = (base: string | undefined, url: string): string => (/^(https?:|mailto:|data:)/i.test(url) ? url : `${(base ?? '').replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`)
const idOf = (v: unknown): Id | undefined => (v && typeof v === 'object' ? (v as { id?: Id }).id : (v as Id | undefined)) ?? undefined

const defaultExcerpt = (doc: Doc): string | undefined => {
  const direct = doc.excerpt ?? doc.summary ?? doc.description
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  // first words of a lexical body
  const words: string[] = []
  const walk = (n: any) => { if (!n) return; if (typeof n.text === 'string') words.push(n.text); for (const c of n.children ?? []) walk(c) }
  walk(doc.body?.root)
  const text = words.join(' ').replace(/\s+/g, ' ').trim()
  return text ? (text.length > 180 ? `${text.slice(0, 177).replace(/\s+\S*$/, '')} …` : text) : undefined
}

/**
 * Turns newsletter data (a saved document at any depth, or the unsaved form values of the editor) into something renderable:
 * uploads and teaser documents are loaded by id when they are not populated yet.
 */
export async function resolveNewsletter(payload: Payload, o: ResolvedNewsletterOptions, data: Doc): Promise<ResolvedNewsletter> {
  const base = o.serverURL ?? payload.config.serverURL ?? undefined
  const load = async (collection: string, v: unknown): Promise<Doc | null> => {
    if (v && typeof v === 'object' && 'id' in (v as object) && Object.keys(v as object).length > 2) return v as Doc
    const id = idOf(v)
    if (id == null) return null
    return ((await payload.findByID({ collection: collection as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null) ?? null
  }
  const imageSrc = (m: Doc | null): string | undefined => {
    if (!m) return undefined
    const url = o.imageUrl ? o.imageUrl(m) : ((m.sizes?.optimized?.url as string | undefined) ?? (m.url as string | undefined))
    return url ? absoluteUrl(base, url) : undefined
  }
  const link = (u: unknown): string | undefined => (typeof u === 'string' && u.trim() ? absoluteUrl(base, u.trim()) : undefined)

  const blocks: ResolvedBlock[] = []
  for (const b of ((data.blocks ?? []) as Doc[])) {
    switch (b.blockType) {
      case 'heading': blocks.push({ type: 'heading', text: String(b.text ?? ''), level: b.level === 'h1' || b.level === 'h3' ? b.level : 'h2', align: b.align === 'center' ? 'center' : 'left' }); break
      case 'text': blocks.push({ type: 'text', content: b.content }); break
      case 'image': {
        const src = imageSrc(await load(o.mediaSlug, b.image))
        if (src) blocks.push({ type: 'image', src, alt: String(b.alt ?? ''), caption: b.caption || undefined, href: link(b.link) })
        break
      }
      case 'button': {
        const href = link(b.url)
        if (href && b.label) blocks.push({ type: 'button', label: String(b.label), href, align: b.align === 'center' ? 'center' : 'left' })
        break
      }
      case 'divider': blocks.push({ type: 'divider', large: b.spacing === 'large' }); break
      case 'columns': {
        const src = imageSrc(await load(o.mediaSlug, b.image))
        if (src) blocks.push({ type: 'columns', src, alt: String(b.heading ?? ''), imageSide: b.imageSide === 'right' ? 'right' : 'left', heading: b.heading || undefined, content: b.content, buttonLabel: b.buttonLabel || undefined, buttonHref: link(b.buttonUrl) })
        break
      }
      case 'teaser': {
        const ref = b.doc as { relationTo?: string; value?: unknown } | null
        if (!ref?.relationTo) break
        const doc = await load(ref.relationTo, ref.value)
        if (!doc) break
        const image = doc.image ?? doc.heroImage ?? doc.gallery?.[0]
        const media = image ? await load(o.mediaSlug, image) : null
        blocks.push({ type: 'teaser', title: String(doc.title ?? ''), excerpt: (o.excerptFor(ref.relationTo, doc) ?? defaultExcerpt(doc)) || undefined, src: imageSrc(media), href: absoluteUrl(base, o.hrefFor(ref.relationTo, doc)), label: String(b.buttonLabel || 'Weiterlesen') })
        break
      }
    }
  }
  return { subject: String(data.subject ?? ''), preheader: data.preheader || undefined, blocks }
}
