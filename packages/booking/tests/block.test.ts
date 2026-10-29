import { expect, it } from 'vitest'
import * as booking from '../src/index'

it('exports the compatible bookable block', () => {
  expect((booking as any).bookableBlock).toMatchObject({ slug: 'bookable', fields: [{ name: 'product', type: 'relationship', relationTo: 'products', required: true }, { name: 'title' }, { name: 'description' }] })
})
