import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

// Vite 7 + Vitest 4 share this config. The `test` block wires Vitest:
// happy-dom (no browser), unit specs under src/.
// Deploy note (docs/self-hosting.md): nginx serves dist/ at the site root
// with `try_files $uri /index.html` — so the SPA uses the default base '/'
// and createWebHistory (client-side history routing, server-side fallback).

// The published payload lives at the repo root (public/data/ — ADR-0004) and
// nginx aliases /data/ to it in production. In dev there is no nginx, so the
// /data/ fetch (the loader's default baseUrl) 404s. This dev-only middleware
// serves the same files from the same path — the app's /data/ fetch stays
// honest in dev without shipping the payload into dist/.
const racinePayload = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/data')

function servirPayloadEnDev(): Plugin {
  return {
    name: 'servir-payload-dev',
    configureServer(serveur) {
      serveur.middlewares.use(async (req, res, suivant) => {
        if (!req.url?.startsWith('/data/')) return suivant()
        const relatif = req.url.slice('/data/'.length)
        const chemin = path.resolve(racinePayload, relatif)
        if (!chemin.startsWith(racinePayload + path.sep)) {
          res.statusCode = 403
          res.end('Hors du répertoire /data')
          return
        }
        try {
          const contenu = await readFile(chemin)
          res.setHeader('Content-Type', 'application/json')
          res.end(contenu)
        } catch {
          res.statusCode = 404
          res.end('Payload introuvable')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), servirPayloadEnDev()],
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
