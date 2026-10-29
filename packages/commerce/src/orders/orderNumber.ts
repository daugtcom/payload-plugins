export const FIRST_ORDER_NUMBER = 1000

/**
 * The next order number: after the highest existing one, or the configured next number if that is higher.
 * Imported orders keep their legacy numbers, so the sequence continues behind them.
 */
export function nextOrderNumber(o: { setting: number | null | undefined; maxExisting: number }): number {
  const afterExisting = Math.max(o.maxExisting + 1, FIRST_ORDER_NUMBER)
  return o.setting && o.setting > afterExisting ? o.setting : afterExisting
}
