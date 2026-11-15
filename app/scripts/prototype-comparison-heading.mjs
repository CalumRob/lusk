// THROWAWAY: agreed comparison subtitle, using the existing browser PDF adapter.
// Run: node scripts/prototype-comparison-heading.mjs (from app/).
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const out = 'E:/Temp/opencode/cahier-comparison-subtitle-mockup'
await mkdir(out, { recursive: true })
const server = await createServer({ optimizeDeps: { include: ['jspdf', 'svg2pdf.js'] }, server: { host: '127.0.0.1', port: 5201, strictPort: true, hmr: false } })
await server.listen()
const browser = await chromium.launch({ headless: true })
const receipts = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('pageerror', error => console.error(error.message))
  async function load(preset) {
    await page.goto(`http://127.0.0.1:5201/territoire/commune/35238?theme=mobilite&comparaison=${preset}`)
    await page.evaluate(async () => { window.rennesPrototype = await import('/src/fiche/prototype/pdf-prototype/rennes.js') })
    await page.waitForFunction(() => window.rennesPrototype.ready(), null, { timeout: 90000 })
    await page.evaluate(async () => {
      window.desktopPdf = await import('/src/fiche/prototype/pdf-prototype/desktop.js')
      await document.fonts.ready
    })
    const target = new URL(server.config.server.proxy['/api'].target)
    const publicUrl = new URL(page.url()); publicUrl.host = target.host; publicUrl.protocol = target.protocol
    await page.evaluate(url => { window.desktopPublicPageUrl = url }, publicUrl.href)
  }
  await load('epci')
  const resolved = await page.evaluate(() => {
    const control = window.rennesPrototype.instances()[0].setupState.controleComparaison
    return JSON.parse(JSON.stringify(control))
  })
  await writeFile(`${out}/resolved-control.json`, JSON.stringify(resolved, null, 2))
  console.log('Resolved keys:', Object.keys(resolved))
  const inventory = await page.evaluate(() => ({
    fonts: [...new Map([...document.querySelectorAll('#figure-lecture *, .en-tete .lusk-marque, .en-tete .lusk-marque *')].filter(node => node.getClientRects().length).map(node => {
      const style = getComputedStyle(node)
      const spec = { family: style.fontFamily.split(',')[0].replaceAll(/["']/g, '').trim(), weight: Number(style.fontWeight), style: style.fontStyle }
      return [JSON.stringify(spec), spec]
    })).values()],
    loadedFaces: [...document.fonts].filter(face => face.status === 'loaded').map(face => ({ family: face.family.replaceAll(/["']/g, ''), style: face.style, weight: face.weight })),
  }))
  await writeFile(`${out}/inventory.json`, JSON.stringify(inventory))
  execFileSync('python', ['scripts/prototype-pdf-fonts.py', `${out}/inventory.json`], { stdio: 'inherit' })
  async function capture(id, spec, sectionKey = 'aedar-equipment-explorer', tables = true) {
    const before = await page.locator('.cahier').evaluate(node => node.outerHTML)
    const download = page.waitForEvent('download', { timeout: 120000 })
    const receipt = await page.evaluate(options => window.desktopPdf.exportDesktop(options), {
      sectionKey, includeTooltipTables: tables, territoryFirst: true, headingMockup: spec,
    })
    await (await download).saveAs(`${out}/${id}.pdf`)
    receipt.liveDomUnchanged = before === await page.locator('.cahier').evaluate(node => node.outerHTML)
    if (!receipt.liveDomUnchanged) throw new Error('Live DOM changed')
    receipts.push({ id, spec, ...receipt })
    await writeFile(`${out}/receipts.json`, JSON.stringify(receipts, null, 2))
    console.log(id, receipt.comparisonHeadings)
  }
  const reference = resolved.territoires
  const focal = resolved.focal
  const epci = reference.find(row => row.type === 'epci' && row.territoire === focal.epci)
  if (!epci || !['preset', 'defaut'].includes(resolved.selection.etat)) throw new Error('Expected a resolved EPCI preset')
  await capture('01-real-epci', { preset: 'epci', level: focal.type, epci })
  await capture('02-real-no-comparative-evidence', { preset: 'epci', level: focal.type, epci }, 'aedar-equipment-profile', false)
  const compareButton = page.locator('.concept-group[data-section="aedar-equipment-explorer"] button[aria-pressed="true"]').filter({ hasText: 'Groupe comparé' })
  await compareButton.click()
  await capture('03-real-comparison-off', { preset: 'epci', level: focal.type, epci })
  await load('bretagne')
  await capture('04-real-bretagne-communes', { preset: 'bretagne', level: focal.type })
  for (const state of ['empty', 'unavailable']) await capture(`synthetic-comparison-${state}`, {
    specimen: true, specimenEvidence: false, focal, level: focal.type, members: [],
    description: state === 'empty' ? 'sélection vide : aucune comparaison' : 'comparaison indisponible : aucune preuve affichée',
  }, undefined, false)
  // No custom comparison HTTP reads: reference identities only, fabricated membership.
  for (const level of ['commune', 'epci', 'departement']) {
    const rows = reference.filter(row => row.type === level)
    const byWidth = [...rows].sort((a, b) => a.nom.length - b.nom.length)
    const specimenFocal = level === 'commune' ? focal : rows[0]
    const base = { specimen: true, specimenEvidence: true, focal: specimenFocal, level }
    await capture(`synthetic-${level}-short`, { ...base, members: byWidth.slice(0, 3), description: 'noms publics courts ; appartenance simulée' }, undefined, false)
    await capture(`synthetic-${level}-long`, { ...base, members: byWidth.slice(-3), description: 'noms publics longs ; appartenance simulée' }, undefined, false)
    await capture(`synthetic-${level}-extended`, { ...base, members: rows.slice(0, 24), description: 'sélection typographique étendue, non acquise' }, undefined, false)
    if (level === 'departement') await capture('synthetic-departement-prefix', { ...base,
      members: [1, 2, 3, 4].map(index => ({ territoire: `synthetic-${index}`, type: level, nom: `Département synthétique ${index} des Vallées et des Montagnes de la Rivière` })),
      description: 'noms fictifs longs pour éprouver le préfixe complet' }, undefined, false)
    if (level !== 'commune') await capture(`synthetic-bretagne-${level}`, { ...base, preset: 'bretagne', description: 'preset Bretagne à ce niveau, preuve simulée' }, undefined, false)
    // Deliberately impossible synthetic public-label strings, not invented real peers.
    const members = [1, 2, 3].map(index => ({ type: level, territoire: `synthetic-${index}`, nom: `Territoire synthétique ${index} ` + 'de la très longue dénomination '.repeat(14) }))
    await capture(`synthetic-${level}-count-only`, { ...base, members, description: 'noms fictifs démesurés ; repli au compte total' }, undefined, false)
  }
} finally { await browser.close(); server.httpServer?.closeAllConnections(); await server.close() }
console.log(`Artifacts: ${out}`)
