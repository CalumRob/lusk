// Test-only child process: one headless Chromium, one in-memory Vite bundle,
// many PDF generations. Driven over newline-delimited JSON on stdin/stdout by
// cahierPdfNativeRuntime.ts. Uses the real production composer seam; the only
// raster is a labelled TEST-ONLY 2x2 PNG geometry stand-in.
import { build } from '../../../node_modules/vite/dist/node/index.js'
import vue from '../../../node_modules/@vitejs/plugin-vue/dist/index.mjs'
import { chromium } from '../../../node_modules/playwright-core/index.mjs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { existsSync } from 'node:fs'

// TEST-ONLY: a large solid PNG stand-in for captured map geometry. Its size is
// deliberate: a 2x2 image collapses the native CSS grid's max-content column,
// so it would not exercise the real mounted map layout at all. Not a map.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return table
})()
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, data, tail])
}
function solidPng(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const row = Buffer.alloc(1 + width * 4)
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = 0x2f; row[2 + x * 4] = 0x5e; row[3 + x * 4] = 0x55
    row[4 + x * 4] = 0xff
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const testRasterBase64 = solidPng(720, 720).toString('base64')

const root = path.resolve('app')
const entry = `
import '@fontsource-variable/manrope/index.css'
import '@fontsource-variable/newsreader/index.css'
import '@fontsource-variable/mozilla-headline/index.css'
import '@fontsource-variable/mozilla-text/index.css'
import '@fontsource-variable/fira-code/index.css'
import '@/styles/base.css'
import '@/styles/tokens.css'
import '@/styles/editorial.css'
import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
GlobalWorkerOptions.workerSrc = pdfWorkerUrl
window.__luskRender = async (bytes, scale, pageNumber) => {
  const doc = await getDocument({ data: Uint8Array.from(bytes) }).promise
  const page = await doc.getPage(pageNumber || 1)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  return canvas.toDataURL('image/png').split(',')[1]
}
window.__luskGenerate = async (request, options) => {
  for (const item of request?.capture?.capabilities?.maps?.items ?? []) {
    if (Array.isArray(item.bytes)) item.bytes = new Uint8Array(item.bytes).buffer
  }
  const controller = new AbortController()
  try {
    // No readAsset stub: the default reader must consume the bytes frozen in
    // the captured map items, exactly as production does.
    const result = await composerCahierPdf(request, {
      signal: controller.signal,
      urlAccueil: options.urlAccueil, urlPublique: options.urlPublique,
    })
    return { bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())), fileName: result.fileName }
  } catch (error) {
    return { error: { name: error && error.name, code: error && error.code, reason: error && error.reason, message: error && error.message,
      cause: error && error.cause && (error.cause.message || String(error.cause)) } }
  }
}
`
const virtualId = '\0lusk-pdf-native'
const out = await build({
  root, configFile: false, envFile: false, publicDir: false, logLevel: 'error',
  plugins: [vue(), { name: 'lusk-pdf-native', resolveId: (x) => x === 'lusk-pdf-native' ? virtualId : null,
    load: (x) => x === virtualId ? entry : null }],
  resolve: { alias: { '@': path.join(root, 'src') } },
  build: { write: false, emptyOutDir: false, assetsInlineLimit: 0, target: 'esnext',
    rollupOptions: { input: 'lusk-pdf-native' } },
})
const files = new Map(out.output.map((item) => [item.fileName,
  item.type === 'asset' ? item.source : item.code]))
const entryChunk = out.output.find((item) => item.type === 'chunk' && item.isEntry).fileName
const html = '<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="icon" href="data:,">' +
  [...files.keys()].filter((name) => name.endsWith('.css'))
    .map((name) => `<link rel="stylesheet" href="/${name}">`).join('') +
  `<body><div id="app"></div><script type="module" src="/${entryChunk}"></script>`

const candidates = [
  process.env.LUSK_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const executablePath = candidates.find((candidate) => existsSync(candidate))
if (!executablePath) {
  throw new Error(`Chrome introuvable pour les specs PDF natives. Définissez LUSK_CHROME_PATH (cherché : ${candidates.join(', ')})`)
}
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-crash-reporter', '--host-resolver-rules=MAP * ~NOTFOUND'],
})
const context = await browser.contexts()[0] ?? await browser.newContext({ viewport: { width: 1440, height: 900 } })
const origin = 'http://lusk-pdf-native.test'
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' }

async function generate(payload) {
  const page = await context.newPage()
  // TEST-ONLY: the DOM painter reads image pixels. Fixture images arrive from
  // interception, so mark them CORS-clean before the mounted section loads them.
  await page.addInitScript(() => {
    const create = document.createElement.bind(document)
    document.createElement = (tag, options) => {
      const element = create(tag, options)
      if (String(tag).toLowerCase() === 'img') element.setAttribute('crossorigin', 'anonymous')
      return element
    }
    const createNS = document.createElementNS.bind(document)
    document.createElementNS = (namespace, tag, options) => {
      const element = createNS(namespace, tag, options)
      if (String(tag).toLowerCase() === 'img') element.setAttribute('crossorigin', 'anonymous')
      return element
    }
  })
  page.on('pageerror', (error) => process.stderr.write(`pageerror: ${error.message}\n`))

  page.on('requestfailed', (request) => process.stderr.write(`requestfailed: ${request.url()} ${request.failure()?.errorText}\n`))
  try {
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) {
        // TEST-ONLY stand-in for captured map images that the mounted section
        // requests by its own owner URL. No network, no owner acquisition.
        if (route.request().resourceType() === 'image') {
          return route.fulfill({ contentType: 'image/png', body: Buffer.from(testRasterBase64, 'base64'),
            headers: { 'access-control-allow-origin': '*' } })
        }
        return route.abort()
      }
      if (!url.pathname || url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
      const body = files.get(url.pathname.slice(1))
      if (body === undefined) return route.fulfill({ status: 404 })
      const extension = url.pathname.slice(url.pathname.lastIndexOf('.'))
      return route.fulfill({ contentType: types[extension] ?? 'application/octet-stream',
        body: typeof body === 'string' ? body : body })
    })
    await page.goto(origin + '/')
    await page.waitForFunction(() => typeof window.__luskGenerate === 'function')
    for (const item of payload.request?.capture?.capabilities?.maps?.items ?? []) {
      if (item.bytes && Array.isArray(item.bytes.__luskBytes)) {
        // Playwright's evaluate cannot carry ArrayBuffer: pass plain bytes and
        // revive them inside the page before the production reader sees them.
        item.bytes = Array.from(new Uint8Array(item.bytes.__luskBytes))
      }
    }
    return await page.evaluate((input) => window.__luskGenerate(input.request, input.options), payload)
  } finally {
    await page.close()
  }
}

process.stdout.write('ready\n')
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    let id = -1
    try {
      const payload = JSON.parse(line)
      id = payload.id
      if (payload.kind === 'render') {
        const page = await context.newPage()
        try {
          await page.route('**/*', (route) => {
            const url = new URL(route.request().url())
            if (url.origin !== origin) return route.abort()
            if (!url.pathname || url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
            const body = files.get(url.pathname.slice(1))
            if (body === undefined) return route.fulfill({ status: 404 })
            const extension = url.pathname.slice(url.pathname.lastIndexOf('.'))
            return route.fulfill({ contentType: types[extension] ?? 'application/octet-stream',
              body: typeof body === 'string' ? body : body })
          })
          await page.goto(origin + '/')
          await page.waitForFunction(() => typeof window.__luskRender === 'function')
          const png = await page.evaluate((input) => window.__luskRender(input.bytes, input.scale, input.pageNumber),
            { bytes: payload.bytes, scale: payload.scale, pageNumber: payload.pageNumber })
          process.stdout.write(`${id}|${JSON.stringify({ png })}\n`)
        } finally { await page.close() }
      } else {
        const result = await generate(payload)
        process.stdout.write(`${id}|${JSON.stringify(result)}\n`)
      }
    } catch (error) {
      process.stdout.write(`${id}|${JSON.stringify({ error: { name: error.name, message: error.message } })}\n`)
    }
  }
})
process.stdin.on('end', async () => { await browser.close().catch(() => {}) })
