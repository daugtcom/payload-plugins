import { expect, it } from 'vitest'
import { autoSlug } from '../src/index'

it('generates a German URL from the title and keeps an existing URL on edits', async () => {
  const config = await autoSlug(['pages'])({ collections: [{ slug: 'pages', fields: [{ name: 'slug', type: 'text', required: true }] }] })
  const field = config.collections![0]!.fields[0]!
  if (!('name' in field) || field.type !== 'text') throw new Error('slug field missing')
  const hook = field.hooks?.beforeValidate?.at(-1)
  expect(hook).toBeDefined()
  const args = { siblingData: { title: 'Über Größe & Wärme' }, operation: 'create', value: undefined } as never
  expect(await hook!(args)).toBe('ueber-groesse-waerme')
  expect(await hook!({ siblingData: { title: 'Neuer Titel' }, originalDoc: { slug: 'alte-adresse' }, operation: 'update', value: 'alte-adresse' } as never)).toBe('alte-adresse')
  expect(field.admin?.readOnly).toBe(true)
  expect(field.admin?.hidden).toBe(true)
})
