import { expect, it } from 'vitest'
import * as newsletter from '../src/index'

it('exports the compatible landing-page signup block', () => {
  expect((newsletter as any).newsletterSignupBlock).toMatchObject({ slug: 'newsletter', fields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'textarea' }] })
})
