import { Body, Button, Column, Container, Head, Heading, Html, Img, Link, Preview, Row, Section, Text } from '@react-email/components'
import React, { Fragment, type ReactNode } from 'react'
import type { MailContent, MailTheme } from './index'

const displayFont = (t: MailTheme) => t.fonts?.display ?? "Georgia, 'Times New Roman', serif"
const bodyFont = (t: MailTheme) => t.fonts?.body ?? "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

/** Common email-safe frame for transactional messages and editor-built newsletters. */
export function MailShell({ theme, title, preheader, children, footer, width = 560 }: { theme: MailTheme; title: string; preheader?: string; children?: ReactNode; footer?: ReactNode; width?: number }) {
  const k = theme.colors
  return <Html lang="de"><Head><meta name="color-scheme" content="light" /><title>{title}</title></Head>
    {preheader && <Preview>{preheader}</Preview>}
    <Body style={{ margin: 0, padding: 0, background: k.background, fontFamily: bodyFont(theme) }}>
      <Container style={{ maxWidth: width, margin: '0 auto', padding: '32px 16px' }}>
        <Section style={{ padding: '0 8px 20px' }}><Row>
          {theme.logoUrl && <Column width={56} style={{ verticalAlign: 'middle' }}><Img src={theme.logoUrl} alt="" height={44} style={{ display: 'block', height: 44, width: 'auto' }} /></Column>}
          {(!theme.logoUrl || !theme.logoOnly) && <Column style={{ verticalAlign: 'middle' }}><Text style={{ margin: 0, fontFamily: displayFont(theme), fontSize: 24, lineHeight: 1, color: k.heading, letterSpacing: '-0.01em' }}>{theme.siteName}</Text></Column>}
        </Row></Section>
        <Section style={{ background: k.card ?? '#ffffff', border: `1px solid ${k.border}`, borderRadius: 20, padding: '36px 34px' }}>{children}</Section>
        <Section style={{ padding: '22px 8px 0', fontSize: 12, lineHeight: 1.6, color: k.muted, textAlign: 'center' }}>{footer}</Section>
      </Container>
    </Body></Html>
}

export function MailButton({ theme, href, children }: { theme: MailTheme; href: string; children?: ReactNode }) {
  return <Button href={href} style={{ background: theme.colors.primary, color: theme.colors.onPrimary ?? '#ffffff', borderRadius: 999, padding: '14px 30px', fontFamily: bodyFont(theme), fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>{children}</Button>
}

/** Supports the existing **bold** and newline notation without interpreting HTML. */
function Inline({ value }: { value: string }) {
  return <>{value.split(/(\*\*[^*]+\*\*|\n)/g).map((part, i) => part === '\n' ? <br key={i} /> : part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</>
}

export function TransactionalMail({ theme, content: c }: { theme: MailTheme; content: MailContent }) {
  const k = theme.colors
  const paragraph = (s: string, small = false) => <Text style={{ margin: `0 0 ${small ? 10 : 16}px`, fontSize: small ? 14 : 16, lineHeight: 1.65, color: small ? k.muted : k.text }}><Inline value={s} /></Text>
  const footer = <>{[...(theme.footer ?? []), ...(theme.baseUrl ? [theme.baseUrl.replace(/^https?:\/\//, '')] : [])].map((line, i) => <span key={i}>{line}<br /></span>)}{c.footerLinks?.length ? <p style={{ margin: '10px 0 0' }}>{c.footerLinks.map((link, i) => <span key={i}>{i > 0 && ' · '}<Link href={link.href} style={{ color: k.muted, textDecoration: 'underline' }}>{link.label}</Link></span>)}</p> : null}</>
  return <MailShell theme={theme} title={c.heading} preheader={c.preheader} footer={footer}>
    {c.eyebrow && <Text style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: k.primary }}>{c.eyebrow}</Text>}
    <Heading as="h1" style={{ margin: '0 0 20px', fontFamily: displayFont(theme), fontWeight: 400, fontSize: 30, lineHeight: 1.15, color: k.heading }}><Inline value={c.heading} /></Heading>
    {(c.paragraphs ?? []).map((s, i) => <Fragment key={i}>{paragraph(s)}</Fragment>)}
    {!!c.facts?.length && <Section style={{ margin: '24px 0', background: k.tint, borderRadius: 14, padding: '18px 22px' }}>{c.facts.map((f, i) => <div key={i} style={{ marginTop: i ? 12 : 0 }}><Text style={{ margin: 0, fontSize: 12, color: k.muted }}>{f.label}</Text><Text style={{ margin: 0, fontSize: 16, color: k.heading, fontWeight: 600 }}><Inline value={f.value} /></Text></div>)}</Section>}
    {c.button && <Section style={{ margin: '28px 0 8px' }}><MailButton theme={theme} href={c.button.href}>{c.button.label}</MailButton></Section>}
    {!!c.note?.length && <Section style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${k.border}` }}>{c.note.map((s, i) => <Fragment key={i}>{paragraph(s, true)}</Fragment>)}</Section>}
    {c.signoff && <Text style={{ margin: '22px 0 0', fontSize: 16, lineHeight: 1.6, color: k.text }}><Inline value={c.signoff} /></Text>}
  </MailShell>
}
