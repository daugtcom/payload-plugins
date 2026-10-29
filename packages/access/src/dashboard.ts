import { contentActivity, sortCoursesByActivity, sortSinglesByActivity } from './activity'
import type { Payload } from 'payload'
import { canViewSeriesItem, accessTimeslots, isActiveAt, type EntitlementWindow, type Timeslots } from './rules'
import type { AccessService } from './service'

type Id = string | number
type Doc = Record<string, any> & { id: Id }

export interface CourseSummary {
  course: Doc
  timeslots: Timeslots
  /** `active` = a window is running now, `upcoming` = only future windows, `ended` = everything is over (content may still be reachable). */
  state: 'active' | 'upcoming' | 'ended'
  /** How many lessons the member can open now, and the newest few. */
  visibleLessons: number
  newest: Doc[]
  /** Latest visible published lesson activity, independent of the requested preview count. */
  lastActivity: string | null
}

export interface MemberDashboard {
  courses: CourseSummary[]
  /** Single purchases (e.g. one post or download) the member can open. */
  singles: Doc[]
}

const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

/**
 * What the member area shows first: the member's courses with what is open for them, and single purchases.
 * Uses the pure rules on data loaded once per course (not one policy call per lesson).
 */
export async function getMemberDashboard(payload: Payload, service: AccessService, o: { userId: Id; coursesSlug?: string; lessonsSlug?: string; singlesSlug?: string; seriesField?: string; dateField?: string; freeForAllField?: string; newest?: number; at?: Date }): Promise<MemberDashboard> {
  const at = o.at ?? new Date()
  const coursesSlug = o.coursesSlug ?? 'courses'
  const lessonsSlug = o.lessonsSlug ?? 'lessons'
  const seriesField = o.seriesField ?? 'series'
  const dateField = o.dateField ?? 'publishedAt'
  const freeForAllField = o.freeForAllField ?? 'freeForAll'

  const all = await service.entitlements(o.userId)
  const direct = new Map<string, EntitlementWindow[]>()
  const perCourse = new Map<string, EntitlementWindow[]>()
  const { toWindow } = await import('./service')
  for (const e of all) {
    const key = String(idOf(e.target.value))
    const w = toWindow(e)
    const bucket = e.target.relationTo === lessonsSlug ? direct : e.target.relationTo === coursesSlug ? perCourse : null
    if (bucket) bucket.set(key, [...(bucket.get(key) ?? []), w])
  }

  const courses: CourseSummary[] = []
  for (const [courseId, windows] of perCourse) {
    const course = (await payload.findByID({ collection: coursesSlug as never, id: courseId, depth: 0, overrideAccess: true }).catch(() => null)) as (Doc & { _status?: string }) | null
    if (!course || (course._status && course._status !== 'published')) continue

    const timeslots = accessTimeslots(windows, at)
    const lessons = (await payload.find({ collection: lessonsSlug as never, where: { and: [{ [seriesField]: { equals: courseId } }, { [dateField]: { less_than_equal: at.toISOString() } }, { _status: { equals: 'published' } }] }, sort: `-${dateField}`, limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[]
    const visible = lessons.filter((l) =>
      canViewSeriesItem({ at, isStaff: false, publishedAt: l[dateField] ? new Date(l[dateField]) : null, seriesEntitlements: [windows], directEntitlements: direct.get(String(l.id)) ?? [], freeForAll: Boolean(l[freeForAllField]) }),
    )
    const active = timeslots.unrestricted || windows.some((w) => isActiveAt(w.start, w.end, at))
    const upcoming = windows.some((w) => w.start && w.start > at)
    const last = visible.reduce((max, lesson) => Math.max(max, contentActivity({ publishedAt: lesson[dateField], updatedAt: lesson.updatedAt })), 0)
    courses.push({ course, timeslots, state: active ? 'active' : upcoming ? 'upcoming' : 'ended', visibleLessons: visible.length, newest: visible.slice(0, o.newest ?? 5), lastActivity: last ? new Date(last).toISOString() : null })
  }
  sortCoursesByActivity(courses)

  const singleDocs = await memberSingles(payload, service, { userId: o.userId, singlesSlug: o.singlesSlug, at })
  return { courses, singles: singleDocs }
}

/**
 * What a member has bought on its own, outside a course window: items granted directly (stand-alone items, or single items
 * of a course). Newest first, each item once. Sections are not sold; only items are.
 */
export async function memberSingles(payload: Payload, service: AccessService, o: { userId: Id; singlesSlug?: string; at?: Date }): Promise<Doc[]> {
  if (!o.singlesSlug) return []
  const at = o.at ?? new Date()
  const out: Doc[] = []
  for (const t of await service.accessibleTargets(o.userId, o.singlesSlug, at)) {
    const doc = (await payload.findByID({ collection: t.relationTo as never, id: t.value, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
    if (doc) out.push(doc)
  }
  return sortSinglesByActivity(out)
}
