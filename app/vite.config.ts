import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { copierPayloadEnBuild } from './scripts/copy-payload-build'

// Vite 7 + Vitest 4 share this config. The `test` block wires Vitest:
// happy-dom (no browser), unit specs under src/.
// Deploy note (docs/self-hosting.md): nginx serves dist/ at the site root
// with `try_files $uri /index.html` — so the SPA uses the default base '/'
// and createWebHistory (client-side history routing, server-side fallback).

// The published payload lives at the repo root (public/data/ — ADR-0004) and
// nginx aliases /data/ to it in production. In dev and in `vite preview` there
// is no nginx, so the /data/ fetch (the loader's default baseUrl) 404s. This
// middleware serves the same published files from the same path. #868: the
// browser no longer requests per-territory read models, so no in-memory
// projection of modeles-lecture/ exists here anymore — nothing is written
// and neither `npm run dev` nor `npm run build` regenerates the pipeline.
const racineApp = path.resolve(fileURLToPath(new URL('.', import.meta.url)))
const racineDepot = path.resolve(racineApp, '..')
const racineDependancesReelle = realpathSync(path.resolve(racineApp, 'node_modules'))
const racinePayload = path.resolve(racineApp, '../public/data')

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
    res.setHeader('Content-Length', contenu.byteLength)
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
        void servirPayloadMiddleware(req, res, next)
      })
    },
    configurePreviewServer(serveur) {
      serveur.middlewares.use((req, res, next) => {
        void servirPayloadMiddleware(req, res, next)
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), servirPayloadEnDev(), copierPayloadEnBuild(racinePayload)],
  // [PROTOTYPE CARTOGRAPHIE — JETABLE] Variant E reads the existing QGIS
  // exports from pipeline/maps through Vite's /@fs seam; keep the allowance
  // bounded to this repository and remove it with the map-layout prototype.
  server: {
    fs: {
      // Worktrees can share node_modules through a junction to the main
      // checkout. Vite resolves /@fs font assets through that junction, so
      // allow the actual dependency root instead of returning 403 and falling
      // back to system fonts in dev.
      allow: [racineDepot, racineDependancesReelle],
    },
    // Variant E keeps /api same-origin in the browser. The public read-only API
    // is the development default; override for a local API with LUSK_API_ORIGIN.
    // This server setting is never bundled into the production frontend.
    proxy: {
      '/api': {
        target: process.env.LUSK_API_ORIGIN || 'https://lusk.calumrobertson.fr',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    // #868 : l'acquisition par thème est le seul mode — il n'y a plus de
    // valeur d'environnement à piquer ; aucun test ne peut retomber sur un
    // chemin statique.
  },
})
