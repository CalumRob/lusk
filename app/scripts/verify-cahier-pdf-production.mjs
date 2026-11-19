#!/usr/bin/env node
/**
 * #1025 — bounded production-route Cahier PDF acceptance harness.
 *
 * Drives the REAL fiche (`/territoire/:type/:id?theme=mobilite`) through the
 * Vite dev proxy to the public read-only API, clicks the shared PDF action of
 * each of the nine Cahier sections, and reads the resulting PDFs back. It uses
 * the real controller and the real composer: no mock generator, no scenario
 * query parameter, no Vue introspection and no simulated timer. The only waits
 * are bounded polls on real network/layout work.
 *
 * This is evidence tooling, not an application build. It never starts or
 * restarts another server: `npm run dev` (or a preview pointed at the public
 * API) must already be listening at LUSK_BASE. PDFs and receipts are written
 * OUTSIDE `dist/` and the tracked assets, to CAHIER_PDF_EVIDENCE_DIR.
 *
 *   npm run dev                                   # terminal 1, public API proxy
 *   node scripts/verify-cahier-pdf-production.mjs commune 35238   # terminal 2
 */
import { pathToFileURL } from 'node:url'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(pathToFileURL(path.join(appDir, 'node_modules/playwright-core/index.mjs')).href)
const { getDocument, OPS } = await import(pathToFileURL(path.join(appDir, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)

const [type = 'commune', code = '35238'] = process.argv.slice(2)
const outDir = process.env.CAHIER_PDF_EVIDENCE_DIR || path.join(os.tmpdir(), 'lusk-cahier-pdf-evidence')
const origin = process.env.LUSK_BASE || 'http://127.0.0.1:5173'
// Single source of truth: the app owns the canonical public host.
const urlsSource = await readFile(path.join(appDir, 'src/fiche/prototype/cahierExportUrls.ts'), 'utf-8')
const publicUrl = /CAHIER_EXPORT_PUBLIC_URL\s*=\s*'([^']+)'/.exec(urlsSource)?.[1]
if (!publicUrl) throw new Error('CAHIER_EXPORT_PUBLIC_URL introuvable dans cahierExportUrls.ts')
const canonicalHost = new URL(publicUrl).host

// The three production Mobilité chapters and their native sections. This is a
// harness reading the existing nine-section contract, never a second registry:
// the app mounts the action through the common heading loop, not this list.
const chapters = [
  { anchor: 'figure-lecture', sections: ['aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer'] },
  { anchor: 'figure-partage-de-lespace-public', sections: ['reseaux', 'stationnement-ravitaillement'] },
  { anchor: 'figure-offre-transports-commun', sections: ['couverture-du-territoire', 'visiter-la-bretagne'] },
]

const executablePath = process.env.CAHIER_PDF_CHROMIUM
if (!executablePath) {
  throw new Error('CAHIER_PDF_CHROMIUM doit désigner l\'exécutable Chromium/Chrome à utiliser pour ce harnais.')
}
try { await access(executablePath) } catch {
  throw new Error(`CAHIER_PDF_CHROMIUM pointe vers un exécutable introuvable : ${executablePath}`)
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error.message)))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    pageErrors.push('console: ' + message.text().slice(0, 200))
  }
})

await page.goto(`${origin}/territoire/${type}/${code}?theme=mobilite#${chapters[0].anchor}`, {
  waitUntil: 'domcontentloaded', timeout: 60000,
})

async function readActions() {
  return page.evaluate(() => [...document.querySelectorAll('.cahier-pdf-action')].map((action) => {
    const button = action.querySelector('.cahier-pdf-action__button')
    return {
      key: action.closest('[data-section]')?.getAttribute('data-section') ?? '?',
      state: action.getAttribute('data-pdf-state'),
      blocked: button?.getAttribute('aria-disabled') === 'true',
      reason: action.querySelector('.cahier-pdf-action__reason')?.textContent?.trim() ?? null,
      fileName: null,
    }
  }))
}

async function waitReady(keys, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const actions = await readActions()
    if (keys.every((key) => actions.some((a) => a.key === key && !a.blocked && a.state === 'idle'))) return actions
    await page.waitForTimeout(500)
  }
  return readActions()
}

async function exportSection(key) {
  const action = (await readActions()).find((a) => a.key === key)
  if (!action) return { key, status: 'absent', reason: 'no PDF action mounted for this section' }
  if (action.blocked) return { key, status: 'blocked', reason: action.reason }

  await page.locator(`[data-section="${key}"] .cahier-pdf-action__button`).click()
  if (await page.locator('dialog[open]').count()) {
    const boxes = page.locator('dialog[open] .cahier-pdf-dialog__modes input[type="checkbox"]')
    const count = Math.min(3, await boxes.count())
    for (let i = 0; i < count; i += 1) await boxes.nth(i).check()
    await page.locator('dialog[open] [data-pdf-confirm]').click()
  }
  let download
  try {
    download = await page.waitForEvent('download', { timeout: 60000 })
  } catch (error) {
    const after = await readActions()
    return { key, status: 'no-download', reason: after.find((a) => a.key === key)?.reason ?? String(error).slice(0, 160) }
  }
  const file = path.join(outDir, `${type}-${code}-${key}.pdf`)
  await download.saveAs(file)
  const deadline = Date.now() + 60000
  let settled = null
  while (Date.now() < deadline) {
    settled = (await readActions()).find((a) => a.key === key)
    if (settled?.state === 'done' || settled?.state === 'error') break
    await page.waitForTimeout(200)
  }
  const result = {
    key,
    status: settled?.state === 'done' ? 'success' : (settled?.state ?? 'unknown'),
    reason: settled?.reason ?? null,
    fileName: download.suggestedFilename(),
    file: path.basename(file),
  }
  if (result.status === 'success') {
    try { result.audit = await audit(file, key) }
    catch (error) { result.status = 'audit-error'; result.reason = String(error).slice(0, 200) }
  }
  return result
}

async function audit(file, key) {
  const bytes = new Uint8Array(await readFile(file))
  const pdf = await getDocument({ data: Uint8Array.from(bytes) }).promise
  const pages = []
  let allText = ''
  let imageXObjects = 0
  let overlappingTextPairs = 0
  const textItems = []
  const links = []
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const pdfPage = await pdf.getPage(index)
    const items = (await pdfPage.getTextContent()).items.filter((item) => item.str?.trim())
    allText += ' ' + items.map((item) => item.str ?? '').join(' ')
    // Two runs on the same baseline must not overprint each other. A narrow
    // separator painted at its DOM advance but advanced by the embedded face's
    // glyph width used to hide the comma/thin space by overprinting the next
    // digit; this guard fails on that class of defect.
    const boxes = items.map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      w: item.width,
      h: Math.abs(item.transform[3]),
    }))
    textItems.push(...boxes)
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const left = boxes[a], right = boxes[b]
        if (Math.abs(left.y - right.y) > Math.max(left.h, right.h) * 0.5) continue
        const overlap = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x)
        if (overlap > 0.6) overlappingTextPairs += 1
      }
    }
    const operators = await pdfPage.getOperatorList()
    imageXObjects += operators.fnArray.filter((fn) => fn === OPS.paintImageXObject).length
    for (const annotation of await pdfPage.getAnnotations()) if (annotation.url) links.push(annotation.url)
    const viewport = pdfPage.getViewport({ scale: 1 })
    pages.push({ page: index, widthPt: Math.round(viewport.width), heightPt: Math.round(viewport.height) })
  }
  // Native French grouping uses U+202F; jsPDF maps it to a plain space in the
  // text layer. The separated forms must survive, never the collapsed digits.
  const collapsedGrouping = ['6440', '12881', '12081'].filter((value) => allText.includes(value))
  // Two-level table headers: the row dimension (Statistique / Temps / Mode)
  // must share the painted baseline block of its one-line sub-headers, not sit
  // on a line of its own above them.
  const headerText = (needle) => textItems.find((item) => item.str === needle)?.y ?? null
  const rowHeaders = textItems.filter((item) => item.str === 'Statistique' || item.str === 'Temps').map((item) => item.y)
  const subHeaders = textItems.filter((item) => item.str === 'Rennes' || item.str === 'Groupe¹').map((item) => item.y)
  // Several tables can share one PDF; compare each row dimension with its
  // nearest one-line sub-header baseline, never a label from another table.
  const headerAligned = rowHeaders.length === 0 || subHeaders.length === 0 ? null
    : rowHeaders.every((y) => subHeaders.some((other) => Math.abs(y - other) <= 0.6))
  // Only Lusk site links must use the canonical public host. External source
  // attributions are owner-owned and preserved verbatim, not treated as drift.
  const siteLinks = links.filter((url) => /lusk\./i.test(url))
  const hostOf = (url) => { try { return new URL(url).host } catch { return '?' } }
  return {
    key,
    pageCount: pdf.numPages,
    pages,
    hasIdentity: /RENNES|ALLINEUC/i.test(allText),
    hasSources: allText.includes('Source(s)'),
    hasValuesTable: allText.includes('Valeurs du graphique') || allText.includes('Valeurs des graphiques'),
    hasRank: allText.includes('Rang'),
    replacementGlyph: allText.includes('\ufffd'),
    imageXObjects,
    overlappingTextPairs,
    headerAligned,
    collapsedGrouping,
    separatorsPreserved: collapsedGrouping.length === 0,
    siteLinkCount: siteLinks.length,
    canonicalHostOnly: siteLinks.length > 0 && siteLinks.every((url) => hostOf(url) === canonicalHost),
    sourceLinkHosts: [...new Set(links.filter((url) => !/lusk\./i.test(url)).map(hostOf))],
  }
}

const territories = (process.env.CAHIER_PDF_TERRITORIES || `${type}/${code}`)
  .split(',').map((value) => value.trim()).filter(Boolean)
const results = []
try {
  for (const territory of territories) {
    const [territoryType, territoryCode] = territory.split('/')
    await page.goto(`${origin}/territoire/${territoryType}/${territoryCode}?theme=mobilite`, {
      waitUntil: 'domcontentloaded', timeout: 60000,
    })
    for (const chapter of chapters) {
      await page.evaluate((hash) => { window.location.hash = hash }, chapter.anchor)
      const actions = await waitReady(chapter.sections)
      const blocked = actions.filter((a) => chapter.sections.includes(a.key) && a.blocked)
        .map((a) => ({ key: a.key, status: 'blocked', reason: a.reason }))
      for (const key of chapter.sections) {
        const comparisonState = await page.evaluate((sectionKey) => {
          const section = document.querySelector(`[data-section="${sectionKey}"]`)
          if (!section) return 'absent'
          if (section.querySelector('[role=status], .cahier-comparison-retry')) return 'error'
          if (section.querySelector('.cahier-loading, [aria-busy=true]')) return 'loading'
          return section.textContent?.includes('Groupe comparé') ? 'shown' : 'absent'
        }, key)
        if (blocked.some((b) => b.key === key)) {
          results.push({ territory, comparisonState, ...blocked.find((b) => b.key === key) })
          continue
        }
        const result = await exportSection(key)
        results.push({ territory, comparisonState, ...result })
        console.log(JSON.stringify({ territory, progress: key, comparisonState, status: result.status, reason: result.reason ?? null }))
      }
    }
  }
} finally {
  const coverage = territories.map((territory) => ({
    territory,
    sections: results.filter((result) => result.territory === territory)
      .map((result) => ({ key: result.key, status: result.status, comparisonState: result.comparisonState })),
  }))
  const receipt = {
    territories,
    origin,
    canonicalHost,
    at: new Date().toISOString(),
    pageErrors: pageErrors.slice(0, 30),
    coverage,
    results,
  }
  const receiptPath = path.join(outDir, 'receipt.json')
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2))
  console.log('RECEIPT ' + receiptPath)
  await browser.close()
}
