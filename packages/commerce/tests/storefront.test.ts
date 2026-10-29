import { expect, it, vi } from 'vitest'
import * as commerce from '../src/index'

it('loads published products using the requested category, search and limit', async () => {
  const find = vi.fn().mockResolvedValueOnce({ docs: [{ id: 4 }] }).mockResolvedValueOnce({ docs: [{ id: 9 }] }).mockResolvedValueOnce({ docs: [{ id: 4 }] })
  const list = (commerce as any).getProductList
  expect(typeof list).toBe('function')
  const result = await list({ find }, { category: 'books', q: 'test', limit: 100 })
  expect(find.mock.calls[1]![0]).toMatchObject({ collection: 'products', limit: 100, where: { and: [{ _status: { equals: 'published' } }, { categories: { contains: 4 } }, { title: { like: 'test' } }] } })
  expect(result).toEqual({ docs: [{ id: 9 }], categories: [{ id: 4 }] })
})
