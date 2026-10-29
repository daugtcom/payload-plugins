/**
 * Recipe: the course rules of the legacy daugt app, expressed on top of the generic access rules.
 *
 * Not part of the plugin core: a client opts in by wiring `canViewPost` etc. into its policy hooks.
 * Pure functions, no I/O. The caller loads entitlements and settings and passes them in.
 */
import {
  accessTimeslots,
  canViewSeriesItem,
  isActiveAt,
  isDateInSlots,
  type EntitlementWindow,
} from '../src/rules'

export interface CourseRef {
  /** The user's entitlements on this course (all of them, valid or not). */
  entitlements: readonly EntitlementWindow[]
  allowMemberComments: boolean
  allowMemberReactions: boolean
}

export interface PostInput {
  at: Date
  isStaff: boolean
  publishedAt: Date | null
  freeForAll: boolean
  /**
   * The courses of the sections the post is filed under.
   * `null` = the post has no section attribute at all (legacy distinguishes this from an empty list).
   */
  sectionCourses: readonly CourseRef[] | null
  /** The user's entitlements granted directly on the post. */
  directEntitlements: readonly EntitlementWindow[]
}

export function canViewPost(p: PostInput): boolean {
  return canViewSeriesItem({
    at: p.at,
    isStaff: p.isStaff,
    publishedAt: p.publishedAt,
    freeForAll: p.freeForAll,
    seriesEntitlements: (p.sectionCourses ?? []).map((c) => c.entitlements),
    directEntitlements: p.directEntitlements,
  })
}

/** View access, and (when filed in courses) at least one course that allows member comments. */
export function canCommentPost(p: PostInput): boolean {
  if (!canViewPost(p)) return false
  if (p.sectionCourses === null) return true
  return p.sectionCourses.some((c) => c.allowMemberComments)
}

export function canReactPost(p: PostInput): boolean {
  if (!canViewPost(p)) return false
  if (p.sectionCourses === null) return true
  return p.sectionCourses.some((c) => c.allowMemberReactions)
}

export interface SectionInput {
  at: Date
  isStaff: boolean
  allowMemberPosts: boolean
  course: Pick<CourseRef, 'entitlements'>
}

/** Member posts in a course section: the section must allow it and the user needs an ACTIVE access window. */
export function canPostInSection(s: SectionInput): boolean {
  if (s.isStaff) return true
  if (!s.allowMemberPosts) return false
  const { unrestricted, slots } = accessTimeslots(s.course.entitlements, s.at)
  return unrestricted || slots.some((slot) => isActiveAt(slot.start, slot.end, s.at))
}

export { isDateInSlots }
