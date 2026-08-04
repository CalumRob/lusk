import { cpSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'

// Vite 7 + Vitest 4 share this config. The `test` block wires Vitest:
// happy-dom (no browser), unit specs under src/.
// Deploy note (docs/self-hosting.md): nginx serves dist/ at the site root
// with `try_files $uri /index.html` — so the SPA uses the default base '/'
// and createWebHistory (client-side history routing, server-side fallback).

// The published payload lives at the repo root (public/data/ — ADR-0004) and
// nginx aliases /data/ to it in production. In dev and in `vite preview` there
// is no nginx, so the /data/ fetch (the loader's default baseUrl) 404s. This
// middleware serves the same files from the same path — the app's /data/ fetch
// stays honest locally, and a missing file is a real 404 (the loader's
// « 404 = theme absent » contract, mirroring the Vercel /data/ passthrough).
const racinePayload = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/data')

async function servirPayloadMiddleware(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  suivant: Connect.NextFunction,
): Promise<void> {
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
}

function servirPayloadEnDev(): Plugin {
  return {
    name: 'servir-payload-dev',
    configureServer(serveur) {
      serveur.middlewares.use(servirPayloadMiddleware)
    },
    configurePreviewServer(serveur) {
      serveur.middlewares.use(servirPayloadMiddleware)
    },
  }
}

// Vercel (ADR-0010): /data/ must live in the build output — a per-deploy
// snapshot of public/data, the Vercel-side equivalent of the Pi's nginx alias.
function copierPayloadEnBuild(): Plugin {
  return {
    name: 'copier-payload-build',
    closeBundle() {
      const cibleData = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist', 'data')
      if (!existsSync(racinePayload)) {
        console.warn('[copier-payload-build] payload introuvable — rien à copier dans dist/data')
        return
      }
      cpSync(racinePayload, cibleData, { recursive: true })
      console.log('[copier-payload-build] payload copié dans dist/data')
    },
  }
}

export default defineConfig({
  plugins: [vue(), servirPayloadEnDev(), copierPayloadEnBuild()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
  },
})
