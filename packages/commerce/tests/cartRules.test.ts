import { describe, expect, it } from 'vitest'
import { applyCartRules, type ProductRule } from '../src/cart/rules'

const rules = new Map<string, ProductRule>([
  ['1', { recurring: false, multi: false }],
  ['2', { recurring: false, multi: true }],
  ['3', { recurring: true, multi: false }],
  ['4', { recurring: true, multi: false }],
])
const line = (product: number, quantity = 1) => ({ product, quantity })

describe('applyCartRules', () => {
  it('keeps a normal cart as it is', () => {
    expect(applyCartRules([line(1), line(2, 3)], rules)).toEqual([line(1), line(2, 3)])
  })
  it('a newly added subscription replaces the one already in the cart', () => {
    expect(applyCartRules([line(3), line(1), line(4)], rules)).toEqual([line(1), line(4)])
  })
  it('caps quantity at 1 unless the product is multi', () => {
    expect(applyCartRules([line(1, 5), line(2, 5)], rules)).toEqual([line(1, 1), line(2, 5)])
  })
  it('does not touch unknown products', () => {
    expect(applyCartRules([line(99, 2)], rules)).toEqual([line(99, 1)])
  })
})
