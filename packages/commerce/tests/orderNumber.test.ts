import { describe, expect, it } from 'vitest'
import { nextOrderNumber, FIRST_ORDER_NUMBER } from '../src/orders/orderNumber'

describe('nextOrderNumber', () => {
  it('starts at 1000 like the legacy app', () => {
    expect(FIRST_ORDER_NUMBER).toBe(1000)
    expect(nextOrderNumber({ setting: null, maxExisting: 0 })).toBe(1000)
  })
  it('continues after the highest existing number', () => {
    expect(nextOrderNumber({ setting: null, maxExisting: 10_303 })).toBe(10_304)
  })
  it('honours a higher configured next number, never one that is already taken', () => {
    expect(nextOrderNumber({ setting: 20_000, maxExisting: 10_303 })).toBe(20_000)
    expect(nextOrderNumber({ setting: 500, maxExisting: 10_303 })).toBe(10_304)
  })
})
