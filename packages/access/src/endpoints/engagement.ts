import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { reactionSummary, setReaction } from '../engagement'
import { DEFAULT_REACTION_EMOJIS } from '../factories/engagement'
import type { AccessService } from '../service'
import { sanitizeCommentText, toLexicalState } from '../richtext'
import type { EngagementOptions, TargetRef } from '../types'

export { toLexicalState }

type Id = string | number
type Doc = Record<string, any> & { id: Id }

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))
const isRef = (t: any): t is TargetRef => t && typeof t.relationTo === 'string' && t.value !== undefined && t.value !== null

/** The real type of an image from its first bytes (the declared type is only a hint a client can fake). */
export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length > 12 && String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' && String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP') return 'image/webp'
  return null
}

/** Comments and reactions on a comment are judged by what the comment hangs on (content or a course section). */
async function policyTarget(payload: Payload, commentsSlug: string, target: TargetRef): Promise<TargetRef | null> {
  let current = target
  for (let depth = 0; depth < 20; depth++) {
    if (current.relationTo !== commentsSlug) return current
    const parent = (await payload.findByID({ collection: commentsSlug as never, id: current.value, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
    if (!parent) return null
    current = { relationTo: parent.target.relationTo, value: idOf(parent.target.value) }
  }
  return null
}

export function engagementEndpoints(o: EngagementOptions, service: (payload: Payload) => AccessService): Endpoint[] {
  const commentsSlug = o.commentsSlug ?? 'comments'
  const reactionsSlug = o.reactionsSlug ?? 'reactions'
  const emojis = o.emojis ?? DEFAULT_REACTION_EMOJIS
  const body = async (req: PayloadRequest) => ((await req.json?.().catch(() => ({}))) ?? {}) as Record<string, any>
  const mediaSlug = o.mediaSlug ?? 'media'
  const maxImages = o.maxImages ?? 5
  const maxBytes = (o.maxImageMB ?? 10) * 1024 * 1024
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const mediaFields = (payload: Payload): string[] => ((payload.collections as Record<string, { config: { fields: { name?: string }[] } }>)[mediaSlug]?.config.fields ?? []).map((f) => f.name ?? '')
  const hasUploadFields = (payload: Payload) => mediaFields(payload).includes('uploadedBy') && mediaFields(payload).includes('userUpload')
  const thumb = (m: Doc) => (m.sizes?.thumbnail?.url as string | undefined) ?? (m.thumbnailURL as string | undefined) ?? (m.url as string | undefined) ?? null

  return [
    // a picture for a comment: stored with the member's own rights (the media collection decides whether that is allowed)
    {
      path: '/engagement/uploads',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        const { payload } = req
        if (!hasUploadFields(payload)) return json(501, { error: 'uploads-not-configured' })
        const user = req.user as Doc
        const form = await req.formData?.().catch(() => null)
        const file = form?.get('file')
        if (!file || typeof file === 'string') return json(400, { error: 'file-required' })
        const upload = file as File
        if (upload.size > maxBytes) return json(413, { error: 'image-too-large' })
        const bytes = new Uint8Array(await upload.arrayBuffer())
        const real = sniffImage(bytes)
        if (!real || !IMAGE_TYPES.includes(real)) return json(415, { error: 'image-type-not-allowed' })
        const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
        const recent = await payload.count({ collection: mediaSlug as never, where: { and: [{ uploadedBy: { equals: user.id } }, { userUpload: { equals: true } }, { createdAt: { greater_than: hourAgo } }] } as never, overrideAccess: true })
        if (recent.totalDocs >= 30) return json(429, { error: 'too-many-uploads' })
        try {
          const doc = (await payload.create({
            collection: mediaSlug as never,
            data: { userUpload: true, uploadedBy: user.id, ...(mediaFields(payload).includes('kind') ? { kind: 'image' } : {}), ...(mediaFields(payload).includes('prefix') ? { prefix: o.uploadPrefix ?? 'user-uploads' } : {}) } as never,
            file: { data: Buffer.from(bytes), mimetype: real, name: upload.name || 'bild', size: upload.size },
            overrideAccess: false,
            user,
          })) as unknown as Doc
          return json(201, { id: doc.id, url: thumb(doc) })
        } catch {
          return json(403, { error: 'upload-not-allowed' })
        }
      },
    },

    {
      path: '/engagement/comments',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        const { payload } = req
        const user = req.user as Doc
        const b = await body(req)
        if (!isRef(b.target)) return json(400, { error: 'target-required' })
        const state = sanitizeCommentText(b.text)
        if (!state) return json(400, { error: 'text-required' })

        // pictures: only the member's own uploads, at most `maxImages`
        let media: Id[] = []
        if (b.media !== undefined) {
          const ids = Array.isArray(b.media) ? [...new Set(b.media as Id[])] : []
          if (ids.length > maxImages || !hasUploadFields(payload)) return json(400, { error: 'media-invalid' })
          if (ids.length) {
            const mine = await payload.find({ collection: mediaSlug as never, where: { and: [{ id: { in: ids } }, { uploadedBy: { equals: user.id } }, { userUpload: { equals: true } }] } as never, limit: 0, pagination: false, depth: 0, overrideAccess: true })
            if (mine.docs.length !== ids.length) return json(400, { error: 'media-invalid' })
            media = ids
          }
        }

        const judged = await policyTarget(payload, commentsSlug, b.target)
        if (!judged || !(await service(payload).can('comment', user, judged))) return json(403, { error: 'forbidden' })

        const doc = (await payload.create({
          collection: commentsSlug as never,
          data: { author: user.id, anonymous: b.anonymous === true, target: b.target, text: state, ...(media.length ? { media } : {}) } as never,
          overrideAccess: true,
        })) as unknown as Doc
        return json(201, { id: doc.id })
      },
    },

    // delete a comment: without replies it disappears; with replies it is blanked and the replies stay
    {
      path: '/engagement/comments/:id',
      method: 'delete',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        const { payload } = req
        const id = (req.routeParams as { id?: string } | undefined)?.id
        const comment = id ? ((await payload.findByID({ collection: commentsSlug as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null) : null
        if (!comment) return json(404, { error: 'not-found' })
        const user = req.user as Doc
        const mine = comment.author != null && String(idOf(comment.author)) === String(user.id)
        if (!mine && !service(payload).isStaff(req.user)) return json(403, { error: 'forbidden' })

        const replies = await payload.count({ collection: commentsSlug as never, where: { and: [{ 'target.relationTo': { equals: commentsSlug } }, { 'target.value': { equals: comment.id } }] } as never, overrideAccess: true })
        const pictures = Array.isArray(comment.media) ? (comment.media as unknown[]).map(idOf) : []
        await payload.delete({ collection: reactionsSlug as never, where: { and: [{ 'target.relationTo': { equals: commentsSlug } }, { 'target.value': { equals: comment.id } }] } as never, overrideAccess: true })
        if (replies.totalDocs > 0) await payload.update({ collection: commentsSlug as never, id: comment.id, data: { deleted: true, text: null, media: [], anonymous: false } as never, overrideAccess: true })
        else await payload.delete({ collection: commentsSlug as never, id: comment.id, overrideAccess: true })

        // the member's own pictures go with the comment (with the member's rights: a protected media collection simply keeps them)
        if (hasUploadFields(payload)) for (const mid of pictures) {
          const m = (await payload.findByID({ collection: mediaSlug as never, id: mid, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
          if (m?.userUpload && m.uploadedBy != null && String(idOf(m.uploadedBy)) === String(idOf(comment.author))) await payload.delete({ collection: mediaSlug as never, id: mid, overrideAccess: false, user }).catch(() => undefined)
        }
        return json(200, { deleted: replies.totalDocs > 0 ? 'blanked' : 'removed' })
      },
    },

    {
      path: '/engagement/reactions',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        const b = await body(req)
        if (!isRef(b.target) || typeof b.emoji !== 'string') return json(400, { error: 'target-and-emoji-required' })
        if (!emojis.includes(b.emoji)) return json(400, { error: 'emoji-not-allowed' })

        const judged = await policyTarget(req.payload, commentsSlug, b.target)
        if (!judged || !(await service(req.payload).can('react', req.user as Doc, judged))) return json(403, { error: 'forbidden' })

        const result = await setReaction(req.payload, { reactionsSlug, user: (req.user as Doc).id, target: b.target, emoji: b.emoji, allowed: emojis })
        return json(200, { ...result, summary: await reactionSummary(req.payload, { reactionsSlug, target: b.target }) })
      },
    },
  ]
}
