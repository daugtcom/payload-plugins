/** Cart rules of the old shop, as a pure function over the cart lines. */

export interface CartLine {
  product: string | number
  quantity: number
  [key: string]: unknown
}

export interface ProductRule {
  recurring: boolean
  multi: boolean
}

/**
 * - Only one subscription at a time: adding a second replaces the first (the newest line wins).
 * - A product that is not "multi" can only be bought once: quantity is capped at 1.
 */
export function applyCartRules(lines: readonly CartLine[], rules: ReadonlyMap<string, ProductRule>): CartLine[] {
  const recurringIdx = lines.map((l, i) => (rules.get(String(l.product))?.recurring ? i : -1)).filter((i) => i >= 0)
  const newestSubscription = recurringIdx.at(-1)
  return lines
    .filter((_, i) => !recurringIdx.includes(i) || i === newestSubscription)
    .map((l) => (rules.get(String(l.product))?.multi ? l : { ...l, quantity: Math.min(1, l.quantity) }))
}
