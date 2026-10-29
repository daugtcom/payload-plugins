import type { EntitlementDoc } from './types'

type Handler = (entitlement: EntitlementDoc) => void | Promise<void>

/** Tiny in-process event bus so other plugins (commerce, notifications) can react without importing each other. */
export class AccessEvents {
  private handlers: Record<'granted' | 'revoked', Handler[]> = { granted: [], revoked: [] }

  on(event: 'granted' | 'revoked', handler: Handler): () => void {
    this.handlers[event].push(handler)
    return () => {
      this.handlers[event] = this.handlers[event].filter((h) => h !== handler)
    }
  }

  async emit(event: 'granted' | 'revoked', entitlement: EntitlementDoc): Promise<void> {
    for (const h of this.handlers[event]) await h(entitlement)
  }
}
