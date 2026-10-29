import { Link, Text } from '@react-email/components'
import React, { type ReactNode } from 'react'
import type { MailTheme } from '@daugtcom/payload-mail'

type Node = { type?: string; text?: string; format?: number; children?: Node[]; listType?: string; fields?: { url?: string }; url?: string }

/** The small part of Lexical a newsletter allows (paragraphs, bold, italic, links, lists) as email-safe elements. */
export function Lexical({ value, theme, size = 16 }: { value: unknown; theme: MailTheme; size?: number }): ReactNode {
  const k = theme.colors
  const body = theme.fonts?.body ?? "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
  const root = (value as { root?: Node } | null)?.root
  if (!root) return null

  const inline = (nodes: Node[] = []): ReactNode[] =>
    nodes.map((n, i) => {
      if (n.type === 'linebreak') return <br key={i} />
      if (n.type === 'link' || n.type === 'autolink') {
        const href = n.fields?.url ?? n.url ?? '#'
        return <Link key={i} href={href} style={{ color: k.primary, textDecoration: 'underline' }}>{inline(n.children)}</Link>
      }
      if (typeof n.text === 'string') {
        let el: ReactNode = n.text
        if ((n.format ?? 0) & 1) el = <strong key={`b${i}`}>{el}</strong>
        if ((n.format ?? 0) & 2) el = <em key={`i${i}`}>{el}</em>
        return <span key={i}>{el}</span>
      }
      return <span key={i}>{inline(n.children)}</span>
    })

  const p: React.CSSProperties = { margin: '0 0 16px', fontFamily: body, fontSize: size, lineHeight: 1.65, color: k.text }
  return (
    <>
      {(root.children ?? []).map((n, i) => {
        if (n.type === 'list') {
          const Tag = n.listType === 'number' ? 'ol' : 'ul'
          return (
            <Tag key={i} style={{ margin: '0 0 16px', paddingLeft: 22, fontFamily: body, fontSize: size, lineHeight: 1.65, color: k.text }}>
              {(n.children ?? []).map((li, j) => <li key={j} style={{ margin: '0 0 6px' }}>{inline(li.children)}</li>)}
            </Tag>
          )
        }
        return <Text key={i} style={p}>{inline(n.children)}</Text>
      })}
    </>
  )
}
