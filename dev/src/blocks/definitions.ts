import type { Block } from 'payload'
import { COLOR_OPTIONS, linkField, mediaField, mediaManyField } from './fields'

/**
 * Every block the legacy sites used, with the same slugs and field names as in the old data, now structured
 * (typed links, real media relations) so the new sites can render them.
 */

/** Blocks any of our sites may use. */
export const sharedBlocks = (media = 'media'): Block[] => [
  {
    slug: 'media',
    fields: [
      { name: 'mediaList', type: 'array', fields: [{ name: 'media', type: 'upload', relationTo: media as never, required: true }, { name: 'variant', type: 'text' }] },
      { name: 'showLabel', type: 'checkbox' },
      { name: 'maxItemHeight', type: 'text' },
      { name: 'disableDownload', type: 'checkbox' },
    ],
  },
  {
    slug: 'links',
    fields: [{ name: 'text', type: 'text' }, linkField('link1'), linkField('link2'), linkField('link3'), mediaField('backgroundImage', media)],
  },
  {
    slug: 'featured-text-with-image',
    fields: [
      mediaField('featuredImage', media),
      { name: 'title', type: 'text' },
      { name: 'subtitle', type: 'text' },
      { name: 'text', type: 'textarea' },
      linkField('link'),
      { name: 'color', type: 'select', options: COLOR_OPTIONS },
      { name: 'backgroundColor', type: 'select', options: COLOR_OPTIONS },
    ],
  },
  {
    // a live list of content, e.g. the latest blog posts; the old block stored a query, not a hand-picked list
    slug: 'featured-content-list',
    fields: [
      { name: 'source', type: 'select', defaultValue: 'blog', options: [{ label: 'Blog', value: 'blog' }, { label: 'Posts', value: 'post' }, { label: 'Pages', value: 'page' }] },
      { name: 'category', type: 'text', admin: { description: 'Slug of a blog category; empty = all.' } },
      { name: 'isStaggered', type: 'checkbox' },
    ],
  },
]

export const kaleidoBlocks = (media = 'media'): Block[] => [
  {
    slug: 'header',
    fields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'textarea' }, linkField('action'), mediaField('personImage', media), { name: 'altStyle', type: 'checkbox' }],
  },
  {
    slug: 'aboutMe',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'subtitle', type: 'text' },
      { name: 'description', type: 'textarea' },
      linkField('action'),
      mediaField('personImage', media),
      { name: 'imagePlacement', type: 'select', defaultValue: 'left', options: [{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }] },
    ],
  },
  {
    slug: 'feature-list',
    fields: [
      { name: 'overline', type: 'text' },
      { name: 'title', type: 'text' },
      { name: 'description', type: 'textarea' },
      linkField('link'),
      {
        name: 'items',
        type: 'array',
        fields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'textarea' }, mediaField('image', media), linkField('link'), { name: 'tintImage', type: 'checkbox' }],
      },
    ],
  },
  { slug: 'newsletter', fields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'textarea' }] },
]

/** All blocks of this site: the Kaleido ones plus the shared ones. */
export const siteBlocks = (media = 'media'): Block[] => [...kaleidoBlocks(media), ...sharedBlocks(media)]

/** Slugs the importer has to know how to convert. */
export const BLOCK_SLUGS = ['header', 'aboutMe', 'feature-list', 'newsletter', 'media', 'links', 'featured-text-with-image', 'featured-content-list']
