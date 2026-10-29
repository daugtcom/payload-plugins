import type { Config, Plugin } from 'payload'
import { liveSessions } from './collections/liveSessions'
import { liveEndpoints } from './endpoints'
import { resolve, type LivePluginOptions } from './options'

/**
 * Live calls: scheduled rooms on LiveKit, joined with a token the server only hands out after an access check.
 * Group calls come from a `liveCall` block in a document's rich text, direct calls from `getLive(payload).createDirectSession` (e.g. a booking).
 */
export const payloadLive =
  (options: LivePluginOptions): Plugin =>
  (incoming: Config): Config => {
    if (options.enabled === false) return incoming
    const o = resolve(options)
    return {
      ...incoming,
      collections: [...(incoming.collections ?? []), liveSessions(o)],
      endpoints: [...(incoming.endpoints ?? []), ...liveEndpoints(o)],
      custom: { ...incoming.custom, daugtLive: { options: o } },
    }
  }
