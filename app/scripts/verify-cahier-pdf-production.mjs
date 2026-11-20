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

// Sections with no served data at a level are legitimately absent. Every other
// absence is a harness failure; a region PDF still exporting those would also
// violate this expectation.
const EXPECTED_ABSENT = {
  region: ['reseaux', 'stationnement-ravitaillement'],
}
// Explicit harness fixture expectations — not arbitrary literals: these are the
// frozen French-grouping regression values and the two-level table header
// vocabulary owned by cahierPdfTableau / cahierPdfGrammaire. They are checked
// against the PDF text, never written into the document.
const FIXTURE_EXPECTATIONS = Object.freeze({
  collapsedGrouping: ['6440', '12881', '12081'],
  rowHeaders: ['Statistique', 'Temps'],
  subHeaders: ['Rennes', 'Groupe¹'],
})
const gateFailures = []

/** Every recorded abnormal state is a gate failure, not just an annotation. */
function gateResult(territory, key, result) {
  const at = `${territory}/${key}`
  const status = result.status
  if (['error', 'no-download', 'audit-error', 'blocked'].includes(status)) {
    gateFailures.push(`${at}: status=${status} (${result.reason ?? ''})`)
  }
  if (result.audit) {
    const audit = result.audit
    if (audit.headerAligned === false) gateFailures.push(`${at}: headerAligned=false`)
    if (audit.separatorsPreserved === false) gateFailures.push(`${at}: separatorsPreserved=false`)
    if (audit.replacementGlyph) gateFailures.push(`${at}: replacement glyph in PDF text`)
    if (!audit.canonicalHostOnly && audit.siteLinkCount > 0) {
      gateFailures.push(`${at}: non-canonical Lusk link host`)
    }
    if (audit.unexpectedOverlaps?.length) {
      gateFailures.push(`${at}: ${audit.unexpectedOverlaps.length} unexpected text overlap(s)`)
    }
    if (audit.numericChecks?.missing?.length) {
      gateFailures.push(`${at}: served values missing from PDF: ${audit.numericChecks.missing.join(', ')}`)
    }
    if (audit.rankChecks?.missing?.length) {
      gateFailures.push(`${at}: served ranks missing from PDF: ${audit.rankChecks.missing.join(', ')}`)
    }
  }
  if (result.comparisonState && !['shown', 'absent'].includes(result.comparisonState)) {
    gateFailures.push(`${at}: comparisonState=${result.comparisonState}`)
  }
  if (pageErrors.length) gateFailures.push(`${at}: ${pageErrors.length} page error(s)`)
}

async function gateSelfTest() {
  const synth = [
    ['commune/35238', 'a', { status: 'error', comparisonState: 'shown' }],
    ['commune/35238', 'b', { status: 'no-download', comparisonState: 'shown' }],
    ['commune/35238', 'c', { status: 'audit-error', comparisonState: 'shown' }],
    ['commune/35238', 'd', { status: 'blocked', comparisonState: 'shown' }],
    ['commune/35238', 'e', { status: 'success', comparisonState: 'error', audit: {} }],
    ['commune/35238', 'f', { status: 'success', audit: { headerAligned: false, separatorsPreserved: false, replacementGlyph: true } }],
  ]
  const before = gateFailures.length
  for (const [territory, key, result] of synth) gateResult(territory, key, result)
  pageErrors.push('injected page error')
  gateResult('commune/35238', 'g', { status: 'success', audit: {} })
  const fired = gateFailures.slice(before).join('\n')
  for (const needle of [
    'status=error', 'status=no-download', 'status=audit-error', 'status=blocked',
    'comparisonState=error', 'headerAligned=false', 'separatorsPreserved=false',
    'replacement glyph', 'page error',
  ]) {
    if (!fired.includes(needle)) throw new Error(`gate self-test failed: ${needle} did not fire`)
  }
  console.log('GATE SELF-TEST OK: ' + (gateFailures.length - before) + ' injected defects all fired')
  gateFailures.length = 0
}

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

if (process.env.CAHIER_PDF_GATE_SELFTEST === '1') {
  await gateSelfTest()
  await browser.close()
  process.exit(0)
}

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

// Independent numeric witness: read specific served values/ranks straight from
// the section's own DOM (the source facts the screen renders), then require the
// PDF to contain those exact strings. A 10x scale error or swapped columns in
// the document composer cannot pass this check.
async function sourceReadings(key) {
  return page.evaluate((sectionKey) => {
    const section = document.querySelector(`[data-section="${sectionKey}"]`)
    if (!section) return []
    const nodes = section.querySelectorAll(
      '.cahier-figure-scalar-value, .cahier-figure-scalar-reference, .cahier-comparison-value',
    )
    const values = new Set()
    for (const node of nodes) {
      const text = (node.textContent ?? '').trim().replace(/[\u202f\u00a0]/gu, ' ')
      if (/^\d{1,4}(?:[ ,]\d{1,3})*(?:\s?%)?$/.test(text) && text.length <= 12) values.add(text)
    }
    return [...values].slice(0, 8)
  }, key)
}

// Rank chips are served facts. Read them from the screen before export and
// require the same tokens in the PDF: a transient payload without ranks must
// fail the run instead of silently shipping an overview with `—` ranks.
// The shared action may enable before the comparison detail settles (observed:
// ready at ~3.8s, rank chips at ~5.6s). Exporting in that window silently drops
// served ranks. Wait for the section's busy indicators to clear first.
async function waitComparisonSettled(key, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const busy = await page.evaluate((sectionKey) => {
      const section = document.querySelector(`[data-section="${sectionKey}"]`)
      if (!section) return false
      return section.querySelectorAll(
        '[aria-busy=true], .cahier-comparison-value__spinner, .cahier-loading',
      ).length > 0
    }, key)
    if (!busy) return true
    await page.waitForTimeout(250)
  }
  return false
}

async function sourceRanks(key) {
  return page.evaluate((sectionKey) => {
    const section = document.querySelector(`[data-section="${sectionKey}"]`)
    if (!section) return []
    return [...new Set([...section.querySelectorAll('.cahier-rank-ink')]
      .map((node) => (node.textContent ?? '').trim()).filter(Boolean))]
  }, key)
}

async function exportSection(key, territory) {
  const action = (await readActions()).find((a) => a.key === key)
  if (!action) return { key, status: 'absent', reason: 'no PDF action mounted for this section' }
  if (action.blocked) return { key, status: 'blocked', reason: action.reason }

  const comparisonSettled = await waitComparisonSettled(key)
  if (!comparisonSettled) return { key, status: 'audit-error', reason: 'comparison did not settle before export' }
  const expectedValues = await sourceReadings(key)
  const expectedRanks = await sourceRanks(key)
  const expectedIdentity = await page.evaluate(() =>
    (document.querySelector('h1')?.textContent ?? '').trim())
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
  // File names come from the territory actually being driven in this loop, not
  // the CLI default — otherwise every level overwrites the commune PDF.
  const [fileType, fileCode] = territory.split('/')
  const file = path.join(outDir, `${fileType}-${fileCode}-${key}.pdf`)
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
    try { result.audit = await audit(file, key, expectedValues, expectedIdentity, expectedRanks) }
    catch (error) { result.status = 'audit-error'; result.reason = String(error).slice(0, 200) }
  }
  return result
}

async function audit(file, key, expectedValues = [], expectedIdentity = '', expectedRanks = []) {
  const bytes = new Uint8Array(await readFile(file))
  const pdf = await getDocument({ data: Uint8Array.from(bytes) }).promise
  const pages = []
  let allText = ''
  let imageXObjects = 0
  const overlapPairs = []
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
      a: item.transform[0], b: item.transform[1],
    }))
    textItems.push(...boxes)
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const left = boxes[a], right = boxes[b]
        if (Math.abs(left.y - right.y) > Math.max(left.h, right.h) * 0.5) continue
        const overlap = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x)
        if (overlap > 0.6) overlapPairs.push({
          page: index, overlap: +overlap.toFixed(2),
          a: { str: left.str, x: +left.x.toFixed(1), y: +left.y.toFixed(1), w: +left.w.toFixed(1), h: +left.h.toFixed(1), a: left.a, b: left.b },
          b: { str: right.str, x: +right.x.toFixed(1), y: +right.y.toFixed(1), w: +right.w.toFixed(1), h: +right.h.toFixed(1), a: right.a, b: right.b },
        })
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
  const collapsedGrouping = FIXTURE_EXPECTATIONS.collapsedGrouping
    .filter((value) => allText.includes(value))
  // Two-level table headers: the row dimension (Statistique / Temps / Mode)
  // must share the painted baseline block of its one-line sub-headers, not sit
  // on a line of its own above them.
  const headerText = (needle) => textItems.find((item) => item.str === needle)?.y ?? null
  const rowHeaders = textItems.filter((item) => FIXTURE_EXPECTATIONS.rowHeaders.includes(item.str)).map((item) => item.y)
  const subHeaders = textItems.filter((item) => FIXTURE_EXPECTATIONS.subHeaders.includes(item.str)).map((item) => item.y)
  // Several tables can share one PDF; compare each row dimension with its
  // nearest one-line sub-header baseline, never a label from another table.
  const headerAligned = rowHeaders.length === 0 || subHeaders.length === 0 ? null
    : rowHeaders.every((y) => subHeaders.some((other) => Math.abs(y - other) <= 0.6))
  // Only Lusk site links must use the canonical public host. External source
  // attributions are owner-owned and preserved verbatim, not treated as drift.
  const siteLinks = links.filter((url) => /lusk\./i.test(url))
  const hostOf = (url) => { try { return new URL(url).host } catch { return '?' } }
  // The ONE permitted overlap: a 90°-rotated axis title crossing a short
  // numeric tick on the same baseline. Declared with geometry (rotation, tick
  // width, numeric text and a bounded overlap), never a blanket allowance.
  const rotated = (item) => Math.abs(item.b) > Math.abs(item.a) * 2 && Math.abs(item.b) > 1
  const shortTick = (item) => item.w <= 12
    && /^\d{1,4}(?:[ ,][\d]{1,3})*$/u.test(item.str.trim())
  const classified = overlapPairs.map((pair) => ({
    ...pair,
    kind: ((rotated(pair.a) && shortTick(pair.b)) || (rotated(pair.b) && shortTick(pair.a)))
      && pair.overlap <= 12 ? 'known-rotated-axis-tick' : 'unexpected',
  }))
  const unexpectedOverlaps = classified.filter((pair) => pair.kind === 'unexpected')
  const normalizedText = allText.replace(/[\u202f\u00a0]/gu, ' ')
  const missingValues = expectedValues.filter((value) => !normalizedText.includes(value))
  const missingRanks = expectedRanks.filter((rank) => !normalizedText.includes(rank))
  return {
    key,
    pageCount: pdf.numPages,
    pages,
    overlapPairs: classified,
    overlappingTextPairs: classified.length,
    unexpectedOverlaps,
    numericChecks: { expected: expectedValues, missing: missingValues },
    rankChecks: { expected: expectedRanks, missing: missingRanks },
    hasIdentity: expectedIdentity.length > 0
      && normalizedText.toUpperCase().includes(expectedIdentity.toUpperCase()),
    hasSources: allText.includes('Source(s)'),
    hasValuesTable: allText.includes('Valeurs du graphique') || allText.includes('Valeurs des graphiques'),
    hasRank: allText.includes('Rang'),
    replacementGlyph: allText.includes('\ufffd'),
    imageXObjects,
    headerAligned,
    collapsedGrouping,
    separatorsPreserved: collapsedGrouping.length === 0,
    siteLinkCount: siteLinks.length,
    canonicalHostOnly: siteLinks.length > 0 && siteLinks.every((url) => hostOf(url) === canonicalHost),
    sourceLinkHosts: [...new Set(links.filter((url) => !/lusk\./i.test(url)).map(hostOf))],
  }
}

// Production-path interaction checks that do not alter served data. The
// comparison loading/empty states are deliberately NOT driven here: reaching
// them would require replacing the read-only API response for the comparison
// endpoint, which the harness never does. They are reported as undrivable.
async function driveInteractions() {
  const checks = {}
  const key = 'aedar-access'
  const button = page.locator(`[data-section="${key}"] .cahier-pdf-action__button`)
  await button.focus()
  checks.keyboardFocus = await button.evaluate((node) => document.activeElement === node)
  let downloads = 0
  const onDownload = () => { downloads += 1 }
  page.on('download', onDownload)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  checks.enterActivates = (await page.locator('dialog[open]').count()) > 0 || downloads > 0
  if (await page.locator('dialog[open]').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  checks.escapeClosesDialog = (await page.locator('dialog[open]').count()) === 0
  // Let any download started by Enter settle before measuring cancellation.
  await page.waitForTimeout(5000)
  downloads = 0

  // Three-mode limit: try to check more than three modes in the real dialog.
  await button.click()
  const boxes = page.locator('dialog[open] .cahier-pdf-dialog__modes input[type="checkbox"]')
  const count = await boxes.count()
  for (let i = 0; i < Math.min(count, 5); i += 1) await boxes.nth(i).check()
  checks.threeModeLimit = (await page.locator('dialog[open] .cahier-pdf-dialog__modes input[type="checkbox"]:checked').count()) <= 3
  // Cancel keeps the controller idle: no download, dialog dismissed.
  checks.cancelApplicable = (await page.locator('dialog[open]').count()) > 0
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  checks.cancelNoDownload = checks.cancelApplicable ? downloads === 0 : null
  checks.cancelClosesDialog = (await page.locator('dialog[open]').count()) === 0

  // Double-click the action: the controller must not emit two downloads.
  downloads = 0
  await button.dblclick()
  try { await page.waitForEvent('download', { timeout: 60000 }) } catch { /* no download */ }
  await page.waitForTimeout(600)
  if (await page.locator('dialog[open]').count()) {
    const modeBoxes = page.locator('dialog[open] .cahier-pdf-dialog__modes input[type="checkbox"]')
    const n = Math.min(3, await modeBoxes.count())
    for (let i = 0; i < n; i += 1) await modeBoxes.nth(i).check()
    await page.locator('dialog[open] [data-pdf-confirm]').click()
    try { await page.waitForEvent('download', { timeout: 60000 }) } catch { /* no download */ }
  }
  checks.doubleClickOneDownload = downloads === 1

  // Mobile target: the shared action button keeps a usable tap size.
  await page.setViewportSize({ width: 390, height: 844 })
  checks.mobileTarget = await button.evaluate((node) => {
    const r = node.getBoundingClientRect()
    return r.width >= 24 && r.height >= 24
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  page.off('download', onDownload)
  checks.comparisonLoadingDriven = false
  checks.comparisonEmptyDriven = false
  checks.undrivableReason = 'Comparison loading/empty require substituting the read-only API comparison response; the harness never rewrites served data.'
  return checks
}

const territories = (process.env.CAHIER_PDF_TERRITORIES || `${type}/${code}`)
  .split(',').map((value) => value.trim()).filter(Boolean)
const results = []
let interactions = {}
try {
  interactions = await driveInteractions()
  console.log('INTERACTIONS ' + JSON.stringify(interactions))
  for (const [check, passed] of Object.entries(interactions)) {
    if (typeof passed !== 'boolean' || passed) continue
    // Informational: some sections export directly and never open a dialog,
    // so cancellation is not applicable there. Loading/empty are undrivable.
    if (check === 'cancelApplicable' || check.startsWith('comparison')) continue
    gateFailures.push(`interaction ${check} failed`)
  }
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
          // A generic role="status" is NOT a comparison error: the explorer
          // always announces its selected equipment with that role. Detect the
          // comparison by its own explicit affordances and wording instead.
          if (section.querySelector('.cahier-comparison-retry')) return 'error'
          const alert = [...section.querySelectorAll('[role=alert]')]
            .some((node) => /compar/i.test(node.textContent ?? ''))
          if (alert) return 'error'
          const busy = [...section.querySelectorAll('[aria-busy=true]')]
            .some((node) => /compar|référence|groupe/i.test(node.getAttribute('aria-label') ?? node.textContent ?? ''))
          const loading = /chargement[^.]*compar|compar[^.]*chargement/i.test(section.textContent ?? '')
          if (busy || loading) return 'loading'
          const text = section.textContent ?? ''
          if (/groupe comparé\s*:\s*indisponible|aucun groupe comparé/i.test(text)) return 'empty'
          if (/groupe comparé/i.test(text)) return 'shown'
          return 'absent'
        }, key)
        let result
        if (blocked.some((b) => b.key === key)) {
          result = { ...blocked.find((b) => b.key === key), comparisonState }
        } else {
          result = { ...await exportSection(key, territory), comparisonState }
        }
        if (result.status === 'absent' && !(EXPECTED_ABSENT[territoryType] ?? []).includes(key)) {
          gateFailures.push(`${territory}/${key}: absent but not expected absent`)
        }
        if (result.status === 'success' && result.audit?.hasIdentity === false) {
          gateFailures.push(`${territory}/${key}: success without territory identity in the PDF`)
        }
        gateResult(territory, key, result)
        results.push(result)
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
    interactions,
    origin,
    canonicalHost,
    at: new Date().toISOString(),
    pageErrors: pageErrors.slice(0, 30),
    expectedAbsent: EXPECTED_ABSENT,
    gateFailures,
    coverage,
    results,
  }
  // One aggregate receipt and one per territory, so every level's evidence
  // survives independently (including the two legitimately-absent région keys).
  for (const territory of territories) {
    const [t, c] = territory.split('/')
    const own = { ...receipt, territory, results: results.filter((result) => result.territory === territory),
      coverage: coverage.filter((entry) => entry.territory === territory) }
    await writeFile(path.join(outDir, `receipt-${t}-${c}.json`), JSON.stringify(own, null, 2))
  }
  const receiptPath = path.join(outDir, 'receipt.json')
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2))
  console.log('RECEIPT ' + receiptPath)
  await browser.close()
  if (gateFailures.length) {
    console.error('GATE FAILURES:\n' + gateFailures.join('\n'))
    process.exitCode = 1
  }
}
