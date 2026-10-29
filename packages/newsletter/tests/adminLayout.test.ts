import { expect, it } from 'vitest'
import { newslettersCollection } from '../src/collections/newsletters'
import { resolveOptions } from '../src/plugin'

it('uses Payload live preview rather than a separate sidebar preview', () => {
  const collection = newslettersCollection(resolveOptions({ theme: { siteName: 'Test', baseUrl: 'https://example.com', colors: {} } as never }))
  expect(collection.admin?.livePreview?.url).toBeDefined()
  expect(collection.fields.find((field) => 'name' in field && field.name === 'preview')).toBeUndefined()
  expect(collection.fields.find((field) => 'name' in field && field.name === 'tools')).toBeDefined()
})
