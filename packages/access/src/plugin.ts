import type { Config, Payload, Plugin } from 'payload'
import { entitlementsCollection, DEFAULT_ENTITLEMENTS_SLUG } from './collections/entitlements'
import { AccessEvents } from './events'
import { engagementEndpoints } from './endpoints/engagement'
import { memberEndpoints } from './endpoints/member'
import { AccessService, type ResolvedAccess } from './service'
import type { AccessPluginOptions, EntitlementDoc } from './types'

const defaultIsStaff = (user: unknown): boolean => {
  const u = user as { roles?: string[]; role?: string } | null
  return Boolean(u && (u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin'))))
}

interface AccessState extends ResolvedAccess {
  memberArea?: { coursesSlug?: string; lessonsSlug?: string; singlesSlug?: string; sectionsSlug?: string }
  service?: AccessService
}

/** Entitlements and series access for Payload. */
export const payloadAccess =
  (options: AccessPluginOptions): Plugin =>
  (incoming: Config): Config => {
    if (options.enabled === false) return incoming

    const events = new AccessEvents()
    const isStaff = options.isStaff ?? defaultIsStaff
    const slug = options.slug ?? DEFAULT_ENTITLEMENTS_SLUG
    const usersSlug = options.usersSlug ?? 'users'

    const collection = entitlementsCollection({ usersSlug, targetCollections: options.targetCollections, isStaff, slug, extraFields: options.extraFields })
    collection.hooks = {
      ...collection.hooks,
      afterChange: [
        ...(collection.hooks?.afterChange ?? []),
        async ({ doc, operation, req }) => {
          if (operation !== 'create') return doc
          await events.emit('granted', doc as EntitlementDoc)
          await options.onGranted?.(doc as EntitlementDoc, req)
          return doc
        },
      ],
      afterDelete: [
        ...(collection.hooks?.afterDelete ?? []),
        async ({ doc, req }) => {
          await events.emit('revoked', doc as EntitlementDoc)
          await options.onRevoked?.(doc as EntitlementDoc, req)
          return doc
        },
      ],
    }

    const state: AccessState = { slug, usersSlug, targetCollections: options.targetCollections as string[], series: options.series ?? [], isStaff, events, policies: options.policies ?? {}, memberArea: options.memberArea }

    return {
      ...incoming,
      collections: [...(incoming.collections ?? []), collection],
      endpoints: [...(incoming.endpoints ?? []), ...(options.engagement ? engagementEndpoints(options.engagement, getAccess) : []), ...(options.memberArea ? memberEndpoints(options.memberArea, getAccess) : [])],
      custom: { ...incoming.custom, daugtAccess: state },
    }
  }

/** The access service of a running Payload instance (created lazily, cached on the plugin state). */
export function getAccess(payload: Payload): AccessService {
  const state = (payload.config.custom as { daugtAccess?: AccessState } | undefined)?.daugtAccess
  if (!state) throw new Error('payloadAccess plugin is not installed')
  return (state.service ??= new AccessService(payload, state))
}
