import type { Payload, PayloadRequest, Where } from 'payload'
import { accessTimeslots, canAccessTarget, isDateInSlots, type EntitlementWindow, type Timeslots } from './rules'
import type { AccessEvents } from './events'
import type { CollectionPolicy, EntitlementDoc, PolicyAction, SeriesRelation, TargetRef } from './types'

export interface ResolvedAccess {
  slug: string
  usersSlug: string
  targetCollections: string[]
  series: SeriesRelation[]
  isStaff: (user: unknown) => boolean
  events: AccessEvents
  policies: Record<string, CollectionPolicy>
}

const idOf = (v: unknown): string | number =>
  v && typeof v === 'object' ? (v as { id: string | number }).id : (v as string | number)

const asDate = (v: string | null | undefined): Date | null => (v ? new Date(v) : null)

/** Turn a stored entitlement into the pure rule input. */
export function toWindow(e: EntitlementDoc): EntitlementWindow {
  return {
    start: asDate(e.validityStart),
    end: asDate(e.validityEnd),
    keepAccessibleAfterExpiry: Boolean(e.keepAccessibleAfterExpiry),
    keepUnlockedWhenActive: Boolean(e.keepUnlockedWhenActive),
  }
}

const targetWhere = (t: TargetRef): Where => ({
  and: [{ 'target.relationTo': { equals: t.relationTo } }, { 'target.value': { equals: t.value } }],
})

export interface GrantInput {
  user: string | number
  target: TargetRef
  start?: Date | null
  end?: Date | null
  keepAccessibleAfterExpiry?: boolean
  keepUnlockedWhenActive?: boolean
  /** Additional field values (e.g. `order`, `legacy`) */
  data?: Record<string, unknown>
  /** Pass the current request when called from a hook so the write joins its transaction. */
  req?: PayloadRequest
}

/** Reads and writes entitlements through the Local API and applies the pure rules. */
export class AccessService {
  constructor(
    private readonly payload: Payload,
    private readonly cfg: ResolvedAccess,
  ) {}

  get events(): AccessEvents {
    return this.cfg.events
  }

  /**
   * May this member view / comment on / react to the document?
   * Staff: always. Otherwise the collection's policy; without one, unlockable collections need a valid
   * entitlement to view, other collections are public, and comment/react follow view.
   */
  async can(action: PolicyAction, user: { id: string | number } | null, target: TargetRef, at: Date = new Date()): Promise<boolean> {
    if (user && this.isStaff(user)) return true
    const doc = (await this.payload.findByID({ collection: target.relationTo as never, id: target.value, depth: 0, overrideAccess: true }).catch(() => null)) as (Record<string, any> & { id: string | number; _status?: string }) | null
    if (!doc) return false
    if (doc._status && doc._status !== 'published') return false
    const policy = this.cfg.policies[target.relationTo]
    const ctx = { payload: this.payload, user, at, service: this }
    const viewDefault = async () => (this.cfg.targetCollections.includes(target.relationTo) ? Boolean(user) && (await this.canAccess(user!.id, target, at)) : true)
    const view = async () => (policy?.view ? Boolean(user) && (await policy.view(doc, ctx)) : viewDefault())
    if (action === 'view') return view()
    const custom = action === 'comment' ? policy?.comment : policy?.react
    if (custom) return Boolean(user) && (await custom(doc, ctx))
    return Boolean(user) && (await view())
  }

  isStaff(user: unknown): boolean {
    return Boolean(user) && this.cfg.isStaff(user)
  }

  async entitlements(userId: string | number, target?: TargetRef, req?: PayloadRequest): Promise<EntitlementDoc[]> {
    const where: Where = target ? { and: [{ user: { equals: userId } }, targetWhere(target)] } : { user: { equals: userId } }
    const res = await this.payload.find({
      collection: this.cfg.slug as never,
      where,
      limit: 0,
      pagination: false,
      depth: 0,
      overrideAccess: true,
      req,
    })
    return res.docs as unknown as EntitlementDoc[]
  }

  async windows(userId: string | number, target: TargetRef): Promise<EntitlementWindow[]> {
    return (await this.entitlements(userId, target)).map(toWindow)
  }

  /** Does the target exist and is it published (when it has drafts)? */
  async isTargetAvailable(target: TargetRef): Promise<boolean> {
    try {
      const doc = (await this.payload.findByID({ collection: target.relationTo as never, id: target.value, depth: 0, overrideAccess: true })) as unknown as { _status?: string }
      return !doc._status || doc._status === 'published'
    } catch {
      return false
    }
  }

  async canAccess(userId: string | number, target: TargetRef, at: Date = new Date()): Promise<boolean> {
    if (!(await this.isTargetAvailable(target))) return false
    return canAccessTarget(await this.windows(userId, target), at)
  }

  /** All targets the user can currently reach, optionally limited to one collection. */
  async accessibleTargets(userId: string | number, collection?: string, at: Date = new Date()): Promise<TargetRef[]> {
    const seen = new Set<string>()
    const out: TargetRef[] = []
    for (const e of await this.entitlements(userId)) {
      const ref: TargetRef = { relationTo: e.target.relationTo, value: idOf(e.target.value) }
      if (collection && ref.relationTo !== collection) continue
      const key = `${ref.relationTo}:${ref.value}`
      if (seen.has(key) || !canAccessTarget([toWindow(e)], at)) continue
      if (!(await this.isTargetAvailable(ref))) continue
      seen.add(key)
      out.push(ref)
    }
    return out
  }

  async accessTimeslots(userId: string | number, series: TargetRef, at: Date = new Date()): Promise<Timeslots> {
    return accessTimeslots(await this.windows(userId, series), at)
  }

  private relationFor(series: TargetRef, relation?: SeriesRelation): SeriesRelation {
    const r = relation ?? this.cfg.series.find((s) => s.parent === series.relationTo)
    if (!r) throw new Error(`No series relation configured for ${series.relationTo}`)
    return r
  }

  /** Published items of a series that the user may see right now (item date inside an access window). */
  async accessibleSeriesItems(userId: string | number, series: TargetRef, opts: { relation?: SeriesRelation; at?: Date } = {}) {
    const at = opts.at ?? new Date()
    const r = this.relationFor(series, opts.relation)
    const field = r.field ?? 'series'
    const dateField = r.dateField ?? 'publishedAt'
    const { unrestricted, slots } = await this.accessTimeslots(userId, series, at)
    if (!unrestricted && slots.length === 0) return []

    const res = await this.payload.find({
      collection: r.items as never,
      where: { and: [{ [field]: { equals: series.value } }, { [dateField]: { less_than_equal: at.toISOString() } }] },
      limit: 0,
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
    const items = res.docs as unknown as Record<string, unknown>[]
    return items.filter((i) => unrestricted || isDateInSlots(asDate(i[dateField] as string | null), slots))
  }

  /** Users who currently have direct access to the target. */
  async usersWithAccessToTarget(target: TargetRef, at: Date = new Date()): Promise<(string | number)[]> {
    const res = await this.payload.find({ collection: this.cfg.slug as never, where: targetWhere(target), limit: 0, pagination: false, depth: 0, overrideAccess: true })
    const users = new Set<string | number>()
    for (const e of res.docs as unknown as EntitlementDoc[]) {
      if (canAccessTarget([toWindow(e)], at)) users.add(idOf(e.user))
    }
    return [...users]
  }

  async grant(input: GrantInput): Promise<EntitlementDoc> {
    const doc = await this.payload.create({
      collection: this.cfg.slug as never,
      data: {
        user: input.user,
        target: input.target,
        validityStart: input.start?.toISOString() ?? null,
        validityEnd: input.end?.toISOString() ?? null,
        keepAccessibleAfterExpiry: input.keepAccessibleAfterExpiry ?? false,
        keepUnlockedWhenActive: input.keepUnlockedWhenActive ?? false,
        ...input.data,
      } as never,
      depth: 0,
      overrideAccess: true,
      req: input.req,
    })
    return doc as unknown as EntitlementDoc
  }

  async revoke(id: string | number, req?: PayloadRequest): Promise<void> {
    await this.payload.delete({ collection: this.cfg.slug as never, id, overrideAccess: true, req })
  }
}
