import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('optional access integration', () => {
  it('does not load the access bridge from the commerce entry point', () => {
    const files = ['src/index.ts', 'src/plugin.ts', 'src/adapters/stripeCheckout/subscription.ts']
    for (const file of files) expect(readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')).not.toMatch(/from ['"].*access\/bridge['"]/)
  })
})
