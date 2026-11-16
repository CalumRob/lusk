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
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { chromium } from 'playwright-core'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = 'E:/Temp/opencode/1024-evidence/browser'
const distDir = path.join(evidenceDir, 'dist')
const port = 5199
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
  'dense-share',
  'dense-ramp',
  'dense-bars',
  'dense-waffle',
]

await rm(evidenceDir, { recursive: true, force: true })
await mkdir(evidenceDir, { recursive: true })

await build({
  root: appDir,
  configFile: false,
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
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))

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
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const probe = (await (await import('node:fs/promises')).readdir(distDir, { recursive: true }))
    .find((entry) => entry.endsWith('cahier-pdf-browser-probe.html'))
  await page.goto(`http://127.0.0.1:${port}/${probe.replaceAll('\\', '/')}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => typeof window.genererCahierPdf === 'function')

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
      fileName: desktop.fileName,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = await page.evaluate((value) => window.genererCahierPdf(value), key)
    const mobilePath = path.join(evidenceDir, `${key}-mobile.pdf`)
    await writeFile(mobilePath, new Uint8Array(mobile.bytes))
    const mobileAudit = await auditer(mobilePath)
    report.push({
      key,
      host: 'mobile',
      ms: Math.round(mobile.ms),
      bytes: mobile.bytes.length,
      heap: mobile.heap ?? null,
      pages: mobileAudit.pages,
      texteHash: mobileAudit.texteHash,
      sameTextAsDesktop: mobileAudit.texteHash === desktopAudit.texteHash,
      fileName: mobile.fileName,
    })
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await writeFile(path.join(evidenceDir, 'report.json'), JSON.stringify({ errors, report }, null, 2))
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
  console.log(`Generated ${report.length} browser PDFs in ${evidenceDir}`)

async function auditer(chemin) {
  const data = new Uint8Array(await readFile(chemin))
  const pdf = await getDocument({ data: Uint8Array.from(data) }).promise
  let texte = ''
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    texte += content.items.map((item) => item.str ?? '').join(' ')
  }
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
