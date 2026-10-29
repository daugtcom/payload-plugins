import { SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { AutoRefresh, SearchBox, SubscribeToggle } from './controls'
import type { MediaLike } from './format'
import { t, type Locale } from './i18n'
import type { CourseFeed as Feed } from './member'
import { PostCard } from './PostCard'
import { defaultHrefs, type Hrefs } from './types'

const chip = { upcoming: 'bg-secondary-100 text-secondary-900', ended: 'bg-neutral-200 text-neutral-800' } as const

function Pagination({ page, total, pageSize, q, locale }: { page: number; total: number; pageSize: number; q?: string; locale: Locale }) {
  const L = t(locale)
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  const href = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`
  const link = 'rounded-lg border border-neutral-300 bg-white px-4 py-2 text-[0.95rem] font-medium text-primary-800 no-underline hover:bg-primary-50'
  return (
    <nav aria-label={L.pages} className="mt-10 flex items-center justify-center gap-4">
      {page > 1 ? <a className={link} href={href(page - 1)}>← {L.newer}</a> : <span className={`${link} opacity-40`}>← {L.newer}</span>}
      <span className="text-sm text-neutral-600 tabular-nums">{L.pageOf(page, pages)}</span>
      {page < pages ? <a className={link} href={href(page + 1)}>{L.older} →</a> : <span className={`${link} opacity-40`}>{L.older} →</span>}
    </nav>
  )
}

/** One course (its areas are the bubbles in the page header, see `CourseSection`): search, the email switch, the feed (posts as cards, member posts as comments). */
export function CourseFeed({ feed, q, memberPosts, composer, emojis, locale = 'de', hrefs, imageSrc, refreshSeconds = 10 }: { feed: Feed; q?: string; memberPosts: Map<string, ReactNode>; composer?: ReactNode; emojis: string[]; locale?: Locale; hrefs?: Partial<Hrefs>; imageSrc?: (m: MediaLike | null | undefined, size?: 'thumbnail' | 'optimized') => string | undefined; refreshSeconds?: number }) {
  const L = t(locale)
  const h = { ...defaultHrefs, ...hrefs }
  const { course } = feed
  return (
    <div>
      {refreshSeconds > 0 && <AutoRefresh seconds={refreshSeconds} />}
      {(feed.state !== 'active' || course.summary) && (
        <div className="flex flex-wrap items-center gap-4">
          {feed.state !== 'active' && <span className={`rounded-full px-3 py-1 text-sm font-medium ${chip[feed.state]}`}>{L[feed.state]}</span>}
          {course.summary && <p className="m-0 max-w-2xl text-neutral-600">{course.summary}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <SearchBox locale={locale} />
        <SubscribeToggle courseId={course.id} subscribed={feed.subscribed} locale={locale} />
      </div>

      {composer && <div className="mt-8 max-w-3xl rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6"><h2 className="m-0 mb-3 font-display text-2xl font-semibold text-primary-950">{L.shareTitle}</h2>{composer}</div>}

      {feed.items.length === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-neutral-300 px-6 py-16 text-center">
          <SearchX className="h-8 w-8 text-neutral-400" aria-hidden />
          <p className="m-0 mt-3 text-lg font-semibold text-primary-950">{q ? L.nothingFound(q) : L.nothingYet}</p>
          <p className="m-0 mt-1 text-neutral-600">{q ? L.tryOther : L.nothingYetHint}</p>
          {q && <a href="?" className="mt-4 font-semibold text-primary-700">{L.resetSearch}</a>}
        </div>
      ) : (
        <ul className="mt-8 grid list-none! gap-5 p-0! sm:grid-cols-2 lg:grid-cols-3">
          {feed.items.map((i) =>
            i.kind === 'post' ? (
              <li key={`p${i.id}`} className="m-0!"><PostCard post={i} emojis={emojis} canReact={feed.canReact} locale={locale} hrefs={hrefs} imageSrc={imageSrc} /></li>
            ) : (
              <li key={`m${i.id}`} className="m-0! sm:col-span-2 lg:col-span-3">{memberPosts.get(String(i.id))}</li>
            ),
          )}
        </ul>
      )}
      <Pagination page={feed.page} total={feed.total} pageSize={feed.pageSize} q={q} locale={locale} />
    </div>
  )
}
