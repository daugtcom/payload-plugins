/**
 * The legacy course rules as policies for `payloadAccess({ policies })`: the pure rules of `course-policy.ts`
 * fed with entitlements and settings read through the AccessService.
 *
 *  - lesson: viewable inside the member's access windows (or unrestricted / freeForAll / directly granted,); commentable and reactable when one of its courses allows it.
 *    A lesson that belongs to no course is a stand-alone item (what the old "post" was): view follows its direct grants, and
 *    comment/react follow view.
 *  - post (single purchase): viewable with a direct entitlement; comment/react follow view
 *  - section: members may post and react in it only with an ACTIVE window, and only if the section allows member posts
 */
import type { CollectionPolicy, PolicyContext } from '../src/types'
import { canCommentPost, canPostInSection, canReactPost, canViewPost, type CourseRef, type PostInput } from './course-policy'

type Doc = Record<string, any> & { id: string | number }
const idOf = (v: unknown): string | number => (v && typeof v === 'object' ? (v as { id: string | number }).id : (v as string | number))

export interface CoursePolicyOptions {
  courses?: string
  sections?: string
  lessons?: string
  posts?: string
  /** Field names on the documents. Defaults match `createSeries` + the reference client. */
  fields?: { series?: string; sections?: string; freeForAll?: string; publishedAt?: string; allowComments?: string; allowReactions?: string; allowMemberPosts?: string }
}

export function createCoursePolicy(o: CoursePolicyOptions = {}): Record<string, CollectionPolicy> {
  const slugs = { courses: o.courses ?? 'courses', sections: o.sections ?? 'sections', lessons: o.lessons ?? 'lessons', posts: o.posts ?? 'posts' }
  const f = { series: 'series', sections: 'categories', freeForAll: 'freeForAll', publishedAt: 'publishedAt', allowComments: 'allowMemberComments', allowReactions: 'allowMemberReactions', allowMemberPosts: 'allowMemberPosts', ...o.fields }

  const find = (ctx: PolicyContext, collection: string, id: unknown) => ctx.payload.findByID({ collection: collection as never, id: idOf(id), depth: 0, overrideAccess: true }).catch(() => null) as Promise<Doc | null>

  async function courseOf(ctx: PolicyContext, courseID: string | number): Promise<{ course: Doc; ref: CourseRef } | null> {
    const course = await find(ctx, slugs.courses, courseID)
    if (!course) return null
    const entitlements = ctx.user ? await ctx.service.windows(ctx.user.id, { relationTo: slugs.courses, value: course.id }) : []
    return { course, ref: { entitlements, allowMemberComments: Boolean(course[f.allowComments]), allowMemberReactions: Boolean(course[f.allowReactions]) } }
  }

  async function lessonInput(doc: Doc, ctx: PolicyContext): Promise<PostInput> {
    // a lesson's `series` is the set of courses of its sections (what the importer fills in), so no section lookup is needed
    const refs: CourseRef[] = []
    for (const id of new Set(((doc[f.series] as unknown[] | undefined) ?? []).map(idOf))) {
      const c = await courseOf(ctx, id)
      if (c) refs.push(c.ref)
    }
    const direct = ctx.user ? await ctx.service.windows(ctx.user.id, { relationTo: slugs.lessons, value: doc.id }) : []
    return {
      at: ctx.at,
      isStaff: false,
      publishedAt: doc[f.publishedAt] ? new Date(doc[f.publishedAt]) : null,
      freeForAll: Boolean(doc[f.freeForAll]),
      // no course at all: a stand-alone item, comments and reactions follow plain view access
      sectionCourses: refs.length ? refs : null,
      directEntitlements: direct,
    }
  }

  async function postInput(doc: Doc, ctx: PolicyContext): Promise<PostInput> {
    return {
      at: ctx.at,
      isStaff: false,
      publishedAt: doc[f.publishedAt] ? new Date(doc[f.publishedAt]) : null,
      freeForAll: false,
      sectionCourses: null,
      directEntitlements: ctx.user ? await ctx.service.windows(ctx.user.id, { relationTo: slugs.posts, value: doc.id }) : [],
    }
  }

  async function sectionAllows(doc: Doc, ctx: PolicyContext): Promise<boolean> {
    const c = await courseOf(ctx, idOf(doc.series))
    return Boolean(c) && canPostInSection({ at: ctx.at, isStaff: false, allowMemberPosts: Boolean(doc[f.allowMemberPosts]), course: { entitlements: c!.ref.entitlements } })
  }

  return {
    [slugs.lessons]: {
      view: async (doc, ctx) => canViewPost(await lessonInput(doc, ctx)),
      comment: async (doc, ctx) => canCommentPost(await lessonInput(doc, ctx)),
      react: async (doc, ctx) => canReactPost(await lessonInput(doc, ctx)),
    },
    [slugs.posts]: {
      view: async (doc, ctx) => canViewPost(await postInput(doc, ctx)),
      comment: async (doc, ctx) => canCommentPost(await postInput(doc, ctx)),
      react: async (doc, ctx) => canReactPost(await postInput(doc, ctx)),
    },
    [slugs.sections]: {
      view: () => true,
      comment: sectionAllows,
      react: sectionAllows,
    },
  }
}
