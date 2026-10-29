import path from 'node:path'
import type { CollectionConfig, Field } from 'payload'

export const media = (legacy: Field[], dir: string): CollectionConfig => ({
  slug: 'media',
  access: { read: () => true }, // shown on public pages; the files are public in the bucket anyway
  upload: { staticDir: path.resolve(dir, '../media'), imageSizes: [{ name: 'thumbnail', width: 400 }, { name: 'optimized', width: 1600 }] },
  fields: [
    { name: 'alt', type: 'text' },
    { name: 'title', type: 'text' },
    { name: 'uploadedBy', type: 'relationship', relationTo: 'users' },
    { name: 'userUpload', type: 'checkbox', defaultValue: false, admin: { description: 'Uploaded by a member (for example into a comment), not by staff.' } },
    { name: 'kind', type: 'select', options: ['image', 'video', 'audio', 'pdf', 'archive', 'vector'], admin: { position: 'sidebar' } },
    { name: 'storageKey', type: 'text', index: true, admin: { readOnly: true, description: 'Object key in the bucket.' } },
    ...legacy,
  ],
})
