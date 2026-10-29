import type { CollectionSlug, Field, Payload, PayloadRequest } from 'payload'

/** How items (lessons, posts…) relate to the series (course) they belong to. */
export interface SeriesRelation {
  /** Slug of the series collection, e.g. `courses`. Must be one of `targetCollections`. */
  parent: CollectionSlug
  /** Slug of the items collection, e.g. `lessons`. */
  items: CollectionSlug
  /** Relationship field on the items pointing to the series (hasMany allowed). Default `series`. */
  field?: string
  /** Date field on the items that decides which access window an item falls into. Default `publishedAt`. */
  dateField?: string
}

export type PolicyAction = 'view' | 'comment' | 'react'

export interface PolicyContext {
  payload: Payload
  /** null = not logged in */
  user: { id: string | number } | null
  at: Date
  service: import('./service').AccessService
}

/**
 * Per-collection answers to "may this member view / comment on / react to this document?".
 * Whatever is not defined falls back to: view = valid entitlement (for unlockable collections, otherwise public),
 * comment and react = may view. Staff always may.
 */
export interface CollectionPolicy {
  view?: (doc: Record<string, any> & { id: string | number }, ctx: PolicyContext) => boolean | Promise<boolean>
  comment?: (doc: Record<string, any> & { id: string | number }, ctx: PolicyContext) => boolean | Promise<boolean>
  react?: (doc: Record<string, any> & { id: string | number }, ctx: PolicyContext) => boolean | Promise<boolean>
}

export interface EngagementOptions {
  commentsSlug?: string
  reactionsSlug?: string
  /** Allowed reaction emojis. Default: the legacy five. */
  emojis?: string[]
  /** The media collection members may attach pictures to comments in. Default `media`; it needs the fields `userUpload` and `uploadedBy`. */
  mediaSlug?: string
  /** Pictures per comment. Default 5. */
  maxImages?: number
  /** Largest picture in MB. Default 10. */
  maxImageMB?: number
  /** Folder in the storage bucket for members' pictures, when the media collection has a `prefix` field (the old member uploads live in `user-uploads`). Default `user-uploads`. */
  uploadPrefix?: string
}

export interface AccessPluginOptions {
  enabled?: boolean
  /** Auth collection holding the members. Default `users`. */
  usersSlug?: CollectionSlug
  /** Collections whose documents can be unlocked by an entitlement. */
  targetCollections: CollectionSlug[]
  /** Series → items relations (course-style content). */
  series?: SeriesRelation[]
  /** Staff bypass the rules and manage entitlements. Default: `user.roles` includes `admin`. */
  isStaff?: (user: unknown) => boolean
  /** Policies per collection (see `createCoursePolicy` for the legacy course rules). */
  policies?: Record<string, CollectionPolicy>
  /** Turns on `/api/access/dashboard` and the notification endpoints (staff preview/send, public unsubscribe). */
  memberArea?: import('./endpoints/member').MemberEndpointsOptions
  /** Turns on the comment / reaction endpoints (collections from `createEngagement`). */
  engagement?: EngagementOptions
  /** Slug of the entitlements collection. Default `entitlements`. */
  slug?: string
  /** Extra fields on entitlements (other plugins and importers add `order`, `legacy`…). */
  extraFields?: Field[]
  /** Called after an entitlement was created / deleted. */
  onGranted?: (entitlement: EntitlementDoc, req: PayloadRequest) => void | Promise<void>
  onRevoked?: (entitlement: EntitlementDoc, req: PayloadRequest) => void | Promise<void>
}

export interface TargetRef {
  relationTo: string
  value: string | number
}

export interface EntitlementDoc {
  id: string | number
  user: string | number | { id: string | number }
  target: { relationTo: string; value: string | number | { id: string | number } }
  validityStart?: string | null
  validityEnd?: string | null
  keepAccessibleAfterExpiry?: boolean | null
  keepUnlockedWhenActive?: boolean | null
  [key: string]: unknown
}
