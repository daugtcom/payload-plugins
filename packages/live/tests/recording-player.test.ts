import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecordingPlayer } from '../src/ui/LiveRecordings'

describe('recording player', () => {
  it('uses the shared themed media player for a recording', () => {
    const markup = renderToStaticMarkup(createElement(RecordingPlayer, { sessionId: 42, egressId: 'abc' }))
    expect(markup).toContain('--plyr-color-main:var(--color-primary-600')
    expect(markup).toContain('<source src="/api/live/recording/42/abc"')
  })
})

it('renders audio with the same theme and native controls as a fallback', async () => {
  const { PlyrPlayer } = await import('@daugtcom/payload-media')
  const markup = renderToStaticMarkup(createElement(PlyrPlayer, { kind: 'audio', src: '/audio.mp3', noDownload: true }))
  expect(markup).toContain('--plyr-color-main:var(--color-primary-600')
  expect(markup).toContain('<audio controls=""')
  expect(markup).toContain('controlsList="nodownload"')
  expect(markup).toContain('<source src="/audio.mp3"')
})
