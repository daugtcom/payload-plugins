import { MessageCircle } from 'lucide-react'
import { formatDate, mediaSrc, type MediaLike } from './format'
import { t, type Locale } from './i18n'
import { Reactions } from './Reactions'
import type { FeedPost } from './member'
import { defaultHrefs, type Hrefs } from './types'

/** One post in the course feed: picture, title, a line of text, reactions (right from the card) and the comment count. The whole card opens the post. */
export function PostCard({ post, emojis, canReact, locale = 'de', hrefs, imageSrc = mediaSrc }: { post: FeedPost; emojis: string[]; canReact: boolean; locale?: Locale; hrefs?: Partial<Hrefs>; imageSrc?: (m: MediaLike | null | undefined, size?: 'thumbnail' | 'optimized') => string | undefined }) {
  const L = t(locale)
  const h = { ...defaultHrefs, ...hrefs }
  const src = imageSrc(post.image as MediaLike | null, 'thumbnail') ?? imageSrc(post.image as MediaLike | null, 'optimized')
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-shadow focus-within:shadow-lg hover:shadow-lg hover:shadow-primary-950/10">
      {src ? (
        <div className="aspect-[16/10] w-full overflow-hidden bg-primary-100"><img src={src} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-105" /></div>
      ) : (
        <div aria-hidden className="h-2 w-full bg-gradient-to-r from-primary-600 via-primary-400 to-secondary-400" />
      )}
      <div className="flex flex-1 flex-col p-5">
        <p className="m-0 text-sm text-neutral-500">{formatDate(post.date, locale === 'de' ? 'de-AT' : 'en-GB')}</p>
        <h3 className="m-0 mt-1 font-display text-2xl leading-tight font-semibold text-primary-950">
          <a href={h.post(post.slug)} className="text-inherit no-underline transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-primary-700">{post.title}</a>
        </h3>
        {post.excerpt && <p className="m-0 mt-2 line-clamp-2 text-[0.95rem] leading-relaxed text-neutral-600">{post.excerpt}</p>}
        <div className="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
          <Reactions target={{ relationTo: 'lessons', value: post.id }} summary={post.reactions} mine={post.mine} emojis={emojis} canReact={canReact} locale={locale} />
          {post.comments > 0 && <a href={`${h.post(post.slug)}#kommentare`} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 no-underline hover:text-primary-700"><MessageCircle className="h-4 w-4" aria-hidden /><span className="tabular-nums">{post.comments}</span><span className="sr-only">{L.commentsCount}</span></a>}
        </div>
      </div>
    </article>
  )
}
