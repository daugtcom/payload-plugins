/** Dev helper: an administrator with a known password in whatever database DATABASE_URI points at. `payload run scripts/make-admin.ts` */
import { getPayload } from 'payload'
import config from '../src/payload.config'

const payload = await getPayload({ config })
const email = process.env.ADMIN_EMAIL ?? 'admin@dev.test'
const found = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
const data = { email, password: 'dev-dev-dev-1', roles: ['admin'], hasPassword: true, name: 'Dev Admin' }
if (found.docs[0]) await payload.update({ collection: 'users', id: found.docs[0].id, data: data as never, overrideAccess: true })
else await payload.create({ collection: 'users', data: data as never, overrideAccess: true })
payload.logger.info(`admin ${email} ready`)
process.exit(0)
