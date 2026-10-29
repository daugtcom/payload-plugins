import { expect, it } from 'vitest'
import { defaultMailTheme } from '@daugtcom/payload-mail'
import { resolve } from '../src/plugin'

it('uses the site theme for built-in login and email-change templates', async () => {
  const theme = defaultMailTheme('Example School')
  const o = resolve({ mailTheme: theme } as never)
  expect((await o.renderEmail({ email: 'a@example.com', code: '123456', link: 'https://example.test', ttlMinutes: 10 })).html).toContain('Example School')
  expect((await o.renderEmailChange({ email: 'a@example.com', code: '123456', ttlMinutes: 10 })).html).toContain('Example School')
})
