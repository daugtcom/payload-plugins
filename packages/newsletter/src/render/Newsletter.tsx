import { Column, Heading, Hr, Img, Link, Row, Section, Text } from '@react-email/components'
import { MailButton, MailShell } from '@daugtcom/payload-mail'
import React, { type ReactNode } from 'react'
import type { MailTheme } from '@daugtcom/payload-mail'
import { Lexical } from './lexical'
import type { ResolvedBlock, ResolvedNewsletter } from './resolve'

/** In the HTML until each recipient's own link is put in. */
export const UNSUBSCRIBE_PLACEHOLDER = '%%UNSUBSCRIBE_URL%%'

const BlockView = ({ b, theme }: { b: ResolvedBlock; theme: MailTheme }): ReactNode => {
  const k = theme.colors
  const display = theme.fonts?.display ?? "Georgia, 'Times New Roman', serif"
  const body = theme.fonts?.body ?? "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
  const btn = (label: string, href: string) => <MailButton theme={theme} href={href}>{label}</MailButton>
  switch (b.type) {
    case 'heading': {
      const size = { h1: 32, h2: 26, h3: 20 }[b.level]
      return <Heading as={b.level} style={{ margin: '0 0 14px', fontFamily: display, fontWeight: 400, fontSize: size, lineHeight: 1.18, color: k.heading, textAlign: b.align }}>{b.text}</Heading>
    }
    case 'text': return <Lexical value={b.content} theme={theme} />
    case 'image': {
      const img = <Img src={b.src} alt={b.alt} width="100%" style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 14 }} />
      return (
        <Section style={{ margin: '4px 0 18px' }}>
          {b.href ? <Link href={b.href}>{img}</Link> : img}
          {b.caption && <Text style={{ margin: '8px 0 0', fontFamily: body, fontSize: 13, color: k.muted, textAlign: 'center' }}>{b.caption}</Text>}
        </Section>
      )
    }
    case 'button': return <Section style={{ margin: '6px 0 20px', textAlign: b.align }}>{btn(b.label, b.href)}</Section>
    case 'divider': return <Hr style={{ border: 0, borderTop: `1px solid ${k.border}`, margin: b.large ? '34px 0' : '22px 0' }} />
    case 'columns': {
      const image = <Column width="42%" style={{ verticalAlign: 'top', paddingRight: b.imageSide === 'left' ? 18 : 0, paddingLeft: b.imageSide === 'right' ? 18 : 0 }}><Img src={b.src} alt={b.alt} width="100%" style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12 }} /></Column>
      const text = (
        <Column style={{ verticalAlign: 'top' }}>
          {b.heading && <Heading as="h3" style={{ margin: '0 0 8px', fontFamily: display, fontWeight: 400, fontSize: 20, lineHeight: 1.2, color: k.heading }}>{b.heading}</Heading>}
          <Lexical value={b.content} theme={theme} size={15} />
          {b.buttonLabel && b.buttonHref && btn(b.buttonLabel, b.buttonHref)}
        </Column>
      )
      return <Section style={{ margin: '6px 0 22px' }}><Row>{b.imageSide === 'left' ? <>{image}{text}</> : <>{text}{image}</>}</Row></Section>
    }
    case 'teaser': return (
      <Section style={{ margin: '6px 0 22px', border: `1px solid ${k.border}`, borderRadius: 14, overflow: 'hidden' }}>
        {b.src && <Img src={b.src} alt="" width="100%" style={{ display: 'block', width: '100%', height: 'auto' }} />}
        <Section style={{ padding: '18px 20px 20px' }}>
          <Heading as="h3" style={{ margin: '0 0 8px', fontFamily: display, fontWeight: 400, fontSize: 22, lineHeight: 1.2, color: k.heading }}>{b.title}</Heading>
          {b.excerpt && <Text style={{ margin: '0 0 14px', fontFamily: body, fontSize: 15, lineHeight: 1.6, color: k.text }}>{b.excerpt}</Text>}
          {btn(b.label, b.href)}
        </Section>
      </Section>
    )
  }
}

/** The editor owns block composition; payload-mail supplies the common frame and controls. */
export function Newsletter({ theme, newsletter, postalAddress }: { theme: MailTheme; newsletter: ResolvedNewsletter; postalAddress: string[] }) {
  const k = theme.colors
  const body = theme.fonts?.body ?? "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
  const foot = { margin: 0, fontFamily: body, fontSize: 12, lineHeight: 1.7, color: k.muted, textAlign: 'center' as const }
  const footer = <>
    <Text style={foot}>Du erhältst diese E-Mail, weil du dich für den Newsletter angemeldet hast.</Text>
    <Text style={{ ...foot, marginTop: 6 }}><Link href={UNSUBSCRIBE_PLACEHOLDER} style={{ color: k.muted, textDecoration: 'underline' }}>Newsletter abbestellen</Link></Text>
    {postalAddress.length > 0 && <Text style={{ ...foot, marginTop: 14 }}>{postalAddress.map((l, i) => <span key={i}>{l}{i < postalAddress.length - 1 && <br />}</span>)}</Text>}
    {theme.baseUrl && <Text style={{ ...foot, marginTop: 6 }}><Link href={theme.baseUrl} style={{ color: k.muted, textDecoration: 'underline' }}>{theme.baseUrl.replace(/^https?:\/\//, '')}</Link></Text>}
  </>
  return <MailShell theme={theme} title={newsletter.subject} preheader={newsletter.preheader} footer={footer} width={600}>
    {newsletter.blocks.map((b, i) => <BlockView key={i} b={b} theme={theme} />)}
  </MailShell>
}
