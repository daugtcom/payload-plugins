import { BlocksFeature, CodeBlock, TextStateFeature, lexicalEditor } from '@payloadcms/richtext-lexical'
import { siteBlocks } from './definitions'

/** Colour and font tokens used inside legacy text. The tokens must match the old data. */
export const legacyTextState = {
  color: Object.fromEntries(['primary-500', 'primary-800', 'neutral-500', 'neutral-800', '#fff'].map((k) => [k, { label: k, css: { color: k.startsWith('#') ? k : `var(--color-${k})` } }])),
  fontFamily: { accent: { label: 'accent', css: { 'font-family': 'var(--font-accent)' } } },
}

/** The rich-text editor: Payload's defaults plus this site's blocks and the legacy colour/font marks. */
export const siteEditor = (o: { mediaSlug?: string } = {}) =>
  lexicalEditor({
    features: ({ defaultFeatures }) => [
      ...defaultFeatures,
      TextStateFeature({ state: legacyTextState }),
      BlocksFeature({ blocks: [CodeBlock(), ...siteBlocks(o.mediaSlug)] }),
    ],
  })
