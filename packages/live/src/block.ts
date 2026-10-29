import type { Block } from 'payload'

export const LIVE_CALL_BLOCK = 'liveCall'

/** The block editors add to a post (or any rich text) to put a live call into it. The call is gated by the access rules of that document. */
export const liveCallBlock: Block = {
  slug: LIVE_CALL_BLOCK,
  labels: { singular: 'Live-Call', plural: 'Live-Calls' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    { name: 'startsAt', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayAndTime', displayFormat: 'dd.MM.yyyy HH:mm' } } },
    { name: 'durationMinutes', type: 'number', defaultValue: 60, min: 5, max: 600, required: true },
    {
      name: 'allowSpeak',
      type: 'select',
      defaultValue: 'raise-hand',
      options: [
        { label: 'Alle dürfen sprechen', value: 'all' },
        { label: 'Nur Gastgeberin, Teilnehmende melden sich per Handzeichen', value: 'raise-hand' },
        { label: 'Nur Gastgeberin', value: 'host' },
      ],
    },
    { name: 'capacity', type: 'number', min: 2, admin: { description: 'Maximale Teilnehmerzahl; leer = keine Grenze.' } },
    { name: 'record', type: 'checkbox', defaultValue: false, label: 'Aufzeichnen', admin: { description: 'Nimmt den Call auf (nur wenn die Aufzeichnung eingerichtet ist). Alle im Raum sehen einen Hinweis.' } },
  ],
}

interface Node { type?: string; fields?: Record<string, any>; children?: Node[] }

/** Finds the `liveCall` block with this id in a Lexical document. */
export function findLiveCallBlock(body: unknown, blockId: string): Record<string, any> | null {
  const walk = (n: Node | undefined): Record<string, any> | null => {
    if (!n) return null
    if (n.type === 'block' && n.fields?.blockType === LIVE_CALL_BLOCK && String(n.fields.id) === blockId) return n.fields
    for (const c of n.children ?? []) {
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return walk((body as { root?: Node } | null | undefined)?.root)
}
