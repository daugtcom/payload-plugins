import type { CollectionConfig } from 'payload'

export const LOGIN_CHALLENGES_SLUG = 'loginChallenges'

/** One pending code/link per request. Server-only: no access for anyone, everything goes through the endpoints. */
export const loginChallenges: CollectionConfig = {
  slug: LOGIN_CHALLENGES_SLUG,
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  timestamps: true,
  fields: [
    { name: 'email', type: 'email', required: true, index: true },
    { name: 'codeHash', type: 'text', required: true },
    { name: 'tokenHash', type: 'text', required: true, index: true },
    { name: 'expiresAt', type: 'date', required: true, index: true },
    { name: 'ipHash', type: 'text', index: true },
    { name: 'attempts', type: 'number', defaultValue: 0 },
    { name: 'redirect', type: 'text' },
    { name: 'termsAcceptedAt', type: 'date' },
    { name: 'termsVersion', type: 'text' },
    // `email-change`: bound to a signed-in member (`userId`), `email` is the NEW address. Empty/`login` = a normal login challenge.
    { name: 'purpose', type: 'text', index: true },
    { name: 'userId', type: 'text', index: true },
  ],
}

export const IMPERSONATION_LOG_SLUG = 'impersonationLog'

/** Who looked at the site as whom, and when. */
export const impersonationLog = (isStaff: (u: unknown) => boolean): CollectionConfig => ({
  slug: IMPERSONATION_LOG_SLUG,
  admin: { group: 'Access', defaultColumns: ['staff', 'target', 'createdAt', 'endedAt'] },
  access: { read: ({ req }) => Boolean(req.user && isStaff(req.user)), create: () => false, update: () => false, delete: () => false },
  timestamps: true,
  fields: [
    { name: 'staff', type: 'text', required: true },
    { name: 'target', type: 'text', required: true },
    { name: 'endedAt', type: 'date' },
  ],
})
