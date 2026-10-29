import type { Block, Field } from 'payload'
import { BoldFeature, ItalicFeature, LinkFeature, OrderedListFeature, ParagraphFeature, UnorderedListFeature, lexicalEditor } from '@payloadcms/richtext-lexical'
import type { ResolvedNewsletterOptions } from './options'

/** The few things that survive in an email: bold, italic, links and lists. */
const mailEditor = () => lexicalEditor({ features: () => [ParagraphFeature(), BoldFeature(), ItalicFeature(), LinkFeature({ enabledCollections: [] }), UnorderedListFeature(), OrderedListFeature()] })

const align = (): Field => ({ name: 'align', type: 'select', label: 'Ausrichtung', defaultValue: 'left', options: [{ label: 'Links', value: 'left' }, { label: 'Zentriert', value: 'center' }] })

/** The blocks of a newsletter, German labels. The post teaser is only there when the site names collections for it. */
export function newsletterBlocks(o: ResolvedNewsletterOptions): Block[] {
  const blocks: Block[] = [
    { slug: 'heading', labels: { singular: 'Überschrift', plural: 'Überschriften' }, fields: [
      { name: 'text', type: 'text', label: 'Text', required: true },
      { name: 'level', type: 'select', label: 'Größe', defaultValue: 'h2', options: [{ label: 'Groß', value: 'h1' }, { label: 'Mittel', value: 'h2' }, { label: 'Klein', value: 'h3' }] },
      align(),
    ] },
    { slug: 'text', labels: { singular: 'Text', plural: 'Texte' }, fields: [{ name: 'content', type: 'richText', label: 'Text', required: true, editor: mailEditor() }] },
    { slug: 'image', labels: { singular: 'Bild', plural: 'Bilder' }, fields: [
      { name: 'image', type: 'upload', relationTo: o.mediaSlug as never, label: 'Bild', required: true },
      { name: 'alt', type: 'text', label: 'Bildbeschreibung' },
      { name: 'caption', type: 'text', label: 'Bildunterschrift' },
      { name: 'link', type: 'text', label: 'Link (optional)', admin: { placeholder: 'https://…' } },
    ] },
    { slug: 'button', labels: { singular: 'Button', plural: 'Buttons' }, fields: [
      { name: 'label', type: 'text', label: 'Beschriftung', required: true },
      { name: 'url', type: 'text', label: 'Adresse', required: true, admin: { placeholder: 'https://… oder /seite' } },
      align(),
    ] },
    { slug: 'divider', labels: { singular: 'Trennlinie', plural: 'Trennlinien' }, fields: [{ name: 'spacing', type: 'select', label: 'Abstand', defaultValue: 'normal', options: [{ label: 'Normal', value: 'normal' }, { label: 'Groß', value: 'large' }] }] },
    { slug: 'columns', labels: { singular: 'Bild und Text', plural: 'Bild und Text' }, fields: [
      { name: 'image', type: 'upload', relationTo: o.mediaSlug as never, label: 'Bild', required: true },
      { name: 'imageSide', type: 'select', label: 'Bild steht', defaultValue: 'left', options: [{ label: 'Links', value: 'left' }, { label: 'Rechts', value: 'right' }] },
      { name: 'heading', type: 'text', label: 'Überschrift' },
      { name: 'content', type: 'richText', label: 'Text', editor: mailEditor() },
      { type: 'row', fields: [{ name: 'buttonLabel', type: 'text', label: 'Button-Beschriftung' }, { name: 'buttonUrl', type: 'text', label: 'Button-Adresse' }] },
    ] },
  ]
  if (o.teaserCollections.length) {
    blocks.push({ slug: 'teaser', labels: { singular: 'Beitrags-Teaser', plural: 'Beitrags-Teaser' }, fields: [
      { name: 'doc', type: 'relationship', relationTo: o.teaserCollections as never, label: 'Beitrag', required: true },
      { name: 'buttonLabel', type: 'text', label: 'Button-Beschriftung', defaultValue: 'Weiterlesen' },
    ] })
  }
  return blocks
}
