import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import pg from 'pg'
import { buildConfig, getPayload, type CollectionConfig, type Payload, type Plugin } from 'payload'

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://plugins:plugins@127.0.0.1:54330/postgres'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  fields: [{ name: 'roles', type: 'select', hasMany: true, options: ['admin', 'member'], defaultValue: ['member'] }],
}

export const Media: CollectionConfig = {
  slug: 'media',
  upload: { staticDir: tmpdir() },
  fields: [{ name: 'alt', type: 'text' }],
}

/** Drops leftover throwaway databases of earlier runs. Databases still in use fail to drop and are skipped. */
async function dropStale(admin: pg.Client): Promise<void> {
  const { rows } = await admin.query<{ datname: string }>(`select datname from pg_database where datname like 't\\_%'`)
  for (const { datname } of rows) await admin.query(`drop database if exists "${datname}"`).catch(() => undefined)
}

export interface Booted {
  payload: Payload
  dbName: string
  close: () => Promise<void>
}

/** Boots Payload against a throwaway database on the scratch Postgres. Needs `mise run db:up`. */
export async function boot(o: { collections: CollectionConfig[]; plugins: Plugin[]; users?: CollectionConfig }): Promise<Booted> {
  const dbName = `t_${randomBytes(6).toString('hex')}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await dropStale(admin)
  await admin.query(`create database ${dbName}`)
  await admin.end()

  const config = buildConfig({
    secret: 'test-secret-test-secret-test-secret',
    db: postgresAdapter({ pool: { connectionString: ADMIN_URL.replace(/\/postgres$/, `/${dbName}`) }, push: true }),
    editor: lexicalEditor(),
    collections: [o.users ?? Users, Media, ...o.collections],
    plugins: o.plugins,
    typescript: { autoGenerate: false },
  })
  const payload = await getPayload({ config, key: dbName })

  return {
    payload,
    dbName,
    // Payload closes its own pool. The database itself is cleaned up by the next run (see `dropStale`),
    // because dropping it while connections are closing makes pg report an uncaught "terminating connection".
    close: async () => {
      await payload.destroy()
    },
  }
}
