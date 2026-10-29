/** Tiny fetch helper for the plugin endpoints. Cookies travel with the request (same origin). */
export async function api<T = any>(path: string, init: { body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(init.body ?? {}),
  })
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}
