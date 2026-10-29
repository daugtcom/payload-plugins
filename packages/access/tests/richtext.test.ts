import { describe, expect, it } from 'vitest'
import { isEmptyState, MAX_COMMENT_CHARS, sanitizeCommentText } from '../src/richtext'

const para = (...children: unknown[]) => ({ type: 'paragraph', children })
const text = (t: string, format = 0) => ({ type: 'text', text: t, format })
const doc = (...children: unknown[]) => ({ root: { type: 'root', children } })

describe('sanitizeCommentText', () => {
  it('turns plain text into paragraphs, one per line', () => {
    const s = sanitizeCommentText('eins\nzwei') as any
    expect(s.root.children).toHaveLength(2)
    expect(s.root.children[1].children[0].text).toBe('zwei')
  })

  it('keeps bold, italic and strikethrough and drops every other format bit', () => {
    const s = sanitizeCommentText(doc(para(text('a', 1 | 2 | 4 | 8 | 16)))) as any
    expect(s.root.children[0].children[0].format).toBe(7)
  })

  it('keeps bullet and numbered lists, including a nested one, and renumbers the items', () => {
    const s = sanitizeCommentText(doc({ type: 'list', listType: 'number', children: [{ type: 'listitem', value: 9, children: [text('a'), { type: 'list', listType: 'bullet', children: [{ type: 'listitem', children: [text('b')] }] }] }, { type: 'listitem', value: 9, children: [text('c')] }] })) as any
    const list = s.root.children[0]
    expect(list).toMatchObject({ type: 'list', listType: 'number', tag: 'ol' })
    expect(list.children.map((i: any) => i.value)).toEqual([1, 2])
    expect(list.children[0].children[1]).toMatchObject({ type: 'list', listType: 'bullet', tag: 'ul' })
  })

  it('drops links, uploads, code and unknown nodes but keeps their neighbours', () => {
    const s = JSON.stringify(sanitizeCommentText(doc(para(text('hallo'), { type: 'link', url: 'javascript:alert(1)', children: [text('böse')] }, { type: 'autolink', children: [text('auch')] }), { type: 'code', children: [text('x')] }, { type: 'upload' })))
    expect(s).toContain('hallo')
    for (const bad of ['javascript', 'böse', 'auch', 'code', 'upload']) expect(s).not.toContain(bad)
  })

  it('keeps line breaks and turns headings and quotes into plain paragraphs', () => {
    const s = sanitizeCommentText(doc({ type: 'heading', tag: 'h1', children: [text('Titel')] }, para(text('a'), { type: 'linebreak' }, text('b')))) as any
    expect(s.root.children.map((c: any) => c.type)).toEqual(['paragraph', 'paragraph'])
    expect(s.root.children[1].children.map((c: any) => c.type)).toEqual(['text', 'linebreak', 'text'])
  })

  it('answers null for empty, whitespace-only, oversized, too deep or malformed input', () => {
    expect(sanitizeCommentText('')).toBeNull()
    expect(sanitizeCommentText('   \n  ')).toBeNull()
    expect(sanitizeCommentText(doc(para(text('   '))))).toBeNull()
    expect(sanitizeCommentText('x'.repeat(MAX_COMMENT_CHARS + 1))).toBeNull()
    expect(sanitizeCommentText({ root: 'nope' })).toBeNull()
    expect(sanitizeCommentText(null)).toBeNull()
    let deep: unknown = { type: 'list', listType: 'bullet', children: [{ type: 'listitem', children: [text('x')] }] }
    for (let i = 0; i < 8; i++) deep = { type: 'list', listType: 'bullet', children: [{ type: 'listitem', children: [deep] }] }
    expect(sanitizeCommentText(doc(deep))).toBeNull()
  })

  it('isEmptyState sees text anywhere', () => {
    expect(isEmptyState(doc(para()))).toBe(true)
    expect(isEmptyState(doc({ type: 'list', children: [{ type: 'listitem', children: [text('x')] }] }))).toBe(false)
  })
})
