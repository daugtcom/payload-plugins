/**
 * Dev helper: a member (member@dev.test / dev-dev-dev-1) with access to the first course, starting 30 days ago.
 * `payload run scripts/make-member.ts` against whatever DATABASE_URI points at.
 */
import { getAccess } from '@daugtcom/payload-access'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const payload = await getPayload({ config })
const email = 'member@dev.test'
const found = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
const data = { email, password: 'dev-dev-dev-1', roles: ['member'], hasPassword: true, name: 'Dev Member', termsAcceptedAt: new Date().toISOString(), termsVersion: '2026-10' }
const user = found.docs[0] ? await payload.update({ collection: 'users', id: found.docs[0].id, data: data as never, overrideAccess: true }) : await payload.create({ collection: 'users', data: data as never, overrideAccess: true })

const course = (await payload.find({ collection: 'courses', limit: 1, depth: 0, sort: 'createdAt', overrideAccess: true })).docs[0]
if (course) {
  const access = getAccess(payload)
  const target = { relationTo: 'courses', value: course.id }
  const have = await access.windows(user.id, target)
  if (!have.length) await access.grant({ user: user.id, target, start: new Date(Date.now() - 30 * 86_400_000), end: new Date(Date.now() + 335 * 86_400_000), keepAccessibleAfterExpiry: true })
  payload.logger.info(`member ready, access to course "${(course as { title?: string }).title}"`)
}
process.exit(0)
