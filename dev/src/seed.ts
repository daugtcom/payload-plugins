/** Dev data: an admin, a member, a course with lessons and a few products. Idempotent. `npm run payload -- run src/seed.ts` */
import { getPayload } from 'payload'
import config from './payload.config'

const payload = await getPayload({ config })

const upsert = async (collection: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
  const found = await payload.find({ collection: collection as never, where: where as never, limit: 1, depth: 0, overrideAccess: true, draft: true })
  if (found.docs[0]) return found.docs[0] as unknown as { id: number | string }
  return (await payload.create({ collection: collection as never, data: data as never, overrideAccess: true })) as unknown as { id: number | string }
}

await upsert('users', { email: { equals: 'admin@dev.test' } }, { email: 'admin@dev.test', password: 'dev-dev-dev-1', name: 'Dev Admin', roles: ['admin'] })
await upsert('users', { email: { equals: 'member@dev.test' } }, { email: 'member@dev.test', password: 'dev-dev-dev-1', name: 'Dev Member', roles: ['member'] })

const course = await upsert('courses', { slug: { equals: 'archetypes' } }, { title: 'Archetypes 2026', slug: 'archetypes', _status: 'published' })
const day = 86_400_000
for (const [i, daysAgo] of [60, 30, 7].entries()) {
  await upsert('lessons', { slug: { equals: `lesson-${i + 1}` } }, { title: `Lesson ${i + 1}`, slug: `lesson-${i + 1}`, series: [course.id], publishedAt: new Date(Date.now() - daysAgo * day).toISOString(), _status: 'published' })
}

const size = await upsert('shippingSizes', { name: { equals: 'Small parcel' } }, { name: 'Small parcel', rates: [{ country: 'AT', amount: 4 }, { country: 'DE', amount: 6 }], fallbackRate: 12 })
const product = (title: string, commerce: Record<string, unknown>, price: number) =>
  upsert('products', { title: { equals: title } }, { title, priceInEURENABLED: true, priceInEUR: price, inventory: 100, _status: 'published', commerce })
await product('Archetypes course (1 year)', { billingType: 'one_time', accessItems: [{ target: { relationTo: 'courses', value: course.id }, mode: 'duration', duration: 1, durationUnit: 'year', keepAccessibleAfterExpiry: true }] }, 29_000)
await product('Oracle cards (ships)', { billingType: 'one_time', requiresShipping: true, shippingSize: size.id }, 3_900)
await product('Membership (monthly)', { billingType: 'recurring', intervalCount: 1, intervalUnit: 'month', durationType: 'permanent', accessItems: [{ target: { relationTo: 'courses', value: course.id }, mode: 'permanent' }] }, 1_900)

payload.logger.info('Seeded dev data')
process.exit(0)
