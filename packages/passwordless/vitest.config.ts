import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], passWithNoTests: true, testTimeout: 30000, hookTimeout: 90000 } })
