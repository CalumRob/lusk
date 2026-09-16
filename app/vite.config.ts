import { cpSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { territoryModelBuffer } from './scripts/territory-model-dev'

// Vite 7 + Vitest 4 share this config. The `test` block wires Vitest:
// happy-dom (no browser), unit specs under src/.
// Deploy note (docs/self-hosting.md): nginx serves dist/ at the site root
// with `try_files $uri /index.html` — so the SPA uses the default base '/'
// and createWebHistory (client-side history routing, server-side fallback).

// The published payload lives at the repo root (public/data/ — ADR-0004) and
// nginx aliases /data/ to it in production. In dev and in `vite preview` there
// is no nginx, so the /data/ fetch (the loader's default baseUrl) 404s. This
// middleware serves the same files from the same path. Territory read models
// are projected in memory on a dev-cache miss from those published JSONs: the
// first fiche pays one source parse, later fiches reuse it. Nothing is written
// and neither `npm run dev` nor `npm run build` regenerates the pipeline.
const racinePayload = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/data')
async function materialiserModeleTerritoire(relatif: string): Promise<Buffer | null> {
  const match = relatif.match(
    /^modeles-lecture\/territoires\/(commune|epci|departement|region)\/([a-z0-9_-]+)\.json$/,
  )
  if (!match) return null
  const debut = performance.now()
  const buffer = await territoryModelBuffer(racinePayload, match[1]!, match[2]!)
  if (buffer) {
    console.log(`[read-models] modèle ${match[2]} projeté en ${((performance.now() - debut) / 1000).toFixed(2)} s`)
  }
  return buffer
}

async function servirPayloadMiddleware(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  suivant: Connect.NextFunction,
  genererModeleManquant = false,
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
    let contenu: Buffer
    let origine = 'published-file'
    try {
      contenu = await readFile(chemin)
    } catch (cause) {
      if (!genererModeleManquant) throw cause
      const genere = await materialiserModeleTerritoire(relatif)
      if (!genere) throw cause
      contenu = genere
      origine = 'memory-dev-projection'
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Length', contenu.byteLength)
    res.setHeader('X-Lusk-Read-Model-Source', origine)
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
      serveur.middlewares.use((req, res, next) => {
        void servirPayloadMiddleware(req, res, next, true)
      })
    },
    configurePreviewServer(serveur) {
      serveur.middlewares.use((req, res, next) => {
        void servirPayloadMiddleware(req, res, next, false)
      })
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
