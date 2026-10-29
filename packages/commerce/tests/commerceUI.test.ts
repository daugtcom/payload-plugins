// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCart } from '@payloadcms/plugin-ecommerce/client/react'
import { CommerceProvider, useCommerceSession } from '../src/ui/CommerceProvider'
import { ConfirmOrder } from '../src/ui/ConfirmOrder'
import { CartButton, AddToCartButton } from '../src/ui/Cart'

vi.mock('next/navigation', () => ({ usePathname: () => '/shop' }))

let root: Root, host: HTMLDivElement, active: number | null, owner: number
let carts: Record<number, { id: number; items: { id: string; product: number | { id: number; title: string; slug: string; priceInEUR: number }; quantity: number }[]; subtotal: number; purchasedAt?: string }>
let requests: { path: string; body?: any }[]
function Probe() {
  const { cart, addItem, removeItem, refreshCart } = useCart()
  const { ready, logout, restore } = useCommerceSession()
  return h('div', {}, h('output', {}, JSON.stringify({ ready, cart: cart ?? null })),
    h('button', { id: 'add', onClick: () => addItem({ product: 9 }) }, 'Add'),
    h('button', { id: 'remove', onClick: () => removeItem('row-1') }, 'Remove'),
    h('button', { id: 'logout', onClick: logout }, 'Logout'),
    h('button', { id: 'restore', onClick: () => restore() }, 'Restore'),
    h('button', { id: 'refresh', onClick: () => refreshCart() }, 'Refresh'))
}
const state = () => JSON.parse(host.querySelector('output')!.textContent!)
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) }) }
async function render(userID: number, confirm = false) {
  await act(async () => root.render(h(CommerceProvider, { userID, children: [h(Probe, { key: 'probe' }), confirm && h(ConfirmOrder, { key: 'confirm' })] })))
  await settle()
}
async function click(id: string) { await act(async () => (host.querySelector(`#${id}`) as HTMLButtonElement).click()); await settle() }
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  owner = 10; active = 1; requests = []
  carts = { 1: { id: 1, items: [{ id: 'row-1', product: 9, quantity: 1 }], subtotal: 4900 }, 2: { id: 2, items: [], subtotal: 0 } }
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) })
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ path, body })
    let result: unknown
    if (path === '/api/users/me') result = { user: { id: owner, cart: { docs: active ? [active] : [] } } }
    else if (path === '/api/addresses') result = { docs: [] }
    else if (path.endsWith('/confirm-order')) result = { orderID: 20 }
    else if (path.endsWith('/add-item')) { carts[active!]!.items[0]!.quantity++; carts[active!]!.subtotal += 4900; result = { success: true } }
    else if (path.endsWith('/remove-item')) { carts[active!]!.items = []; carts[active!]!.subtotal = 0; result = { success: true } }
    else if (/\/carts\/\d+$/.test(path)) result = carts[Number(path.split('/').pop())]
    else throw new Error(`Unexpected fetch: ${path}`)
    return new Response(JSON.stringify(result), { status: 200 })
  }))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('restores server cart and uses native mutation endpoints, row IDs and subtotal', async () => {
  localStorage.setItem('cart', '99'); await render(10)
  expect(state().cart.id).toBe(1); expect(state().ready).toBe(true)
  expect(requests.some((r) => r.path.includes('/99'))).toBe(false)
  await click('add'); expect(state().cart.subtotal).toBe(9800)
  expect(requests.find((r) => r.path.endsWith('/add-item'))?.body).toMatchObject({ item: { product: 9 }, quantity: 1 })
  await click('remove'); expect(state().cart.subtotal).toBe(0)
  expect(requests.find((r) => r.path.endsWith('/remove-item'))?.body).toMatchObject({ itemID: 'row-1' })
})
it('clears logout state and restores a different member on login', async () => {
  await render(10); await click('logout'); expect(state().cart).toBeNull()
  owner = 11; active = 2; await render(11); expect(state().cart.id).toBe(2)
})
it('resets purchased references without editing the order cart', async () => {
  await render(10); carts[1]!.purchasedAt = new Date().toISOString(); active = null
  await click('refresh'); expect(state().cart).toBeNull(); expect(carts[1]!.items).toHaveLength(1)
  expect(requests.some((r) => r.path.endsWith('/clear'))).toBe(false)
})
it('confirms delayed return with session identity independently of a different active cart', async () => {
  active = 2; window.history.replaceState({}, '', '/checkout/success?session_id=cs_original')
  await render(10, true)
  expect(requests.find((r) => r.path.endsWith('/confirm-order'))?.body).toEqual({ sessionID: 'cs_original' })
  expect(state().cart.id).toBe(2); expect(carts[1]!.items).toHaveLength(1)
})
it('confirms a successful return when no active cart remains', async () => {
  active = null; window.history.replaceState({}, '', '/checkout/success?session_id=cs_original')
  await render(10, true)
  expect(requests.find((r) => r.path.endsWith('/confirm-order'))?.body).toEqual({ sessionID: 'cs_original' })
  expect(state().cart).toBeNull(); expect(carts[1]!.items).toHaveLength(1)
})

it('restores the current server cart on window focus after another tab completes checkout', async () => {
  await render(10)
  active = 2
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await settle()
  expect(state().cart.id).toBe(2)
  expect(carts[1]!.items).toHaveLength(1)
})

it('renders native subtotal and preserves external and member login links', async () => {
  carts[1]!.items[0]!.product = { id: 9, title: 'Membership', slug: 'membership', priceInEUR: 4900 }
  await act(async () => root.render(h(CommerceProvider, { userID: 10, children: [
    h(CartButton, { key: 'cart', loggedIn: true, children: 'Open cart' }),
    h(AddToCartButton, { key: 'external', productID: 8, loggedIn: false, external: 'https://example.org/buy', label: 'External' }),
    h(AddToCartButton, { key: 'member', productID: 9, loggedIn: false, label: 'Join' }),
  ] })))
  await settle()
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
  expect(host.textContent).toContain('Membership')
  expect(host.textContent).toContain('49,00')
  expect(host.querySelector('a[href="https://example.org/buy"]')?.getAttribute('target')).toBe('_blank')
  expect(host.querySelector('a[href="/login?redirect=%2Fshop"]')?.textContent).toBe('Join')
})

it.each([400, 401, 'network'] as const)('does not open the drawer or report success after rejected native add (%s)', async (failure) => {
  const nativeFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/add-item')) {
      if (failure === 'network') throw new TypeError('Network unavailable')
      return new Response(JSON.stringify({ error: 'rejected' }), { status: failure })
    }
    return nativeFetch(input, init)
  }))
  const opened = vi.fn()
  window.addEventListener('site:cart', opened)
  try {
    await act(async () => root.render(h(CommerceProvider, { userID: 10, children: [
      h(Probe, { key: 'probe' }), h(AddToCartButton, { key: 'buy', productID: 9, loggedIn: true, label: 'Buy' }),
    ] })))
    await settle()
    const buy = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Buy')!
    await act(async () => buy.click()); await settle()
    expect(opened).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('nicht aktualisiert')
    expect(state().cart.subtotal).toBe(4900)
    expect(buy.disabled).toBe(false)
  } finally { window.removeEventListener('site:cart', opened) }
})

it('opens the drawer only after a successful native add has refreshed provider state', async () => {
  const opened = vi.fn()
  window.addEventListener('site:cart', opened)
  try {
    await act(async () => root.render(h(CommerceProvider, { userID: 10, children: [
      h(Probe, { key: 'probe' }), h(AddToCartButton, { key: 'buy', productID: 9, loggedIn: true, label: 'Buy' }),
    ] })))
    await settle()
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Buy')!.click())
    await settle()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(state().cart.subtotal).toBe(9800)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  } finally { window.removeEventListener('site:cart', opened) }
})

it('shows failed native removal and keeps the provider cart intact', async () => {
  carts[1]!.items[0]!.product = { id: 9, title: 'Membership', slug: 'membership', priceInEUR: 4900 }
  const nativeFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/remove-item')
    ? new Response(JSON.stringify({ error: 'rejected' }), { status: 400 })
    : nativeFetch(input, init)))
  await act(async () => root.render(h(CommerceProvider, { userID: 10, children: [h(Probe, { key: 'probe' }), h(CartButton, { key: 'cart', loggedIn: true, children: 'Open cart' })] })))
  await settle()
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Open cart1')!.click())
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Entfernen')!.click())
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('nicht aktualisiert')
  expect(state().cart.items).toHaveLength(1)
  expect(state().cart.subtotal).toBe(4900)
})
