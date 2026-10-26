import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['scripts/copy-payload-build.spec.ts'], environment: 'node' },
})
