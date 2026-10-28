#!/usr/bin/env node
/**
 * Diagnostic ciblé #481 — le surlignage du territoire à l'arrivée d'une
 * passarelle trajectoire (milieux/artif_par_habitant, département 35).
 * Contrôle : la même navigation sur une page scalaire (economie/chomage) et
 * sur la générique demographie/evolution_1968.
 *
 * Usage : node diagnostic-selection-trajectoire.mjs [--base http://localhost:5481]
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import('playwright-core')

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..', '..')
const DIST = join(REPO, 'app', 'dist')
const EVIDENCE = join(HERE, '..', 'evidence')
const PORT = Number(process.env.PORT || 5482)
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.geojson': 'application/geo+json', '.parquet': 'application/octet-stream', '.woff2': 'font/woff2' }
const serveur = createServer((req, res) => {
  let fichier = normalize(join(DIST, decodeURIComponent(new URL(req.url, BASE).pathname)))
  if (!fichier.startsWith(DIST)) { res.writeHead(403); res.end(); return }
  if (!existsSync(fichier)) fichier = join(DIST, 'index.html')
  try {
    res.writeHead(200, { 'content-type': MIME[fichier.slice(fichier.lastIndexOf('.'))] || 'application/octet-stream' })
    res.end(readFileSync(fichier))
  } catch { res.writeHead(404); res.end() }
})
await new Promise((r) => serveur.listen(PORT, r))

const CASSES = [
  { nom: 'trajectoire-milieux-dep35', url: '/indicateurs/milieux/artif_par_habitant?territoire=35&niveau=departement' },
  { nom: 'controle-scalaire-eco-dep35', url: '/indicateurs/economie/chomage?territoire=35&niveau=departement' },
  { nom: 'controle-generique-demo-dep35', url: '/indicateurs/demographie/evolution_1968?territoire=35&niveau=departement' },
  { nom: 'controle-trajectoire-commune-rennes-prixm2', url: '/indicateurs/habitat/prix_m2?territoire=35238&niveau=commune' },
]

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const contexte = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const sorties = []
try {
  for (const casse of CASSES) {
    const page = await contexte.newPage()
    const consoleErreurs = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErreurs.push(m.text().slice(0, 300)) })
    await page.goto(`${BASE}${casse.url}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="note-contexte"]', { timeout: 90_000 })
    // attendre la stabilisation complète (fin des réécritures d'URL)
    await page.waitForFunction(() => !document.querySelector('.indicateur-page [role="status"]')?.textContent?.includes('Chargement'), { timeout: 60_000 }).catch(() => {})
    for (let t = 0; t < 10; t++) { // jusqu'à 10 s de stabilisation URL/DOM
      const u1 = page.url(); await page.waitForTimeout(1000); if (page.url() === u1) break
    }
    const etat = await page.evaluate(() => ({
      urlFinale: location.href,
      note: document.querySelector('[data-testid="note-contexte"]')?.textContent ?? null,
      tables: document.querySelectorAll('table').length,
      lignes: document.querySelectorAll('table tbody tr').length,
      selection: document.querySelectorAll('tr.selection').length,
      selectionTexte: document.querySelector('tr.selection td')?.textContent?.trim()?.slice(0, 80) ?? null,
      premieresLignes: [...document.querySelectorAll('table tbody tr td:first-child')].slice(0, 5).map((td) => td.textContent.trim()),
      alertes: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim()).slice(0, 3),
    }))
    sorties.push({ casse: casse.nom, ...etat, consoleErreurs: consoleErreurs.slice(0, 5) })
    console.log(`\n== ${casse.nom}`)
    console.log(JSON.stringify(sorties[sorties.length - 1], null, 1))
    await page.close()
  }
} finally {
  await browser.close()
  serveur.close()
}
mkdirSync(EVIDENCE, { recursive: true })
writeFileSync(join(EVIDENCE, 'diagnostic-selection-trajectoire.json'), JSON.stringify(sorties, null, 2))
