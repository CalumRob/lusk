#!/usr/bin/env node
// Repro minimal : maplibre (version de l'app) + le style local de l'app,
// servis par le serveur de dev vite — le strict minimum, sans l'app.
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ici = dirname(fileURLToPath(import.meta.url))
const racineRepo = resolve(ici, '..', '..', '..', '..')
const dossierApp = resolve(racineRepo, 'app')
const CHEMIN_CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 5455

// Servir le HTML + maplibre depuis public/ du serveur vite ? Non : vite ne sert
// que /data et /public racine. On copie repro + maplibre dist dans app/public
// le temps du diagnostic — puis on nettoie.
copyFileSync(resolve(ici, 'repro-carte.html'), resolve(dossierApp, 'public', 'repro-carte.html'))
copyFileSync(
  resolve(dossierApp, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.js'),
  resolve(dossierApp, 'public', 'maplibre.js'),
)

let serveur
function demarrerVite() {
  serveur = spawn(process.execPath, [resolve(dossierApp, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: dossierApp, stdio: ['ignore','pipe','pipe'] })
}
async function attendre(url) {
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(url); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('serveur absent')
}

demarrerVite()
try {
  const base = `http://localhost:${PORT}`
  await attendre(base)
  const nav = await chromium.launch({ executablePath: CHEMIN_CHROME, headless: true })
  const page = await nav.newPage()
  const tuiles = []
  page.on('request', (r) => { if (/openmaptiles|\.pbf/.test(r.url())) tuiles.push(r.url().slice(0, 110)) })
  await page.goto(`${base}/public/repro-carte.html`, { waitUntil: 'load' })
  await page.waitForTimeout(8000)
  const journal = await page.evaluate(() => [...document.querySelectorAll('pre')].map((p) => p.textContent))
  const etat = await page.evaluate(() => window.__etat?.())
  await page.screenshot({ path: resolve(ici, 'repro-carte.png') })
  console.log('journal :', journal.join('\n') || '(vide)')
  console.log('état :', JSON.stringify(etat))
  console.log('requêtes tuiles :', tuiles.length ? tuiles.slice(0, 5).join(' | ') : 'AUCUNE')
  await nav.close()
} finally {
  serveur?.kill()
  // nettoyage des fichiers temporaires copiés dans public/
  const { unlinkSync } = await import('node:fs')
  try { unlinkSync(resolve(dossierApp, 'public', 'repro-carte.html')) } catch {}
  try { unlinkSync(resolve(dossierApp, 'public', 'maplibre.js')) } catch {}
}
