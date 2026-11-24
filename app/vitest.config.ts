import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

// Test config, kept apart from the app config (vite.config.ts) so the app
// config carries no test-only concerns. `npm test` is the only automated suite:
// happy-dom, no browser process and no Playwright/Chromium import reachable.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      // PDF colour resolution consumes the real CSS owner as text. Vitest's
      // default CSS stub would otherwise turn even its ?raw import into ''.
      css: { include: [/tokens\.css/] },
      include: ['src/**/*.spec.ts'],
      exclude: [...configDefaults.exclude, '**/*.browser.spec.ts'],
      setupFiles: ['src/__tests__/setup.ts'],
    },
  }),
)
