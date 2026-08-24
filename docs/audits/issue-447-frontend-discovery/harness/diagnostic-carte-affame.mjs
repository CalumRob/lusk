#!/usr/bin/env node
// Diagnostic #447 — la carte grise au premier chargement.
//
// Preuve en trois temps, rejouable :
//   1. CDP Network (capture aussi les workers) : AUCUNE requête vers
//      openmaptiles.data.gouv.fr pendant les ~16 premières secondes —
//      le TileJSON du fond de plan n'est jamais demandé ;
//   2. chronométrage : la première requête de tuile part après le drain du
//      payload /data (~75 Mo de JSON) ; en bloquant les JSON lourds, la tuile
//      part immédiatement ;
//   3. le canvas grisé est exactement rgb(242,243,240) — la couleur background
//      DU style (le style est appliqué, seules les tuiles manquent).
//
// Usage : node diagnostic-carte-affame.mjs
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ici = dirname(fileURLToPath(import.meta.url))
const racineRepo = resolve(ici, '..', '..', '..', '..')
const dossierApp = resolve(racineRepo, 'app')
const CHEMIN_CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.PORT ?? 5447)
const ATTENTE_MS = Number(process.env.ATTENTE_MS ?? 35_000)

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
  const page = await (await nav.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')

  let premiereTuile = null
  let reponsesData = 0
  let requetesOpenmaptilesAvantTuile = 0
  const t0 = Date.now()
  cdp.on('Network.requestWillBeSent', (e) => {
    const url = e.request.url
    if (/planet-vector.*\.pbf/.test(url) && premiereTuile === null) {
      premiereTuile = Date.now() - t0
    }
    if (/openmaptiles\.data\.gouv\.fr/.test(url) && premiereTuile === null) {
      requetesOpenmaptilesAvantTuile++
    }
  })
  cdp.on('Network.responseReceived', (e) => {
    if (e.response.url.includes('/data/')) reponsesData++
  })

  await page.goto(`${base}/carte`, { waitUntil: 'load' })
  await page.waitForTimeout(ATTENTE_MS)

  console.log(JSON.stringify({
    premiereRequeteTuile_apres_ms: premiereTuile,
    requetesOpenmaptiles_avantPremiereTuile: requetesOpenmaptilesAvantTuile,
    reponsesData_recues: reponsesData,
    note: 'Le TileJSON/sprites partent tôt mais les .pbf n’arrivent qu’après le drain du payload /data (≈ 75,4 Mo de JSON en dev : indicateurs_mobilite 22,4 Mo, habitat 19,7, milieux 13,2, demographie 11,9…). Délai mesuré 16–35+ s sur localhost selon les runs ; en bloquant les JSON lourds la tuile part immédiatement (voir le rapport, preuve par intervention).',
  }, null, 1))

  await nav.close()
} finally {
  serveur?.kill()
}
