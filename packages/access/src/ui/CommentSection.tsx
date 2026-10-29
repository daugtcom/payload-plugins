'use client'

import { MessageCircle, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { formatDate } from './format'
import { t, type Locale } from './i18n'
import { Composer } from './RichComposer'
import { Reactions } from './Reactions'

export interface CommentImage { id: number | string; url: string; thumb: string }

export interface CommentView {
  id: number | string
  authorName: string | null
  anonymous: boolean
  createdAt: string
  canDelete: boolean
  /** the rendered body (rich text is rendered on the server) */
  body: ReactNode
  reactions: Record<string, number>
  myEmoji: string | null
  replies: CommentView[]
  /** pictures attached to the comment */
  images?: CommentImage[]
  /** blanked after deletion because replies hang on it */
  deleted?: boolean
}

export interface CommentTarget { relationTo: string; value: number | string }

const dateOf = (iso: string, locale: Locale) => formatDate(iso, locale === 'de' ? 'de-AT' : 'en-GB')

function Lightbox({ images, start, onClose, locale }: { images: CommentImage[]; start: number; onClose: () => void; locale: Locale }) {
  const L = t(locale)
  const [at, setAt] = useState(start)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setAt((i) => (i + 1) % images.length)
      if (e.key === 'ArrowLeft') setAt((i) => (i - 1 + images.length) % images.length)
    }
    document.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [images.length, onClose])
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-primary-950/90 p-4" onClick={onClose}>
      <button type="button" aria-label={L.closeImage} autoFocus onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-white hover:bg-white/10"><X className="h-7 w-7" /></button>
      <img src={images[at]!.url} alt="" className="max-h-full max-w-full rounded-md object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}

function Item({ c, canComment, canReact, emojis, locale, depth, card, allowImages }: { c: CommentView; canComment: boolean; canReact: boolean; emojis: string[]; locale: Locale; depth: number; card: boolean; allowImages: boolean }) {
  const L = t(locale)
  const router = useRouter()
  const [replying, setReplying] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const shell = depth ? 'mt-5 border-t border-neutral-100 pt-5' : card ? 'rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6' : 'border-t border-neutral-200 py-6 first:border-t-0'
  const name = c.deleted ? L.deletedAuthor : c.anonymous ? L.anonymousAuthor : (c.authorName ?? L.memberFallback)
  return (
    <li className={shell}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-800">{c.deleted || c.anonymous ? '?' : name.charAt(0).toUpperCase()}</span>
        <div className="min-w-0">
          <p className={`m-0 truncate font-semibold ${c.deleted ? 'text-neutral-500 italic' : 'text-neutral-900'}`}>{name}</p>
          <p className="m-0 text-sm text-neutral-500">{dateOf(c.createdAt, locale)}</p>
        </div>
      </div>
      {c.deleted ? (
        <p className="m-0 mt-3 text-neutral-500 italic">{L.deletedBody}</p>
      ) : (
        <>
          <div className="mt-3 text-neutral-800 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6">{c.body}</div>
          {c.images && c.images.length > 0 && (
            <ul className="m-0 mt-3 grid list-none! grid-cols-3 gap-2 p-0! sm:grid-cols-4 lg:grid-cols-6">
              {c.images.map((img, i) => (
                <li key={img.id} className="m-0!"><button type="button" aria-label={L.openImage} onClick={() => setLightbox(i)} className="block aspect-square w-full overflow-hidden rounded-lg bg-neutral-100"><img src={img.thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" /></button></li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {!c.deleted && <Reactions target={{ relationTo: 'comments', value: c.id }} summary={c.reactions} mine={c.myEmoji} emojis={emojis} canReact={canReact} locale={locale} />}
        {canComment && depth < 2 && <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-primary-700" onClick={() => setReplying((r) => !r)}><MessageCircle className="h-4 w-4" aria-hidden />{L.reply}</button>}
        {c.canDelete && !c.deleted && !confirming && <button type="button" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-red-700" onClick={() => setConfirming(true)}><Trash2 className="h-4 w-4" aria-hidden />{L.delete}</button>}
        {confirming && (
          <span className="inline-flex items-center gap-3 text-sm">
            <span className="text-neutral-700">{L.deleteConfirm}</span>
            <button type="button" className="font-semibold text-red-700 hover:underline" onClick={async () => { const r = await api(`/engagement/comments/${c.id}`, { method: 'DELETE' }).catch(() => null); if (r?.ok) router.refresh(); else { setFailed(true); setConfirming(false) } }}>{L.deleteYes}</button>
            <button type="button" className="text-neutral-600 hover:underline" onClick={() => setConfirming(false)}>{L.cancel}</button>
          </span>
        )}
      </div>
      {failed && <p role="alert" className="m-0 mt-2 text-sm text-red-700">{L.deleteFailed}</p>}
      {replying && <div className="mt-4"><Composer target={{ relationTo: 'comments', value: c.id }} placeholder={L.yourReply} label={L.reply} allowImages={allowImages} onDone={() => setReplying(false)} locale={locale} /></div>}
      {c.replies.length > 0 && <ul className="m-0 mt-5 list-none! space-y-0 border-l-2 border-neutral-100 p-0! pl-5">{c.replies.map((r) => <Item key={r.id} c={r} canComment={canComment} canReact={canReact} emojis={emojis} locale={locale} depth={depth + 1} card={false} allowImages={allowImages} />)}</ul>}
      {lightbox !== null && c.images && <Lightbox images={c.images} start={lightbox} onClose={() => setLightbox(null)} locale={locale} />}
    </li>
  )
}

/** A list of comments with replies, pictures, reactions and delete. `card` draws every top-level comment as its own card (course feed). */
export function CommentThread({ comments, canComment, canReact, emojis, locale = 'de', card = false, allowImages = false }: { comments: CommentView[]; canComment: boolean; canReact: boolean; emojis: string[]; locale?: Locale; card?: boolean; allowImages?: boolean }) {
  if (!comments.length) return null
  return <ul className={`m-0 list-none! p-0! ${card ? 'flex flex-col gap-4' : ''}`}>{comments.map((c) => <Item key={c.id} c={c} canComment={canComment} canReact={canReact} emojis={emojis} locale={locale} depth={0} card={card} allowImages={allowImages} />)}</ul>
}

const countAll = (list: CommentView[]): number => list.reduce((n, c) => n + (c.deleted ? 0 : 1) + countAll(c.replies), 0)

/**
 * The discussion under a post or a course section: count, writing box, thread.
 * What each member may do is decided on the server (`getItemAccess`); the client only shows it.
 */
export function CommentSection({ target, comments, canComment, canReact, emojis, locale = 'de', title, allowAnonymous = true, allowImages = true }: { target: CommentTarget; comments: CommentView[]; canComment: boolean; canReact: boolean; emojis: string[]; locale?: Locale; title?: string; allowAnonymous?: boolean; allowImages?: boolean }) {
  const L = t(locale)
  const heading = title ?? L.comments
  return (
    <section id="kommentare" aria-label={heading} className="scroll-mt-24">
      <h2 className="m-0 font-display text-3xl font-semibold text-primary-950">{heading} <span className="text-neutral-400">({countAll(comments)})</span></h2>
      {canComment && <div className="mt-5"><Composer target={target} allowAnonymous={allowAnonymous} allowImages={allowImages} locale={locale} /></div>}
      {comments.length === 0 && <p className="mt-6 text-neutral-500">{canComment ? L.firstComment : L.noComments}</p>}
      <div className="mt-6"><CommentThread comments={comments} canComment={canComment} canReact={canReact} emojis={emojis} locale={locale} allowImages={allowImages} /></div>
    </section>
  )
}

/** Kept for sites that used the old name: the reaction row now is {@link Reactions}. */
export { Reactions as ReactionBar } from './Reactions'
