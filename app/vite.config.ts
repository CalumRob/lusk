import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { copierPayloadEnBuild } from './scripts/copy-payload-build'

// App (dev / build / preview) config only. Vitest lives in vitest.config.ts.
// Deploy note (docs/self-hosting.md): nginx serves dist/ at the site root
// with `try_files $uri /index.html` — so the SPA uses the default base '/'
// and createWebHistory (client-side history routing, server-side fallback).

// The published payload lives at the repo root (public/data/ — ADR-0004) and
// nginx aliases /data/ to it in production. In dev and in `vite preview` there
// is no nginx, so the /data/ fetch (the loader's default baseUrl) 404s. This
// middleware serves the same published files from the same path. #868/#900:
// the browser no longer requests per-territory read models and the committed
// modeles-lecture/ trees are retired — nothing is written here and neither
// `npm run dev` nor `npm run build` regenerates the pipeline.
const racineApp = path.resolve(fileURLToPath(new URL('.', import.meta.url)))
const racineDepot = path.resolve(racineApp, '..')
const racineDependances = path.resolve(racineApp, 'node_modules')
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
  // MapLibre 6 resolves its module worker relative to import.meta.url. Keep the
  // package at its own URL: prebundling it into .vite/deps leaves that worker
  // beside the optimized module without copying the worker there.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    // The app imports repository-owned files outside app/ (for example
    // pipeline/inst/extdata/*.csv?raw), so the repository root must be
    // servable. Nothing outside the checkout is allowed: node_modules must be
    // a real directory in each checkout, never a junction to another one.
    fs: {
      allow: [racineDepot],
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
      // svg2pdf's UMD `main` cannot consume jsPDF's ESM exports under Vitest's
      // SSR resolver. The package's own ES build is the browser build; pin it
      // explicitly so tests and the production bundle run the same module.
      'svg2pdf.js': path.join(racineDependances, 'svg2pdf.js/dist/svg2pdf.es.min.js'),
    },
  },
})
