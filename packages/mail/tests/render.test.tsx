import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MailShell, mailLayout, renderMail, type MailTheme } from '../src'

const theme: MailTheme = { siteName: 'Example', baseUrl: 'https://example.test', colors: { primary: '#a12345', heading: '#123456', text: '#333333', muted: '#777777', background: '#eeeeee', border: '#cccccc', tint: '#dddddd' } }

describe('shared mail rendering', () => {
  it('renders transactional content safely with a themed React Email shell and a useful text alternative', async () => {
    const m = await renderMail(theme, { preheader: 'Preview', heading: 'Hello <reader>', paragraphs: ['Welcome **friend**'], facts: [{ label: 'Code', value: '**123456**' }], button: { label: 'Sign in', href: 'https://example.test/login?x=1&y=2' }, footerLinks: [{ label: 'Unsubscribe', href: 'https://example.test/stop' }] })
    expect(m.html).toContain('Hello &lt;reader&gt;')
    expect(m.html).toContain('<strong>friend</strong>')
    expect(m.html).toContain('#a12345')
    expect(m.html).toContain('https://example.test/login?x=1&amp;y=2')
    expect(m.text).toContain('Code: 123456')
    expect(m.text).toContain('Sign in: https://example.test/login?x=1&y=2')
    expect((await mailLayout(theme)({ heading: 'Hello' })).html).toContain('Example')
  })
  it('offers the same shell to block-based mail with a custom footer', () => {
    const html = renderToStaticMarkup(createElement(MailShell, { theme, title: 'News', footer: createElement('p', null, 'Unsubscribe') }, createElement('p', null, 'Block content')))
    expect(html).toContain('Example')
    expect(html).toContain('Block content')
    expect(html).toContain('Unsubscribe')
  })
})

it('renders editor content to both HTML and text through the shared renderer', async () => {
  const mail = await (await import('../src')).renderEmail(createElement(MailShell, { theme, title: 'News' }, createElement('p', null, 'A newsletter block')))
  expect(mail.html).toContain('A newsletter block')
  expect(mail.text).toContain('A newsletter block')
})
