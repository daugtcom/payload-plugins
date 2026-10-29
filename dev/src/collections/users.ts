import type { CollectionConfig, Field } from 'payload'

export const users = (legacy: Field[]): CollectionConfig => ({
  slug: 'users',
  // members normally sign in with an emailed code; the password route (and the admin) is locked after repeated failures
  auth: { maxLoginAttempts: 5, lockTime: 10 * 60 * 1000 },
  admin: { useAsTitle: 'email' },
  fields: [
    { name: 'name', type: 'text' },
    { name: 'roles', type: 'select', hasMany: true, options: ['admin', 'member'], defaultValue: ['member'], required: true },
    { name: 'emailVerifiedAt', type: 'date' },
    ...legacy,
  ],
})
