import type { CollectionConfig, CollectionSlug, Field } from 'payload'

export const DEFAULT_REACTION_EMOJIS = ['❤️', '😂', '🤩', '🥹', '🥰']

export interface EngagementFactoryOptions {
  comments?: string
  reactions?: string
  /** Collections people may comment on / react to. Comments themselves are always valid targets (replies, reactions). */
  targets: string[]
  usersSlug?: string
  mediaSlug?: string
  emojis?: string[]
  commentFields?: Field[]
  /** Staff see who wrote an anonymous comment and may change anything. Default: `roles` includes `admin`. */
  isStaff?: (user: unknown) => boolean
}

/** Comments (with replies) and one-reaction-per-user reactions. */
export function createEngagement(o: EngagementFactoryOptions): { collections: CollectionConfig[]; commentsSlug: string; reactionsSlug: string; emojis: string[] } {
  const commentsSlug = o.comments ?? 'comments'
  const reactionsSlug = o.reactions ?? 'reactions'
  const usersSlug = o.usersSlug ?? 'users'
  const emojis = o.emojis ?? DEFAULT_REACTION_EMOJIS
  const targets = [...o.targets, commentsSlug] as CollectionSlug[]
  const isStaff = o.isStaff ?? ((u: unknown) => Boolean(u && ((u as { roles?: string[] }).roles ?? []).includes('admin')))
  const staff = (req: { user?: unknown }) => Boolean(req.user && isStaff(req.user))
  // Writing goes through the engagement endpoints (they check the policies); direct REST writes are for staff only.
  const access = {
    read: ({ req }: { req: { user?: unknown } }) => Boolean(req.user),
    create: ({ req }: { req: { user?: unknown } }) => staff(req),
    update: ({ req }: { req: { user?: unknown } }) => staff(req),
    delete: ({ req }: { req: { user?: unknown } }) => staff(req),
  }

  const comments: CollectionConfig = {
    slug: commentsSlug,
    admin: { group: 'Engagement', defaultColumns: ['author', 'target', 'createdAt'] },
    access,
    fields: [
      // author stays empty if the member was deleted; an anonymous comment hides it from everyone but staff
      {
        name: 'author',
        type: 'relationship',
        relationTo: usersSlug as CollectionSlug,
        access: { read: ({ req, doc }) => !doc?.anonymous || staff(req) },
      },
      { name: 'anonymous', type: 'checkbox', defaultValue: false },
      { name: 'target', type: 'relationship', relationTo: targets, required: true },
      { name: 'text', type: 'richText' },
      // a comment with replies is blanked, not removed: the replies stay readable under "deleted"
      { name: 'deleted', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar', readOnly: true } },
      ...(o.mediaSlug ? [{ name: 'media', type: 'relationship', relationTo: o.mediaSlug as CollectionSlug, hasMany: true } as Field] : []),
      ...(o.commentFields ?? []),
    ],
  }

  const reactions: CollectionConfig = {
    slug: reactionsSlug,
    admin: { group: 'Engagement', defaultColumns: ['user', 'target', 'emoji'] },
    access,
    fields: [
      { name: 'user', type: 'relationship', relationTo: usersSlug as CollectionSlug, required: true, index: true },
      { name: 'target', type: 'relationship', relationTo: targets, required: true },
      { name: 'emoji', type: 'select', required: true, options: emojis.map((e) => ({ label: e, value: e })) },
    ],
  }

  return { collections: [comments, reactions], commentsSlug, reactionsSlug, emojis }
}

/** Sent-notification history and per-member subscriptions (who wants updates about what). */
export function createNotifications(o: { targets: string[]; subscriptionTargets: string[]; usersSlug?: string; log?: string; subscriptions?: string; logFields?: Field[]; subscriptionFields?: Field[] }): { collections: CollectionConfig[]; logSlug: string; subscriptionsSlug: string } {
  const logSlug = o.log ?? 'notificationLog'
  const subscriptionsSlug = o.subscriptions ?? 'notificationSubscriptions'
  const usersSlug = (o.usersSlug ?? 'users') as CollectionSlug

  const log: CollectionConfig = {
    slug: logSlug,
    admin: { group: 'Engagement', useAsTitle: 'title', defaultColumns: ['title', 'recipientsCount', 'createdAt'] },
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'preview', type: 'textarea', admin: { description: 'What the email looked like.' } },
      { name: 'recipientsCount', type: 'number', defaultValue: 0 },
      { name: 'target', type: 'relationship', relationTo: o.targets as CollectionSlug[] },
      ...(o.logFields ?? []),
    ],
  }
  const subscriptions: CollectionConfig = {
    slug: subscriptionsSlug,
    admin: { group: 'Engagement', defaultColumns: ['user', 'target'] },
    fields: [
      { name: 'user', type: 'relationship', relationTo: usersSlug, required: true, index: true },
      { name: 'target', type: 'relationship', relationTo: o.subscriptionTargets as CollectionSlug[], required: true },
      ...(o.subscriptionFields ?? []),
    ],
  }
  return { collections: [log, subscriptions], logSlug, subscriptionsSlug }
}
