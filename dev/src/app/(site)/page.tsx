import config from '@payload-config'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

export default async function Shop() {
  const payload = await getPayload({ config })
  const products = await payload.find({ collection: 'products', limit: 50, depth: 0, sort: 'title' })
  return (
    <main>
      <h1>Dev shop</h1>
      <p>Log in at <a href="/admin">/admin</a> first (member@dev.test / dev-dev-dev-1), then buy. Stripe is in TEST mode.</p>
      <ul>
        {products.docs.map((p) => {
          const doc = p as unknown as { id: number; title: string; priceInEUR?: number; commerce?: { requiresShipping?: boolean } }
          return (
            <li key={doc.id} style={{ margin: '1rem 0' }}>
              <strong>{doc.title}</strong> — {((doc.priceInEUR ?? 0) / 100).toFixed(2)} €
              <form method="post" action="/dev/buy" style={{ display: 'inline', marginLeft: '1rem' }}>
                <input type="hidden" name="productID" value={doc.id} />
                {doc.commerce?.requiresShipping && <input name="country" defaultValue="AT" size={2} />}
                <button type="submit">Buy</button>
              </form>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
