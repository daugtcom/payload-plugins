import config from '@payload-config'
import { getPayload } from 'payload'

/** Dev only: put one product in a fresh cart for the logged-in member and start hosted Checkout. */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return new Response('Log in at /admin first', { status: 401 })

  const form = await request.formData()
  const productID = Number(form.get('productID'))
  const country = (form.get('country') as string | null) || undefined

  const cart = await payload.create({ collection: 'carts', data: { customer: user.id, currency: 'EUR', items: [{ product: productID, quantity: 1 }] } as never, overrideAccess: true })

  const res = await fetch(`${new URL(request.url).origin}/api/payments/stripe-checkout/initiate`, {
    method: 'POST',
    // Payload only trusts the cookie for same-origin requests, so forward what the browser sent
    headers: { 'content-type': 'application/json', cookie: request.headers.get('cookie') ?? '', origin: new URL(request.url).origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ cartID: cart.id, billingAddress: { country: country ?? 'AT' }, ...(country ? { shippingAddress: { country } } : {}) }),
  })
  const json = (await res.json()) as { url?: string; message?: string }
  if (!res.ok || !json.url) return new Response(`Could not start checkout: ${json.message ?? res.status}`, { status: 502 })

  const headers = new Headers({ Location: json.url })
  headers.append('Set-Cookie', `dev-cart=${cart.id}; Path=/; Max-Age=3600; SameSite=Lax`)
  return new Response(null, { status: 303, headers })
}
