import type { Payload } from 'payload'
import { AutoRefresh } from './controls'
import { CommentSection } from './CommentSection'
import { getItemAccess } from './getItemAccess'
import { t, type Locale } from './i18n'
import { loadComments } from './loadComments'
import { loadReactionState, type MemberSlugs } from './member'
import { Reactions } from './Reactions'
import { defaultHrefs, type AccessUser, type Hrefs } from './types'

const DEFAULT_EMOJIS = ['❤️', '😂', '🤩', '🥹', '🥰']

/**
 * What belongs under a post or lesson: the reactions to the post itself, the way back to the course, and the discussion
 * (comments, replies, pictures, reactions, delete). One call; what the member may do is decided by the plugin's policies.
 */
export async function PostFooter({ payload, user, target, course, emojis = DEFAULT_EMOJIS, locale = 'de', hrefs, slugs, refreshSeconds = 10 }: {
  payload: Payload
  user: AccessUser
  target: { relationTo: string; value: number | string }
  /** the course the post belongs to, for the way back */
  course?: { slug: string; title: string } | null
  emojis?: string[]
  locale?: Locale
  hrefs?: Partial<Hrefs>
  slugs?: Partial<MemberSlugs>
  refreshSeconds?: number
}) {
  const L = t(locale)
  const h = { ...defaultHrefs, ...hrefs }
  const [{ canComment, canReact }, comments, reacted] = await Promise.all([getItemAccess(payload, user, target), loadComments(payload, target, user), loadReactionState(payload, target, user, { slugs })])
  return (
    <>
      {refreshSeconds > 0 && <AutoRefresh seconds={refreshSeconds} />}
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-neutral-200 py-5">
        <Reactions target={target} summary={reacted.summary} mine={reacted.mine} emojis={emojis} canReact={canReact} prominent locale={locale} />
        {course?.slug && <a href={h.section(course.slug, 'all')} className="text-[0.95rem] font-semibold text-primary-700 no-underline hover:text-primary-500">← {L.backToCourse(course.title)}</a>}
      </div>
      <div className="pt-10"><CommentSection target={target} comments={comments} canComment={canComment} canReact={canReact} emojis={emojis} locale={locale} /></div>
    </>
  )
}
