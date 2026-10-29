import type { Payload } from 'payload'

type Doc = Record<string, any> & { id: string | number }

/** Published shop products and categories for a themed storefront. */
export async function getProductList(payload: Payload, o: { category?: string | null; q?: string | null; limit?: number } = {}) {
  const cat = o.category ? ((await payload.find({ collection: 'shopCategories' as never, where: { slug: { equals: o.category } }, limit: 1, depth: 0 })).docs[0] as Doc | undefined) : undefined
  const res = await payload.find({
    collection: 'products' as never,
    where: { and: [{ _status: { equals: 'published' } }, ...(cat ? [{ categories: { contains: cat.id } }] : []), ...(o.q ? [{ title: { like: o.q } }] : [])] } as never,
    sort: 'title', limit: o.limit ?? 0, ...(o.limit === undefined ? { pagination: false } : {}), depth: 1, overrideAccess: true,
  })
  const categories = (await payload.find({ collection: 'shopCategories' as never, limit: 0, pagination: false, depth: 0, sort: 'title' })).docs as unknown as Doc[]
  return { docs: res.docs as unknown as Doc[], categories }
}
