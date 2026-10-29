import type { Block } from 'payload'

/** Landing page signup block; slug and fields match the legacy importer. */
export const newsletterSignupBlock: Block = { slug: 'newsletter', fields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'textarea' }] }
