/** Tiny fetch helper for the plugin endpoints. Cookies travel with the request (same origin). */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    credentials: 'include',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}

/** Presentation only: open the cart drawer after an item is added. Payload owns cart state. */
export const CART_EVENT = 'site:cart'
export const notifyCart = () => window.dispatchEvent(new Event(CART_EVENT))
