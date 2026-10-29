import type { Payload } from 'payload'

const snake = (s: string) => s.replace(/-/g, '_')

/**
 * The DDL that makes overlapping bookings impossible even when two buyers pick the same slot in the same millisecond:
 * an exclusion constraint on the blocked time range, per calendar (`resource`), for bookings that hold a slot.
 * Idempotent. In production with migrations, put this SQL into a migration too (`payload migrate:create`); the plugin
 * also runs it at start-up, which is harmless when the constraint exists.
 */
export const exclusionConstraintSql = (table: string, qualified = `"${table}"`): string => `
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${table}_no_overlap' AND conrelid = '${qualified}'::regclass) THEN
    ALTER TABLE ${qualified} ADD CONSTRAINT "${table}_no_overlap"
      EXCLUDE USING gist ("resource" WITH =, tstzrange("block_start", "block_end") WITH &&)
      WHERE ("status" IN ('held', 'confirmed'));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`

export async function applyExclusionConstraint(payload: Payload, bookingsSlug: string): Promise<boolean> {
  const db = payload.db as unknown as { pool?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }; tableNameMap?: Map<string, string>; schemaName?: string }
  if (!db.pool?.query) {
    payload.logger.warn('payload-booking: this database adapter has no pg pool; apply the exclusion constraint yourself (exclusionConstraintSql)')
    return false
  }
  const table = db.tableNameMap?.get(snake(bookingsSlug)) ?? snake(bookingsSlug)
  const qualified = db.schemaName ? `"${db.schemaName}"."${table}"` : `"${table}"`
  const found = await db.pool.query('select to_regclass($1)::text as t', [qualified])
  if (!found.rows[0]?.t) {
    payload.logger.warn(`payload-booking: table ${qualified} does not exist yet (run migrations), the no-overlap constraint is not applied`)
    return false
  }
  try {
    await db.pool.query(exclusionConstraintSql(table, qualified))
    return true
  } catch (err) {
    payload.logger.error({ err, msg: 'payload-booking: could not apply the no-overlap constraint (existing overlapping bookings?)' })
    return false
  }
}

/** Postgres raises 23P01 when two bookings overlap. Drivers and Payload wrap the error, so look through the causes. */
export function isOverlapError(err: unknown): boolean {
  for (let e = err as { code?: string; message?: string; cause?: unknown } | undefined, n = 0; e && n < 6; e = e.cause as typeof e, n++) {
    if (e.code === '23P01') return true
    if (typeof e.message === 'string' && /exclusion constraint|_no_overlap/.test(e.message)) return true
  }
  return false
}
