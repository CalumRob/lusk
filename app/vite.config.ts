import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Vite 7 + Vitest 4 share this config. The `test` block wires Vitest:
// happy-dom (no browser), unit specs under src/.
// Deploy note (docs/self-hosting.md): nginx serves dist/ at the site root
// with `try_files $uri /index.html` — so the SPA uses the default base '/'
// and createWebHistory (client-side history routing, server-side fallback).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
  },
})
