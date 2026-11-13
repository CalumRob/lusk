import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// #997 — real-browser proof of the page-2 compared protected/shared mean stack.
// The fixture is the current app fixture contract, never a live API claim. The
// check mounts the real Vue component through Vite, asserts the pale role marks,
// their additive heights, the honest mismatch note and the absence of overflow
// at the mobile widths the Cahier must hold.
// Run: npm run verify:network-means. If Playwright has no cached browser, run
// `npx playwright-core install chromium` or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.
const appRoot = process.cwd()
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const WIDTHS = [320, 360, 760, 1440]

const server = await createServer({
  configFile: resolve(appRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
let browser
const receipt = { widths: [], mismatch: null }

try {
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 900 } })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => {
      document.querySelectorAll('[data-network-means-fixture]').forEach((node) => node.remove())
      const root = document.createElement('div')
      root.dataset.networkMeansFixture = 'coherent'
      root.style.marginInline = 'var(--grid-margin-mobile)'
      document.body.append(root)
    })
    await page.evaluate(async (url) => {
      const fixture = await import(url)
      const root = document.querySelector('[data-network-means-fixture="coherent"]')
      if (!root) throw new Error('network means fixture root missing')
      await fixture.mountMobiliteNetworkMeans(root, 'coherent')
    }, new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
    const measured = await page.evaluate(() => {
      const root = document.querySelector('[data-network-means-fixture="coherent"]')
      const figure = root?.querySelector('.mobilite-comparison-bars')
      const svg = figure?.querySelector('svg[role="img"]')
      const group = figure?.querySelector('g[data-comparison="bike"]')
      const segments = group ? [...group.querySelectorAll('rect[data-comparison-segment]')] : []
      if (!root || !figure || !svg || !group) throw new Error('coherent mean comparison fixture incomplete')
      const figureBounds = figure.getBoundingClientRect()
      const bounds = segments.map((segment) => segment.getBoundingClientRect())
      return {
        width: innerWidth,
        segmentCount: segments.length,
        segmentKeys: segments.map((segment) => segment.getAttribute('data-comparison-segment')),
        fills: segments.map((segment) => segment.getAttribute('fill')),
        heights: segments.map((segment) => Number(segment.getAttribute('height'))),
        aria: svg.getAttribute('aria-label'),
        overflow: bounds.some((rect) => rect.left < figureBounds.left - 1 ||
          rect.right > figureBounds.right + 1 || rect.top < figureBounds.top - 1 ||
          rect.bottom > figureBounds.bottom + 1),
      }
    })
    assert.equal(measured.segmentCount, 2, `two compared role marks at ${width}px`)
    assert.deepEqual(measured.segmentKeys, ['protege_km_1000', 'partage_km_1000'])
    assert(measured.fills[0].includes('var(--cahier-cycle-protected'), 'protected role ink')
    assert(measured.fills[1].includes('var(--cahier-cycle-shared'), 'shared role ink')
    assert(measured.heights.reduce((sum, height) => sum + height, 0) > 0,
      `compared stack is drawn at ${width}px`)
    assert(measured.aria.includes('Moyenne des communes de EPCI X'), 'mean statistic is named')
    assert.equal(measured.overflow, false, `compared marks stay inside the figure at ${width}px`)
    receipt.widths.push({ width, segments: measured.segmentCount,
      heights: measured.heights, overflow: measured.overflow })
  }

  await page.setViewportSize({ width: 760, height: 900 })
  await page.evaluate(() => {
    document.querySelectorAll('[data-network-means-fixture]').forEach((node) => node.remove())
    const root = document.createElement('div')
    root.dataset.networkMeansFixture = 'mismatch'
    root.style.marginInline = 'var(--grid-margin-mobile)'
    document.body.append(root)
  })
  await page.evaluate(async (url) => {
    const fixture = await import(url)
    const root = document.querySelector('[data-network-means-fixture="mismatch"]')
    if (!root) throw new Error('mismatch fixture root missing')
    await fixture.mountMobiliteNetworkMeans(root, 'mismatch')
  }, new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
  receipt.mismatch = await page.evaluate(() => {
    const root = document.querySelector('[data-network-means-fixture="mismatch"]')
    const figure = root?.querySelector('.mobilite-comparison-bars')
    if (!root || !figure) throw new Error('mismatch fixture incomplete')
    return {
      splitGroup: Boolean(figure.querySelector('g[data-comparison="bike"]')),
      comparisonRect: Boolean(figure.querySelector('rect[data-comparison="bike"]')),
      segments: figure.querySelectorAll('rect[data-comparison-segment]').length,
      note: figure.textContent.includes('ne portent pas les mêmes communes'),
      aria: figure.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? '',
    }
  })
  assert.equal(receipt.mismatch.splitGroup, false, 'mismatch never draws a compared stack')
  assert.equal(receipt.mismatch.comparisonRect, true, 'mismatch keeps the honest unsegmented total')
  assert.equal(receipt.mismatch.segments, 0, 'mismatch draws no pale role marks')
  assert.equal(receipt.mismatch.note, true, 'mismatch states the split is unavailable')
  assert(receipt.mismatch.aria.includes('ne portent pas les mêmes communes'),
    'mismatch note is in the accessible reading')

  console.log(JSON.stringify({ proof: 'network-means', fixture: 'app-fixture', receipt }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
