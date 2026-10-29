import { notFound } from 'next/navigation'
import type { Payload } from 'payload'
import type { ReactNode } from 'react'
import { CommentSection, CommentThread } from './CommentSection'
import { CourseFeed } from './CourseFeed'
import { getItemAccess } from './getItemAccess'
import { mediaSrc, type MediaLike } from './format'
import { t, type Locale } from './i18n'
import { loadComments } from './loadComments'
import { FEED_PAGE_SIZE, loadCourseFeed, type MemberSlugs } from './member'
import { NoAccess } from './NoAccess'
import { Composer } from './RichComposer'
import { MemberShell } from './Shell'
import { defaultHrefs, type AccessUser, type Hrefs } from './types'

export const SECTION_PAGE_SIZE = FEED_PAGE_SIZE
const DEFAULT_EMOJIS = ['❤️', '😂', '🤩', '🥹', '🥰']

/** Previous / next links for a long list (`?page=n`). Renders nothing when everything fits on one page. */
export function SectionPagination({ page, total, pageSize = SECTION_PAGE_SIZE }: { page: number; total: number; pageSize?: number }) {
  if (total <= pageSize) return null
  return (
    <nav className="mt-6 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
      {page > 1 ? <a className="text-primary-700 underline" href={`?page=${page - 1}`}>←</a> : <span className="text-neutral-300">←</span>}
      <span className="text-neutral-600">{page} / {Math.ceil(total / pageSize)}</span>
      {page * pageSize < total ? <a className="text-primary-700 underline" href={`?page=${page + 1}`}>→</a> : <span className="text-neutral-300">→</span>}
    </nav>
  )
}

/**
 * A course in the member area: all posts (`sectionSlug="all"`) or those of one section, newest first, with search, the email
 * switch, the participants' posts and paging. Calls `notFound()` when the course or section does not exist.
 */
export async function CourseSection({ payload, user, courseSlug, sectionSlug, page = 1, q, locale = 'de', emojis = DEFAULT_EMOJIS, hrefs, imageSrc = mediaSrc, slugs, containerClass, refreshSeconds = 10 }: {
  payload: Payload
  user: AccessUser
  courseSlug: string
  sectionSlug: string
  page?: number
  /** the search words (`?q=`) */
  q?: string
  locale?: Locale
  emojis?: string[]
  /** kept for older callers; staff are recognised by `user.roles` */
  isStaff?: boolean
  hrefs?: Partial<Hrefs>
  imageSrc?: (m: MediaLike | null | undefined, size?: 'thumbnail' | 'optimized') => string | undefined
  slugs?: Partial<MemberSlugs>
  containerClass?: string
  refreshSeconds?: number
}) {
  const L = t(locale)
  const h = { ...defaultHrefs, ...hrefs }
  const feed = await loadCourseFeed(payload, user, { courseSlug, sectionSlug, q: q?.trim() || undefined, page, slugs })
  if (!feed) notFound()
  // the bubbles of a course are its areas, not the member area's pages: "all" and every section
  const areas = [
    { key: 'all', label: L.all, href: h.section(feed.course.slug, 'all'), current: !feed.section },
    ...feed.sections.map((s) => ({ key: String(s.id), label: String(s.title), href: h.section(feed.course.slug, s.slug), current: feed.section?.id === s.id })),
  ]
  const shell = (body: ReactNode, nav: typeof areas | null = areas) => <MemberShell title={String(feed.course.title)} back={{ href: h.dashboard, label: L.memberArea }} nav={nav} locale={locale} hrefs={hrefs} containerClass={containerClass}>{body}</MemberShell>
  if (!feed.hasAccess) return shell(<NoAccess locale={locale} shopHref={h.shop} />, null)

  // the participants' posts on this page, with replies, pictures and reactions
  const memberPosts = new Map<string, ReactNode>()
  const wanted = new Set(feed.items.filter((i) => i.kind === 'memberPost').map((i) => String(i.id)))
  let composer: ReactNode = null
  if (wanted.size || feed.canPost) {
    for (const s of (feed.section ? [feed.section] : feed.sections).filter((x) => x.allowMemberPosts || feed.items.some((i) => i.kind === 'memberPost' && i.section.slug === x.slug))) {
      const target = { relationTo: 'sections', value: s.id }
      const [{ canComment, canReact }, views] = await Promise.all([getItemAccess(payload, user, target), loadComments(payload, target, user, { rootIds: feed.items.filter((i) => i.kind === 'memberPost' && i.section.slug === s.slug).map((i) => i.id) })])
      for (const v of views) if (wanted.has(String(v.id))) memberPosts.set(String(v.id), <CommentThread comments={[v]} canComment={canComment} canReact={canReact} emojis={emojis} locale={locale} allowImages card />)
      if (feed.section && feed.canPost && canComment) composer = <Composer target={target} placeholder={L.shareHint} label={L.publish} allowAnonymous allowImages locale={locale} />
    }
  }
  return shell(<CourseFeed feed={feed} q={q?.trim() || undefined} memberPosts={memberPosts} composer={composer} emojis={emojis} locale={locale} hrefs={hrefs} imageSrc={imageSrc} refreshSeconds={refreshSeconds} />)
}

export { CommentSection }
