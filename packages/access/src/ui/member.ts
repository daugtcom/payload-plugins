import { contentActivity, sortCoursesByActivity } from '../activity'
/**
 * Server-side data of the member area: the start page, one course as a feed, the reactions of one post.
 * The access rules are the plugin's (`getAccess`, `canViewSeriesItem`); the pages only lay out what these return.
 */
import type { Payload } from 'payload'
import { sectionOrderField } from '../factories/series'
import { getMemberDashboard, memberSingles, type CourseSummary } from '../dashboard'
import { reactionSummary } from '../engagement'
import { getAccess } from '../plugin'
import { accessTimeslots, canViewSeriesItem, isDateInSlots } from '../rules'
import { toWindow } from '../service'
import { isStaffUser, type AccessUser } from './types'

type Id = string | number
type Doc = Record<string, any> & { id: Id }

export const FEED_PAGE_SIZE = 24
const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

export interface MemberSlugs { courses: string; lessons: string; sections: string; singles: string; comments: string; reactions: string; subscriptions: string }
/** Slugs of the member area: what the site gave `payloadAccess({ memberArea })`, else the usual names, then whatever the call passes. */
const slugs = (o: Partial<MemberSlugs> | undefined, payload?: Payload): MemberSlugs => {
  const m = (payload?.config.custom as { daugtAccess?: { memberArea?: { coursesSlug?: string; lessonsSlug?: string; singlesSlug?: string; sectionsSlug?: string } } } | undefined)?.daugtAccess?.memberArea
  return { courses: m?.coursesSlug ?? 'courses', lessons: m?.lessonsSlug ?? 'lessons', sections: m?.sectionsSlug ?? 'sections', singles: m?.singlesSlug ?? 'posts', comments: 'comments', reactions: 'reactions', subscriptions: 'notificationSubscriptions', ...o }
}

/** Plain text of a Lexical state, for searching. */
export function plainText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; children?: unknown[]; root?: unknown }
  if (n.root) return plainText(n.root)
  return [n.text ?? '', ...(n.children ?? []).map(plainText)].join(' ')
}

export interface FeedPost {
  kind: 'post'
  id: Id
  title: string
  slug: string
  image: Doc | null
  date: string
  excerpt: string
  reactions: Record<string, number>
  mine: string | null
  comments: number
}
export interface FeedMemberPost { kind: 'memberPost'; id: Id; date: string; section: { slug: string; title: string } }
export type FeedItem = FeedPost | FeedMemberPost

export interface CourseFeed {
  course: Doc
  sections: Doc[]
  /** `null` = all sections */
  section: Doc | null
  items: FeedItem[]
  total: number
  page: number
  pageSize: number
  subscribed: boolean
  /** may write a member post in this section */
  canPost: boolean
  /** may react from the cards */
  canReact: boolean
  hasAccess: boolean
  state: 'active' | 'upcoming' | 'ended'
  startsAt: string | null
}

export interface DashboardCourse extends CourseSummary { sections: Doc[]; startsAt: string | null }

/** The member's courses (staff: every published course), single purchases and the sections of each course. */
export async function loadDashboard(payload: Payload, user: AccessUser, o: { slugs?: Partial<MemberSlugs>; newest?: number } = {}): Promise<{ courses: DashboardCourse[]; singles: Doc[] }> {
  const S = slugs(o.slugs, payload)
  const service = getAccess(payload)
  const dash = await getMemberDashboard(payload, service, { userId: user.id, coursesSlug: S.courses, lessonsSlug: S.lessons, singlesSlug: S.singles, newest: o.newest ?? 3 })
  const sections = (await payload.find({ collection: S.sections as never, limit: 0, pagination: false, depth: 0, sort: sectionOrderField(S.sections), overrideAccess: true })).docs as unknown as Doc[]
  const courses: CourseSummary[] = [...dash.courses]

  if (isStaffUser(user)) {
    // staff see every published course, whatever they were granted (the old member area did the same)
    const have = new Set(courses.map((c) => String(c.course.id)))
    const all = (await payload.find({ collection: S.courses as never, where: { _status: { equals: 'published' } } as never, sort: 'title', limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
    for (const course of all.filter((c) => !have.has(String(c.id)))) {
      const where = { and: [{ series: { equals: course.id } }, { _status: { equals: 'published' } }, { publishedAt: { less_than_equal: new Date().toISOString() } }] } as never
      const n = o.newest ?? 3 // 0 = the page does not list posts (and a `limit` of 0 would mean all of them)
      const newest = n > 0 ? ((await payload.find({ collection: S.lessons as never, where, sort: '-publishedAt', limit: n, depth: 0, overrideAccess: true })).docs as unknown as Doc[]) : []
      const lessons = (await payload.find({ collection: S.lessons as never, where, limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
      const last = lessons.reduce((max, lesson) => Math.max(max, contentActivity({ publishedAt: lesson.publishedAt, updatedAt: lesson.updatedAt })), 0)
      courses.push({ course, timeslots: { unrestricted: true, slots: [] } as never, state: 'active', visibleLessons: lessons.length, newest, lastActivity: last ? new Date(last).toISOString() : null })
    }
  }

  const out = await Promise.all(courses.map(async (c) => {
    const full = (await payload.findByID({ collection: S.courses as never, id: c.course.id, depth: 1, overrideAccess: true })) as Doc
    const windows = await service.windows(user.id, { relationTo: S.courses, value: c.course.id })
    const first = windows.map((w) => w.start).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    return { ...c, course: full, sections: sections.filter((s) => String(idOf(s.series)) === String(c.course.id)), startsAt: c.state === 'upcoming' ? (first?.toISOString() ?? null) : null }
  }))
  return { courses: sortCoursesByActivity(out), singles: dash.singles as Doc[] }
}

/** How many single purchases (posts, downloads) a member can open: the number behind "Meine Zugänge", for pages that show the member area's bubbles. */
export async function countSingles(payload: Payload, user: AccessUser, o: { slugs?: Partial<MemberSlugs> } = {}): Promise<number> {
  const S = slugs(o.slugs, payload)
  return (await memberSingles(payload, getAccess(payload), { userId: user.id, singlesSlug: S.singles })).length
}

/** All posts a member can open in a course (or one section), newest first, with member posts mixed in, searchable and paged. `null` when the course or section does not exist. */
export async function loadCourseFeed(payload: Payload, user: AccessUser, o: { courseSlug: string; sectionSlug: string; q?: string; page?: number; pageSize?: number; slugs?: Partial<MemberSlugs> }): Promise<CourseFeed | null> {
  const S = slugs(o.slugs, payload)
  const staff = isStaffUser(user)
  const pageSize = o.pageSize ?? FEED_PAGE_SIZE
  const course = ((await payload.find({ collection: S.courses as never, where: { slug: { equals: o.courseSlug } } as never, limit: 1, depth: 1, overrideAccess: true })).docs[0] ?? null) as Doc | null
  if (!course || (course._status && course._status !== 'published')) return null
  const sections = (await payload.find({ collection: S.sections as never, where: { series: { equals: course.id } } as never, sort: sectionOrderField(S.sections), limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
  const section = o.sectionSlug === 'all' ? null : (sections.find((s) => s.slug === o.sectionSlug) ?? undefined)
  if (section === undefined) return null

  const service = getAccess(payload)
  const windows = await service.windows(user.id, { relationTo: S.courses, value: course.id })
  const now = new Date()
  const needle = (o.q ?? '').trim().toLowerCase()
  const timeslots = accessTimeslots(windows, now)
  const hasAccess = staff || windows.length > 0
  const direct = (await service.entitlements(user.id)).filter((e) => e.target.relationTo === S.lessons)
  const sectionIds = (section ? [section] : sections).map((s) => s.id)

  let items: FeedItem[] = []
  let canReact = false
  if (hasAccess && sectionIds.length) {
    const lessons = (await payload.find({ collection: S.lessons as never, where: { and: [{ categories: { in: sectionIds } }, { publishedAt: { less_than_equal: now.toISOString() } }, { _status: { equals: 'published' } }] } as never, sort: '-publishedAt', limit: 0, pagination: false, depth: 1, overrideAccess: true })).docs as unknown as Doc[]
    const open = lessons.filter((l) => staff || canViewSeriesItem({ at: now, isStaff: false, publishedAt: l.publishedAt ? new Date(l.publishedAt) : null, seriesEntitlements: [windows], directEntitlements: direct.filter((e) => String(idOf(e.target.value)) === String(l.id)).map(toWindow), freeForAll: Boolean(l.freeForAll) }))
    items = open.map((l): FeedPost => ({ kind: 'post', id: l.id, title: l.title, slug: l.slug, image: typeof l.image === 'object' ? l.image : null, date: l.publishedAt, excerpt: plainText(l.body).replace(/\s+/g, ' ').trim(), reactions: {}, mine: null, comments: 0 }))
    if (open[0]) canReact = staff || (await service.can('react', user as never, { relationTo: S.lessons, value: open[0].id }).catch(() => false))

    // the participants' own posts (comments on a section) belong to the course feed, too
    const postable = section ? [section] : sections
    if (postable.length) {
      const memberPosts = (await payload.find({ collection: S.comments as never, where: { and: [{ 'target.relationTo': { equals: S.sections } }, { 'target.value': { in: postable.map((s) => s.id) } }] } as never, sort: '-createdAt', limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
      items.push(...memberPosts.filter((c) => (staff || timeslots.unrestricted || isDateInSlots(c.createdAt ? new Date(c.createdAt) : null, timeslots.slots)) && (!needle || plainText(c.text).toLowerCase().includes(needle))).map((c): FeedMemberPost => {
        const s = postable.find((x) => String(x.id) === String(idOf(c.target.value)))
        return { kind: 'memberPost', id: c.id, date: c.createdAt, section: { slug: s?.slug ?? '', title: s?.title ?? '' } }
      }))
      items.sort((a, b) => b.date.localeCompare(a.date))
    }
  }

  if (needle) items = items.filter((i) => i.kind === 'memberPost' || `${i.title} ${i.excerpt}`.toLowerCase().includes(needle))

  const page = Math.max(1, o.page ?? 1)
  const total = items.length
  items = items.slice((page - 1) * pageSize, page * pageSize)
  const posts = items.filter((item): item is FeedPost => item.kind === 'post')
  const ids = posts.map((item) => item.id)
  if (ids.length) {
    const onLessons = { and: [{ 'target.relationTo': { equals: S.lessons } }, { 'target.value': { in: ids } }] } as never
    const [reactions, comments] = await Promise.all([
      payload.find({ collection: S.reactions as never, where: onLessons, limit: 0, pagination: false, depth: 0, overrideAccess: true }),
      payload.find({ collection: S.comments as never, where: onLessons, limit: 0, pagination: false, depth: 0, overrideAccess: true }),
    ])
    const byId = new Map(posts.map((post) => [String(post.id), post]))
    for (const reaction of reactions.docs as unknown as Doc[]) {
      const post = byId.get(String(idOf(reaction.target.value)))
      if (!post) continue
      post.reactions[reaction.emoji] = (post.reactions[reaction.emoji] ?? 0) + 1
      if (String(idOf(reaction.user)) === String(user.id)) post.mine = reaction.emoji
    }
    for (const comment of comments.docs as unknown as Doc[]) {
      const post = byId.get(String(idOf(comment.target.value)))
      if (post && !comment.deleted) post.comments++
    }
  }
  const sub = await payload.count({ collection: S.subscriptions as never, where: { and: [{ user: { equals: user.id } }, { 'target.relationTo': { equals: S.courses } }, { 'target.value': { equals: course.id } }] } as never, overrideAccess: true }).catch(() => ({ totalDocs: 0 }))
  const active = windows.some((w) => (!w.start || w.start <= now) && (!w.end || w.end > now))
  const state: CourseFeed['state'] = active || staff ? 'active' : windows.some((w) => w.start && w.start > now) ? 'upcoming' : 'ended'
  const start = windows.map((w) => w.start).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null

  return {
    course, sections, section: section ?? null,
    items, total, page, pageSize,
    subscribed: sub.totalDocs > 0, canPost: Boolean(section?.allowMemberPosts) && (staff || active), canReact, hasAccess,
    state: hasAccess ? state : 'ended', startsAt: state === 'upcoming' ? (start?.toISOString() ?? null) : null,
  }
}

/** Reaction counts of one target and the viewer's own reaction. */
export async function loadReactionState(payload: Payload, target: { relationTo: string; value: Id }, user: AccessUser, o: { slugs?: Partial<MemberSlugs> } = {}): Promise<{ summary: Record<string, number>; mine: string | null }> {
  const S = slugs(o.slugs, payload)
  const summary = await reactionSummary(payload, { reactionsSlug: S.reactions, target })
  const mine = (await payload.find({ collection: S.reactions as never, where: { and: [{ user: { equals: user.id } }, { 'target.relationTo': { equals: target.relationTo } }, { 'target.value': { equals: target.value } }] } as never, limit: 1, depth: 0, overrideAccess: true })).docs[0] as Doc | undefined
  return { summary, mine: (mine?.emoji as string | undefined) ?? null }
}
