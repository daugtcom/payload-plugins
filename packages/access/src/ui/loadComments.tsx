import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Payload } from 'payload'
import type { CommentTarget, CommentView } from './CommentSection'
import { mediaSrc } from './format'
import { isStaffUser, type AccessUser } from './types'

type Doc = Record<string, any> & { id: number | string }
const idOf = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))

/**
 * The discussion under a target as a tree (newest first, replies oldest first), with reaction counts and the
 * viewer's own reaction. Read with the viewer's rights, so the author of an anonymous comment stays hidden.
 * `renderBody` turns a comment's rich text into React; the default is Payload's standard conversion.
 */
export async function loadComments(payload: Payload, target: CommentTarget, user: AccessUser | null, o: { staff?: boolean; usersSlug?: string; rootIds?: (number | string)[]; renderBody?: (data: unknown) => React.ReactNode } = {}): Promise<CommentView[]> {
  if (!user) return []
  const staff = o.staff ?? isStaffUser(user)
  const renderBody = o.renderBody ?? ((data: unknown) => <RichText data={data as never} />)
  const asUser = { ...user, collection: o.usersSlug ?? 'users' } as never
  const find = (where: Record<string, unknown>) => payload.find({ collection: 'comments' as never, where: where as never, limit: 0, pagination: false, depth: 1, overrideAccess: false, user: asUser, sort: 'createdAt' }).then((r) => r.docs as unknown as Doc[])

  if (o.rootIds && !o.rootIds.length) return []
  const all: Doc[] = await find({ and: [{ 'target.relationTo': { equals: target.relationTo } }, { 'target.value': { equals: target.value } }, ...(o.rootIds ? [{ id: { in: o.rootIds } }] : [])] })
  let level = all
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const replies: Doc[] = await find({ and: [{ 'target.relationTo': { equals: 'comments' } }, { 'target.value': { in: level.map((c) => c.id) } }] })
    all.push(...replies)
    level = replies
  }

  const reactions = all.length
    ? ((await payload.find({ collection: 'reactions' as never, where: { and: [{ 'target.relationTo': { equals: 'comments' } }, { 'target.value': { in: all.map((c) => c.id) } }] } as never, limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Doc[])
    : []

  const reactionsByComment = new Map<string, Doc[]>()
  for (const r of reactions) { const key = String(idOf(r.target.value)); const list = reactionsByComment.get(key) ?? []; list.push(r); reactionsByComment.set(key, list) }
  const byId = new Map<string, CommentView>()
  for (const c of all) {
    const rs = reactionsByComment.get(String(c.id)) ?? []
    const summary: Record<string, number> = {}
    for (const r of rs) summary[r.emoji] = (summary[r.emoji] ?? 0) + 1
    const mine = rs.find((r) => String(idOf(r.user)) === String(user.id))
    const author = c.author && typeof c.author === 'object' ? (c.author as Doc) : null
    const gone = Boolean(c.deleted)
    const pictures = Array.isArray(c.media) ? (c.media as Doc[]).filter((m) => m && typeof m === 'object') : []
    byId.set(String(c.id), {
      id: c.id,
      authorName: !gone && author ? ((author.name as string) || (author.email as string).split('@')[0] || null) : null,
      anonymous: Boolean(c.anonymous),
      createdAt: c.createdAt,
      canDelete: !gone && (staff || (c.author != null && String(idOf(c.author)) === String(user.id))),
      body: gone ? null : renderBody(c.text),
      reactions: gone ? {} : summary,
      myEmoji: gone ? null : (mine?.emoji ?? null),
      replies: [],
      images: gone ? [] : pictures.flatMap((m) => { const url = mediaSrc(m as never, 'optimized'); return url ? [{ id: m.id, url, thumb: mediaSrc(m as never, 'thumbnail') ?? url }] : [] }),
      deleted: gone,
    })
  }
  const roots: CommentView[] = []
  for (const c of all) {
    const view = byId.get(String(c.id))!
    if (c.target.relationTo === 'comments') byId.get(String(idOf(c.target.value)))?.replies.push(view)
    else roots.push(view)
  }
  return roots.reverse()
}
