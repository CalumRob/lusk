import { fileURLToPath } from 'node:url'

import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

// Test config, kept apart from the app config (vite.config.ts) so the app
// config carries no test-only concerns. Two projects:
//
//  - `unit` (default, `npm test`): happy-dom, no real browser, fast.
//  - `browser` (`npm run test:browser`): the specs that need a real layout
//    engine (*.browser.spec.ts). They share ONE headless Chromium and ONE Vite
//    bundle for the whole run (globalSetup). Never part of `npm test`.
const shared = {
  environment: 'happy-dom',
  // PDF colour resolution consumes the real CSS owner as text. Vitest's
  // default CSS stub would otherwise turn even its ?raw import into ''.
  css: { include: [/tokens\.css/] },
  setupFiles: ['src/__tests__/setup.ts'],
} as const

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            ...shared,
            name: 'unit',
            include: ['src/**/*.spec.ts'],
            exclude: ['**/node_modules/**', 'src/**/*.browser.spec.ts'],
          },
        },
        {
          extends: true,
          resolve: {
            // happy-dom has no layout for the DOM painter, so specs of this
            // project generate PDFs through the real browser harness instead
            // of the in-process composer. Listed first so it wins over '@'.
            alias: [{
              find: /^@\/fiche\/prototype\/cahierPdfComposer$/,
              replacement: fileURLToPath(new URL('./src/__tests__/helpers/cahierPdfComposerNative.ts', import.meta.url)),
            }],
          },
          test: {
            ...shared,
            name: 'browser',
            include: ['src/**/*.browser.spec.ts'],
            globalSetup: ['src/__tests__/browser/globalSetup.ts'],
            testTimeout: 120_000,
            hookTimeout: 120_000,
            // The browser is a shared, stateful resource: run files serially.
            fileParallelism: false,
          },
        },
      ],
    },
  }),
)
