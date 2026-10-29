import { describe, expect, it } from 'vitest'
import { calculateShippingCents, isCountryAllowed, toIso2, type ShippingSettings } from '../src/shipping/calculator'

const settings = (over: Partial<ShippingSettings> = {}): ShippingSettings => ({
  mode: 'dynamic',
  flatRate: 5,
  method: 'sum',
  allowedCountries: [],
  ...over,
})

const small = { rates: [{ country: 'AT', amount: 4 }, { country: 'DE', amount: 6 }], fallbackRate: 12 }
const big = { rates: [{ country: 'AT', amount: 9 }], fallbackRate: null }

describe('toIso2', () => {
  it('passes ISO codes through and maps common names', () => {
    expect(toIso2('at')).toBe('AT')
    expect(toIso2('Österreich')).toBe('AT')
    expect(toIso2('Germany')).toBe('DE')
    expect(toIso2('Deutschland')).toBe('DE')
    expect(toIso2(null)).toBe('')
  })
})

describe('calculateShippingCents', () => {
  it('returns null when nothing needs shipping', () => {
    expect(calculateShippingCents('AT', [{ quantity: 1, requiresShipping: false }], settings())).toBeNull()
    expect(calculateShippingCents('AT', [], settings())).toBeNull()
  })

  it('uses the size rate for the destination country', () => {
    expect(calculateShippingCents('AT', [{ quantity: 1, requiresShipping: true, size: small }], settings())).toBe(400)
    expect(calculateShippingCents('DE', [{ quantity: 1, requiresShipping: true, size: small }], settings())).toBe(600)
  })

  it('falls back to the size fallback, then to the flat rate', () => {
    expect(calculateShippingCents('FR', [{ quantity: 1, requiresShipping: true, size: small }], settings())).toBe(1200)
    expect(calculateShippingCents('FR', [{ quantity: 1, requiresShipping: true, size: big }], settings())).toBe(500)
  })

  it('sum multiplies by quantity and adds up; max takes the highest single rate', () => {
    const lines = [
      { quantity: 2, requiresShipping: true, size: small },
      { quantity: 1, requiresShipping: true, size: big },
    ]
    expect(calculateShippingCents('AT', lines, settings())).toBe(400 * 2 + 900)
    expect(calculateShippingCents('AT', lines, settings({ method: 'max' }))).toBe(900)
  })

  it('flat mode ignores sizes', () => {
    expect(calculateShippingCents('AT', [{ quantity: 3, requiresShipping: true, size: small }], settings({ mode: 'flat' }))).toBe(1500)
  })

  it('is null (cannot ship) when no rate applies at all', () => {
    expect(calculateShippingCents('FR', [{ quantity: 1, requiresShipping: true, size: big }], settings({ flatRate: null }))).toBeNull()
  })

  it('treats a quantity below 1 as 1', () => {
    expect(calculateShippingCents('AT', [{ quantity: 0, requiresShipping: true, size: small }], settings())).toBe(400)
  })
})

describe('isCountryAllowed', () => {
  it('allows everything when no list is configured', () => {
    expect(isCountryAllowed('FR', settings())).toBe(true)
    expect(isCountryAllowed('FR', settings({ allowedCountries: ['AT', 'DE'] }))).toBe(false)
    expect(isCountryAllowed('de', settings({ allowedCountries: ['AT', 'DE'] }))).toBe(true)
  })
})
