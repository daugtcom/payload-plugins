/**
 * Comments are small rich texts: paragraphs, line breaks, bold / italic / strikethrough and bullet / numbered lists.
 * Whatever a client sends is rebuilt from this allow-list, so a comment can never carry links, scripts, uploads or unknown nodes.
 */
type Json = Record<string, unknown>

export const MAX_COMMENT_CHARS = 10_000
const MAX_NODES = 800
const MAX_DEPTH = 5
/** Lexical text format bits: 1 bold, 2 italic, 4 strikethrough. */
const ALLOWED_FORMAT = 1 | 2 | 4

const text = (value: string, format = 0): Json => ({ type: 'text', version: 1, text: value, format, detail: 0, mode: 'normal', style: '' })
const paragraph = (children: Json[]): Json => ({ type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr', textFormat: 0, textStyle: '', children })

/** Plain text -> a minimal Lexical state (one paragraph per line). A Lexical state passes through. */
export function toLexicalState(value: unknown): unknown {
  if (value && typeof value === 'object') return value
  const lines = String(value ?? '').split(/\r?\n/)
  return { root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: lines.map((line) => paragraph(line ? [text(line)] : [])) } }
}

/** True when a Lexical state contains no visible text. */
export function isEmptyState(state: unknown): boolean {
  let found = false
  const walk = (n: unknown) => {
    if (found || !n || typeof n !== 'object') return
    const node = n as { type?: string; text?: string; children?: unknown[]; root?: unknown }
    if (node.root) return walk(node.root)
    if (node.type === 'text' && (node.text ?? '').trim()) found = true
    for (const c of node.children ?? []) walk(c)
  }
  walk(state)
  return !found
}

/**
 * Rebuilds a state from the allow-list. Plain strings become paragraphs. Returns `null` when nothing visible is left or the
 * input is too large / too deep (callers answer 400).
 */
export function sanitizeCommentText(input: unknown): Json | null {
  const source = typeof input === 'string' ? toLexicalState(input) : input
  const root = (source as { root?: { children?: unknown[] } } | null)?.root
  if (!root || !Array.isArray(root.children)) return null

  let nodes = 0
  let chars = 0
  let tooBig = false

  const inline = (n: unknown): Json[] => {
    if (!n || typeof n !== 'object') return []
    const node = n as { type?: string; text?: unknown; format?: unknown }
    if (++nodes > MAX_NODES) { tooBig = true; return [] }
    if (node.type === 'linebreak') return [{ type: 'linebreak', version: 1 }]
    if (node.type === 'text' && typeof node.text === 'string' && node.text) {
      chars += node.text.length
      if (chars > MAX_COMMENT_CHARS) { tooBig = true; return [] }
      const format = typeof node.format === 'number' ? node.format & ALLOWED_FORMAT : 0
      return [text(node.text, format)]
    }
    return []
  }

  const list = (n: { listType?: unknown; children?: unknown[] }, depth: number): Json | null => {
    if (depth > MAX_DEPTH) { tooBig = true; return null }
    const ordered = n.listType === 'number'
    const items: Json[] = []
    for (const li of n.children ?? []) {
      const item = li as { type?: string; children?: unknown[] }
      if (item?.type !== 'listitem' || ++nodes > MAX_NODES) continue
      const children: Json[] = []
      for (const c of item.children ?? []) {
        const child = c as { type?: string; listType?: unknown; children?: unknown[] }
        if (child?.type === 'list') { const nested = list(child, depth + 1); if (nested) children.push(nested) } else children.push(...inline(c))
      }
      items.push({ type: 'listitem', version: 1, value: items.length + 1, format: '', indent: 0, direction: 'ltr', children })
    }
    if (!items.length) return null
    return { type: 'list', version: 1, listType: ordered ? 'number' : 'bullet', tag: ordered ? 'ol' : 'ul', start: 1, format: '', indent: 0, direction: 'ltr', children: items }
  }

  const blocks: Json[] = []
  for (const b of root.children) {
    if (!b || typeof b !== 'object') continue
    const block = b as { type?: string; children?: unknown[]; listType?: unknown }
    if (++nodes > MAX_NODES) { tooBig = true; break }
    if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote') blocks.push(paragraph((block.children ?? []).flatMap(inline)))
    else if (block.type === 'list') { const l = list(block, 1); if (l) blocks.push(l) }
  }
  if (tooBig) return null
  const state = { root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: blocks } }
  return isEmptyState(state) ? null : state
}
