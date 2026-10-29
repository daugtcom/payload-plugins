import type { Payload } from 'payload'
import { getAccess } from '../plugin'
import type { AccessUser } from './types'

export interface ItemAccess {
  canView: boolean
  canComment: boolean
  canReact: boolean
}

/** What the member may do with one lesson, post or section. Decided by the collection policies of the plugin. */
export async function getItemAccess(payload: Payload, user: AccessUser | null, target: { relationTo: string; value: number | string }): Promise<ItemAccess> {
  const access = getAccess(payload)
  const [canView, canComment, canReact] = await Promise.all([access.can('view', user, target), access.can('comment', user, target), access.can('react', user, target)])
  return { canView, canComment, canReact }
}
