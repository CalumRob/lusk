#!/usr/bin/env node
// Verrou de défilement : gestes UTILISATEUR (molette) depuis y=0, tiroir ouvert.
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ici = dirname(fileURLToPath(import.meta.url))
const racineRepo = resolve(ici, '..', '..', '..', '..')
const dossierApp = resolve(racineRepo, 'app')
const CHEMIN_CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 5450

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
  const nav = await chromium.launch({ executablePath: CHEMIN_CHROME })
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(`${base}/`, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})

  // Molette AVANT ouverture : la page doit défiler (témoin)
  await page.mouse.move(195, 400)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(250)
  const yTemoin = await page.evaluate(() => window.scrollY)

  await page.locator('.bouton-menu').click()
  await page.waitForTimeout(450)
  const yAvantOuvert = await page.evaluate(() => window.scrollY)
  await page.mouse.move(195, 400)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(250)
  const yApresMoletteOuverte = await page.evaluate(() => window.scrollY)

  console.log(JSON.stringify({
    temoinMoletteSansTiroir_y: yTemoin,
    yAvantOuverture: yAvantOuvert,
    yApresMoletteTiroirOuvert: yApresMoletteOuverte,
    verrouUtilisateurOK: yTemoin > 0 && yApresMoletteOuverte === yAvantOuvert,
  }, null, 1))

  await nav.close()
} finally {
  serveur?.kill()
}
