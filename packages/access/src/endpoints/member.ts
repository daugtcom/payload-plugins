import type { Endpoint, Payload } from 'payload'
import { getMemberDashboard } from '../dashboard'
import { previewRecipients, sendContentNotification, verifyUnsubscribeToken, type NotificationOptions } from '../notifications'
import type { AccessService } from '../service'

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export interface MemberEndpointsOptions {
  coursesSlug?: string
  lessonsSlug?: string
  singlesSlug?: string
  notifications?: NotificationOptions
}

/** `/api/access/dashboard` for members; `/api/access/notifications/*` for staff and the unsubscribe link. */
export function memberEndpoints(o: MemberEndpointsOptions, service: (p: Payload) => AccessService): Endpoint[] {
  const staff = (p: Payload, user: unknown) => Boolean(user) && service(p).isStaff(user)
  return [
    {
      path: '/access/dashboard',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        return json(200, await getMemberDashboard(req.payload, service(req.payload), { userId: (req.user as { id: string | number }).id, coursesSlug: o.coursesSlug, lessonsSlug: o.lessonsSlug, singlesSlug: o.singlesSlug }))
      },
    },
    {
      path: '/access/notifications/preview',
      method: 'post',
      handler: async (req) => {
        if (!staff(req.payload, req.user)) return json(403, { error: 'forbidden' })
        const b = (await req.json?.().catch(() => ({}))) as { target?: { relationTo: string; value: string | number } }
        if (!b?.target) return json(400, { error: 'target-required' })
        return json(200, await previewRecipients(req.payload, service(req.payload), { target: b.target, ...o.notifications }))
      },
    },
    {
      path: '/access/notifications/send',
      method: 'post',
      handler: async (req) => {
        if (!staff(req.payload, req.user)) return json(403, { error: 'forbidden' })
        const b = (await req.json?.().catch(() => ({}))) as { target?: { relationTo: string; value: string | number }; title?: string; url?: string }
        if (!b?.target || !b.title) return json(400, { error: 'target-and-title-required' })
        return json(200, await sendContentNotification(req.payload, service(req.payload), { target: b.target, title: b.title, url: b.url, ...o.notifications }))
      },
    },
    // the course switch "E-Mail bei neuen Beiträgen": on / off for the signed-in member, who must have access to the course
    {
      path: '/access/notifications/subscribe',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        const { payload } = req
        const user = req.user as { id: string | number }
        const b = (await req.json?.().catch(() => ({}))) as { courseId?: string | number; subscribed?: boolean }
        const coursesSlug = o.coursesSlug ?? 'courses'
        const subsSlug = o.notifications?.subscriptionsSlug ?? 'notificationSubscriptions'
        if (b?.courseId === undefined || b.courseId === null) return json(400, { error: 'course-required' })
        const course = await payload.findByID({ collection: coursesSlug as never, id: b.courseId, depth: 0, overrideAccess: true }).catch(() => null)
        if (!course) return json(404, { error: 'not-found' })
        const target = { relationTo: coursesSlug, value: b.courseId }
        const svc = service(payload)
        if (!svc.isStaff(user) && (await svc.windows(user.id, target)).length === 0) return json(403, { error: 'forbidden' })

        const where = { and: [{ user: { equals: user.id } }, { 'target.relationTo': { equals: coursesSlug } }, { 'target.value': { equals: b.courseId } }] }
        const found = await payload.find({ collection: subsSlug as never, where: where as never, limit: 0, pagination: false, depth: 0, overrideAccess: true })
        const want = typeof b.subscribed === 'boolean' ? b.subscribed : found.docs.length === 0
        if (!want) { for (const d of found.docs as unknown as { id: string | number }[]) await payload.delete({ collection: subsSlug as never, id: d.id, overrideAccess: true }) }
        else if (found.docs.length === 0) await payload.create({ collection: subsSlug as never, data: { user: user.id, target } as never, overrideAccess: true })
        return json(200, { subscribed: want })
      },
    },
    // the link in every mail: removes the subscription without logging in (signed, per member and course)
    {
      path: '/access/notifications/unsubscribe',
      method: 'get',
      handler: async (req) => {
        const q = new URL(req.url ?? 'http://x').searchParams
        const user = q.get('user'), course = q.get('course'), token = q.get('token')
        if (!user || !course || !token || !verifyUnsubscribeToken(req.payload, user, course, token)) return json(400, { error: 'invalid-link' })
        await req.payload.delete({ collection: (o.notifications?.subscriptionsSlug ?? 'notificationSubscriptions') as never, where: { and: [{ user: { equals: user } }, { 'target.value': { equals: course } }] }, overrideAccess: true })
        return json(200, { unsubscribed: true })
      },
    },
  ]
}
