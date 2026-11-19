#!/usr/bin/env node
/**
 * Bounded browser harness for the shared Cahier PDF (#1024).
 *
 * Builds only the test-only fixture page into an external directory, serves it
 * on a private strict port, uses the locally installed Playwright Chromium to
 * generate real PDFs with the production font/asset loader, and cleans the
 * server up. It never starts the user's stopped preview/prototype UI and never
 * touches the application build.
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright-core'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = process.env.CAHIER_PDF_EVIDENCE_DIR || 'E:/Temp/opencode/1024-evidence/sol-medium/browser'
const distDir = path.join(evidenceDir, 'dist')
const port = Number(process.env.CAHIER_PDF_PORT || 5199)
const keys = [
  'aedar-car-overview',
  'aedar-diversity-loss',
  'aedar-access',
  'aedar-equipment-profile',
  'aedar-equipment-explorer',
  'reseaux',
  'stationnement-ravitaillement',
  'couverture-du-territoire',
  'visiter-la-bretagne',
  'dense-curve',
  'dense-curve-gaps',
  'dense-share',
  'dense-ramp',
  'dense-bars',
  'dense-waffle',
  'populated-comparison',
  'ranks-compact',
  'two-tables-ranks',
]

await rm(evidenceDir, { recursive: true, force: true })
await mkdir(evidenceDir, { recursive: true })

await build({
  root: appDir,
  configFile: false,
  plugins: [vue()],
  resolve: { alias: { '@': path.join(appDir, 'src') } },
  build: {
    outDir: distDir,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: path.join(appDir, 'scripts/cahier-pdf-browser-probe.html'),
    },
  },
})

// Bounded 2x2 PNG, not a screenshot or an external production acquisition.
const fixturePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGNMmXbiPwMDAwMTiABhACnkAsXTOyC6AAAAAElFTkSuQmCC', 'base64')
await writeFile(path.join(distDir, 'cahier-pdf-fixture-map.png'), fixturePng)
await writeFile(path.join(distDir, 'cahier-pdf-bad-map.png'), 'not-a-real-png')

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'index.html'
  const file = path.resolve(distDir, rel)
  if (!file.startsWith(distDir + path.sep) && file !== distDir) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  try {
    const body = await readFile(file)
    res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end('not found')
  }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })

let browser
try {
  const candidates = [
    process.env.CAHIER_PDF_CHROMIUM,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1248/chrome-win/chrome.exe'),
  ].filter(Boolean)
  let executablePath
  for (const candidate of candidates) {
    try {
      await readFile(candidate)
      executablePath = candidate
      break
    } catch { /* try next */ }
  }
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  const assetResponses = []
  const badResponses = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (message.text().includes('missing-cahier-map.png')) return
    if (message.text().includes('Failed to load resource')) return
    errors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('missing-cahier-map.png')) {
      badResponses.push({ url: response.url(), status: response.status() })
    }
    if (response.url().includes('cahier-pdf-fixture-map.png')) {
      assetResponses.push({ url: response.url(), status: response.status() })
    }
  })
  const probe = (await (await import('node:fs/promises')).readdir(distDir, { recursive: true }))
    .find((entry) => entry.endsWith('cahier-pdf-browser-probe.html'))
  await page.goto(`http://127.0.0.1:${port}/${probe.replaceAll('\\', '/')}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => typeof window.genererCahierPdf === 'function')
  const sourceColours = await page.evaluate(() => window.auditerCahierCouleurs())
  const strokeGrammar = await page.evaluate(() => window.auditerGrammaireTraitEcran())
  const lockupGap = process.env.CAHIER_PDF_SKIP_LOCKUP_GAP
    ? null
    : await page.evaluate(() => window.auditerEcartMarque())

  const report = []
  for (const key of keys) {
    const desktop = await page.evaluate((value) => window.genererCahierPdf(value), key)
    const desktopPath = path.join(evidenceDir, `${key}-desktop.pdf`)
    await writeFile(desktopPath, new Uint8Array(desktop.bytes))
    const desktopAudit = await auditer(desktopPath)
    report.push({
      key,
      host: 'desktop',
      ms: Math.round(desktop.ms),
      bytes: desktop.bytes.length,
      heap: desktop.heap ?? null,
      pages: desktopAudit.pages,
      texteHash: desktopAudit.texteHash,
      requestHash: desktop.requestHash,
      fileName: desktop.fileName,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = await page.evaluate((value) => window.genererCahierPdf(value), key)
    const mobilePath = path.join(evidenceDir, `${key}-mobile.pdf`)
    await writeFile(mobilePath, new Uint8Array(mobile.bytes))
    const mobileAudit = await auditer(mobilePath)
    if (mobileAudit.texteHash !== desktopAudit.texteHash || mobileAudit.pages !== desktopAudit.pages) {
      throw new Error(`Host width changed the document grammar: ${key}`)
    }
    report.push({
      key,
      host: 'mobile',
      ms: Math.round(mobile.ms),
      bytes: mobile.bytes.length,
      heap: mobile.heap ?? null,
      pages: mobileAudit.pages,
      texteHash: mobileAudit.texteHash,
      sameTextAsDesktop: mobileAudit.texteHash === desktopAudit.texteHash,
      requestHash: mobile.requestHash,
      fileName: mobile.fileName,
    })
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  const assetFailure = await page.evaluate(async () => {
    try {
      await window.genererCahierPdfAvecCarte('/missing-cahier-map.png')
      return 'no-error'
    } catch (error) {
      return { name: error.name, code: error.code }
    }
  })
  const cancel = await page.evaluate(async () => {
    try {
      await window.genererCahierPdfAnnule('aedar-access')
      return 'no-error'
    } catch (error) {
      return { name: error.name, code: error.code }
    }
  })
  const badBytes = await page.evaluate(async () => {
    try {
      await window.genererCahierPdfAvecCarte('/cahier-pdf-bad-map.png')
      return 'no-error'
    } catch (error) {
      return { name: error.name, code: error.code }
    }
  })
  const decoded = await page.evaluate(() => window.__cahierDerniereImage ?? null)
  const cancelDuringDecode = await page.evaluate(async () => {
    try { await window.genererCahierPdfAnnulePendantDecodage(); return 'no-error' }
    catch (error) { return { name: error.name, code: error.code } }
  })
  const cleanup = await page.evaluate(() => window.__cahierImages)
  if (assetFailure.code !== 'asset') {
    throw new Error(`Map failure was not typed as asset: ${JSON.stringify(assetFailure)}`)
  }
  if (cancel.name !== 'AbortError' || cancelDuringDecode.name !== 'AbortError') {
    throw new Error(`Cancellation was not typed as AbortError: ${JSON.stringify({ cancel, cancelDuringDecode })}`)
  }
  if (badBytes.code !== 'asset') {
    throw new Error(`Bad image bytes were not typed as asset: ${JSON.stringify(badBytes)}`)
  }
  if (!assetResponses.some((response) => response.status === 200)) {
    throw new Error('The default image loader never fetched the served test asset.')
  }
  if (!decoded || decoded.width !== 2 || decoded.height !== 2 || cleanup.created !== cleanup.closed) {
    throw new Error(`The default image decoder did not produce dimensions: ${JSON.stringify(decoded)}`)
  }
  if (badResponses.length) {
    throw new Error(`Unexpected HTTP failures: ${JSON.stringify(badResponses)}`)
  }
  await writeFile(path.join(evidenceDir, 'report.json'), JSON.stringify({
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appDir, encoding: 'utf8' }).trim(),
    errors,
    badResponses,
    assetResponses,
    assetFailure,
    badBytes,
    cancel,
    decoded,
    cancelDuringDecode,
    cleanup,
    sourceColours,
    strokeGrammar,
    lockupGap,
    report,
  }, null, 2))
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
  console.log(`Generated ${report.length} browser PDFs in ${evidenceDir}`)

async function auditer(chemin) {
  const data = new Uint8Array(await readFile(chemin))
  const pdf = await getDocument({ data: Uint8Array.from(data) }).promise
  let texte = ''
  let imageCount = 0
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const nativePage = await pdf.getPage(page)
    const content = await nativePage.getTextContent()
    texte += content.items.map((item) => item.str ?? '').join(' ')
    const operators = await nativePage.getOperatorList()
    let alpha = 1
    const stack = []
    for (let i = 0; i < operators.fnArray.length; i++) {
      const op = operators.fnArray[i]
      const args = operators.argsArray[i]
      if (op === OPS.save) stack.push(alpha)
      if (op === OPS.restore) alpha = stack.pop() ?? 1
      if (op === OPS.setGState) for (const [key, value] of args[0]) if (key === 'ca') alpha = value
      if (op === OPS.showText && alpha < .99) throw new Error(`Translucent text at ${chemin}:${page}: ${alpha}`)
      if (op === OPS.paintImageXObject) {
        imageCount++
        if (args[1] !== 2 || args[2] !== 2) throw new Error(`Unexpected embedded raster size: ${args}`)
      }
    }
  }
  if (/aedar-car-overview|aedar-diversity-loss|reseaux/.test(chemin) && !imageCount) throw new Error(`No decoded raster in ${chemin}`)
  return {
    pages: pdf.numPages,
    texteHash: createHash('sha256').update(texte).digest('hex'),
    texte,
  }
}
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
