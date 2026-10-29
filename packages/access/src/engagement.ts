import type { Payload, Where } from 'payload'
import type { TargetRef } from './types'

export type ReactionResult = { action: 'added' | 'removed' | 'replaced'; emoji: string }

/**
 * One reaction per user per target (legacy behavior):
 * same emoji again removes it, another emoji replaces it, none yet adds it.
 */
export async function setReaction(
  payload: Payload,
  o: { reactionsSlug?: string; user: string | number; target: TargetRef; emoji: string; allowed?: string[] },
): Promise<ReactionResult> {
  const slug = o.reactionsSlug ?? 'reactions'
  if (o.allowed && !o.allowed.includes(o.emoji)) throw new Error(`Reaction ${o.emoji} is not allowed`)

  const where: Where = {
    and: [{ user: { equals: o.user } }, { 'target.relationTo': { equals: o.target.relationTo } }, { 'target.value': { equals: o.target.value } }],
  }
  const existing = await payload.find({ collection: slug as never, where, limit: 0, pagination: false, depth: 0, overrideAccess: true })
  const docs = existing.docs as unknown as { id: string | number; emoji: string }[]

  const previous = docs[0]
  for (const d of docs) await payload.delete({ collection: slug as never, id: d.id, overrideAccess: true })
  if (previous?.emoji === o.emoji) return { action: 'removed', emoji: o.emoji }

  await payload.create({ collection: slug as never, data: { user: o.user, target: o.target, emoji: o.emoji } as never, overrideAccess: true })
  return { action: previous ? 'replaced' : 'added', emoji: o.emoji }
}

export async function reactionSummary(payload: Payload, o: { reactionsSlug?: string; target: TargetRef }): Promise<Record<string, number>> {
  const res = await payload.find({
    collection: (o.reactionsSlug ?? 'reactions') as never,
    where: { and: [{ 'target.relationTo': { equals: o.target.relationTo } }, { 'target.value': { equals: o.target.value } }] },
    limit: 0,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  const out: Record<string, number> = {}
  for (const d of res.docs as unknown as { emoji: string }[]) out[d.emoji] = (out[d.emoji] ?? 0) + 1
  return out
}
