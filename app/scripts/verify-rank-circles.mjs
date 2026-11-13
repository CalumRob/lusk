import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// #1004 — real-browser proof of the shared extreme-rank outline.
// The owner's symptom is a layout jump around a rank that gains or loses its
// hand-drawn circle, plus circles that only appeared on fact-backed ranks. This
// verifier mounts the production comparison mark and the production tooltip
// through Vite, then measures the real boxes at mobile and desktop widths:
//   - circled and uncircled ranks allocate exactly the same layout;
//   - the outline is a non-layout overlay that is not clipped and does not
//     overlap the value line, the following copy, or the tooltip edge;
//   - a suppressed 1/1 or absent rank renders no rank and no circle;
//   - the real bars tooltip carries the outline after hover and after focus.
// Run: npm run verify:rank-circles. If Playwright has no cached browser, run
// `npx playwright-core install chromium` or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.
const appRoot = process.cwd()
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const evidenceDir = resolve(process.env.RANK_CIRCLE_EVIDENCE_DIR ?? join(tmpdir(), 'lusk-rank-circle-evidence'))
const WIDTHS = [390, 1440]
const TOOLTIP_WIDTHS = [320, 390, 1440]
const TOLERANCE = 0.5

const server = await createServer({
  configFile: resolve(appRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
let browser

/** A native fact carrying only the comparison fields the mark reads. */
function fact(position, size, ties) {
  return {
    key: 'stationnement_velo_par_voiture',
    detail: null,
    value: 0.3,
    unit: '%',
    availability: 'complete',
    provenance: null,
    comparisonBasis: 'territory-median',
    reason: null,
    comparison: {
      direction: 'plus-est-mieux',
      scope: { kind: 'communes-epci', label: 'communes de Rennes Métropole' },
      rank: { position, size, ...(ties === undefined ? {} : { ties }) },
      reference: { kind: 'median', value: 0.2 },
    },
  }
}

function servedRank(position, size, ties) {
  return { position, size, ...(ties === undefined ? {} : { ties }),
    direction: 'moins-est-mieux', key: 'bornes_ev_par_station_service' }
}

/** The named reference a served-rank-only mark (AEDAR scalars) is displayed with. */
function namedReference() {
  return { label: 'Moyenne du groupe comparé', value: 0.3, unit: '%' }
}

function close(actual, expected, label) {
  assert(Math.abs(actual - expected) <= TOLERANCE, `${label}: ${actual} vs ${expected}`)
}

function closeBox(actual, expected, label) {
  for (const key of ['top', 'left', 'width', 'height']) close(actual[key], expected[key], `${label}.${key}`)
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function inside(inner, outer) {
  return inner.top >= outer.top && inner.bottom <= outer.bottom &&
    inner.left >= outer.left && inner.right <= outer.right
}

try {
  await mkdir(evidenceDir, { recursive: true })
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  const fixtureUrl = new URL('src/__tests__/helpers/rankCircleBrowserFixture.ts', baseUrl).href
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error('[browser pageerror]', error))
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)

  const receipt = { inline: [], tooltip: [], production: null }

  const measureInline = () => page.evaluate(() => {
    const root = document.querySelector('[data-rank-circle-fixture="comparison"]')
    if (!root) throw new Error('comparison fixture missing')
    const rect = (selector) => {
      const element = root.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { top: box.top, left: box.left, width: box.width, height: box.height }
    }
    const rank = root.querySelector('.cahier-rank')
    const ink = rank?.querySelector('.cahier-rank-ink') ?? rank
    const inkBox = ink?.getBoundingClientRect()
    const pseudo = ink ? getComputedStyle(ink, '::before') : null
    const drawn = Boolean(pseudo && pseudo.content && pseudo.content !== 'none')
    const stroke = drawn && inkBox
      ? {
          top: inkBox.top + Number.parseFloat(pseudo.top),
          left: inkBox.left + Number.parseFloat(pseudo.left),
          right: inkBox.right - Number.parseFloat(pseudo.right),
          bottom: inkBox.bottom - Number.parseFloat(pseudo.bottom),
        }
      : null
    const clippingAncestors = []
    for (let node = ink; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const box = node.getBoundingClientRect()
        clippingAncestors.push({ className: String(node.className),
          box: { top: box.top, left: box.left, right: box.right, bottom: box.bottom } })
      }
    }
    const value = root.querySelector('.cahier-figure-scalar-value')?.getBoundingClientRect()
    return {
      value: rect('.cahier-figure-scalar-value'),
      slot: rect('.cahier-comparison-value'),
      reference: rect('.cahier-comparison-value__reference'),
      note: rect('.rank-circle-fixture__note'),
      after: rect('.rank-circle-fixture__after'),
      rank: rank ? {
        text: rank.textContent,
        extreme: Boolean(ink?.classList.contains('is-extreme')),
        display: getComputedStyle(rank).display,
        padding: getComputedStyle(ink).padding,
        ariaHidden: rank.getAttribute('aria-hidden'),
        box: rect('.cahier-rank'),
      } : null,
      ink: inkBox ? { top: inkBox.top, left: inkBox.left, width: inkBox.width, height: inkBox.height } : null,
      stroke,
      drawn,
      clippingAncestors,
      valueBox: value ? { top: value.top, left: value.left, right: value.right, bottom: value.bottom } : null,
      referenceAria: root.querySelector('.cahier-comparison-value__reference')?.getAttribute('aria-label') ?? null,
    }
  })

  const mountInline = async (width, state) => {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => {
      document.querySelectorAll('[data-rank-circle-fixture="comparison"]').forEach((node) => node.remove())
      const root = document.createElement('div')
      root.dataset.rankCircleFixture = 'comparison'
      root.style.width = innerWidth <= 400 ? 'calc(100% - 32px)' : '340px'
      root.style.margin = '24px auto'
      document.body.append(root)
    })
    await page.evaluate(async ({ url, state }) => {
      const fixture = await import(url)
      const root = document.querySelector('[data-rank-circle-fixture="comparison"]')
      window.__rankCircleControl = await fixture.mountRankCircleComparison(root, state)
    }, { url: fixtureUrl, state })
    await page.evaluate(() => document.fonts.ready)
  }

  const updateInline = async (patch) => {
    await page.evaluate(async (patch) => { await window.__rankCircleControl.update(patch) }, patch)
  }

  for (const width of WIDTHS) {
    // Same text width on purpose: "3e/41" (extreme, edge = ceil(41 * 5 %) = 3)
    // versus "4e/41" (middle) — only the circle state differs.
    await mountInline(width, { fact: fact(3, 41), servedRank: null, namedReference: null, status: 'ready' })
    const circled = await measureInline()
    assert.equal(circled.rank?.extreme, true, `extreme rank is circled at ${width}px`)
    assert.equal(circled.rank?.ariaHidden, 'true', 'circled rank stays decorative inside the labelled reference')
    assert(circled.drawn, `outline is drawn at ${width}px`)
    assert(circled.referenceAria?.includes('3e/41'), 'accessible name carries the same rank')
    assert(!intersects(circled.stroke, circled.valueBox), `outline does not touch the value line at ${width}px`)
    for (const ancestor of circled.clippingAncestors) {
      assert(inside(circled.stroke, {
        top: ancestor.box.top + 0.5, left: ancestor.box.left + 0.5,
        right: ancestor.box.right - 0.5, bottom: ancestor.box.bottom - 0.5,
      }), `outline is not clipped by ${ancestor.className} at ${width}px`)
    }

    await updateInline({ fact: fact(4, 41) })
    const plain = await measureInline()
    assert.equal(plain.rank?.extreme, false, `middle rank is not circled at ${width}px`)
    assert.equal(plain.drawn, false, `no outline on a middle rank at ${width}px`)
    assert.equal(plain.rank?.text, '4e/41')
    for (const selector of ['value', 'slot', 'reference', 'note', 'after', 'ink']) {
      closeBox(circled[selector], plain[selector], `${selector} at ${width}px (circled vs uncircled)`)
    }
    assert.equal(circled.rank.display, plain.rank.display, 'the circle never changes display')
    assert.equal(circled.rank.padding, plain.rank.padding, 'the circle never changes padding')
    assert.equal(circled.rank.box.height, plain.rank.box.height, 'the circle never changes the rank line box')

    // A rank appearing (loading -> ready) is one honest content change; once the
    // rank is present, gaining the circle moves nothing at all.
    await updateInline({ status: 'loading', fact: null, servedRank: null, namedReference: null })
    const loading = await measureInline()
    assert.equal(loading.rank, null, 'no rank while the comparison loads')
    await updateInline({ status: 'ready', fact: fact(2, 41) })
    const appeared = await measureInline()
    assert.equal(appeared.rank?.extreme, true, 'arriving extreme rank is circled')
    closeBox(appeared.slot, loading.slot, `comparison slot stays allocated at ${width}px`)
    await updateInline({ fact: fact(3, 41) })
    const still = await measureInline()
    closeBox(still.rank.box, appeared.rank.box, `circled rank keeps its box at ${width}px`)
    closeBox(still.after, appeared.after, `following copy stays put at ${width}px`)

    // A served-rank-only rank (AEDAR scalars) now follows the same rule.
    await updateInline({ fact: null, servedRank: servedRank(1, 41), namedReference: namedReference(), status: 'ready' })
    const servedExtreme = await measureInline()
    assert.equal(servedExtreme.rank?.text, '1er/41', 'served rank text is unchanged')
    assert.equal(servedExtreme.rank?.extreme, true, `served extreme rank is circled at ${width}px`)
    assert(servedExtreme.drawn, `served rank outline is drawn at ${width}px`)
    await updateInline({ servedRank: servedRank(20, 41) })
    const servedMiddle = await measureInline()
    assert.equal(servedMiddle.rank?.extreme, false, 'served middle rank stays uncircled')
    for (const selector of ['value', 'slot', 'reference', 'note', 'after', 'ink']) {
      closeBox(servedExtreme[selector], servedMiddle[selector], `${selector} at ${width}px (served rank)`)
    }

    // Ties keep the shared "=" marker and the circle follows the same input.
    await updateInline({ servedRank: servedRank(1, 41, 3) })
    const tied = await measureInline()
    assert.equal(tied.rank?.text, '=1er/41', 'tie marker is preserved')
    assert.equal(tied.rank?.extreme, true, 'tied extreme rank is circled')
    assert(tied.referenceAria?.includes('1er/41 (ex æquo)'), 'accessible name keeps the spoken tie form')

    // A singleton or absent rank renders nothing, and no circle survives.
    await updateInline({ servedRank: servedRank(1, 1) })
    const suppressed = await measureInline()
    assert.equal(suppressed.rank, null, 'a 1/1 rank is suppressed, not circled')
    assert.equal(suppressed.drawn, false, 'no stale outline after suppression')
    await updateInline({ servedRank: null, fact: null, namedReference: null })
    const absent = await measureInline()
    assert.equal(absent.rank, null, 'an absent rank renders nothing')
    assert.equal(absent.drawn, false, 'no outline without a rank')

    await page.screenshot({ path: resolve(evidenceDir, `rank-circle-inline-${width}.png`) })
    receipt.inline.push({ width, circled: { rank: circled.rank, stroke: circled.stroke },
      plain: { rank: plain.rank }, appearedAfter: appeared.after, suppressedAfter: suppressed.after })
  }

  const measureTooltip = () => page.evaluate(() => {
    const root = document.querySelector('[data-rank-circle-fixture="tooltip"]')
    if (!root) throw new Error('tooltip fixture missing')
    const tooltip = root.querySelector('.cahier-figure-tooltip')
    if (!tooltip) throw new Error('tooltip missing')
    const rank = tooltip.querySelector('.cahier-figure-tooltip-comparison-rank')
    const value = tooltip.querySelector('.cahier-figure-tooltip-comparison-value')
    const tooltipBox = tooltip.getBoundingClientRect()
    const rankBox = rank?.getBoundingClientRect()
    const valueBox = value?.getBoundingClientRect()
    const pseudo = rank ? getComputedStyle(rank, '::before') : null
    const drawn = Boolean(pseudo && pseudo.content && pseudo.content !== 'none')
    const stroke = drawn && rankBox
      ? { top: rankBox.top + Number.parseFloat(pseudo.top), left: rankBox.left + Number.parseFloat(pseudo.left),
          right: rankBox.right - Number.parseFloat(pseudo.right), bottom: rankBox.bottom - Number.parseFloat(pseudo.bottom) }
      : null
    return {
      tooltip: { top: tooltipBox.top, left: tooltipBox.left, width: tooltipBox.width, height: tooltipBox.height },
      rank: rank ? {
        text: rank.textContent,
        box: { top: rankBox.top, left: rankBox.left, width: rankBox.width, height: rankBox.height },
        role: rank.getAttribute('role'),
        ariaLabel: rank.getAttribute('aria-label'),
        ariaHidden: rank.getAttribute('aria-hidden'),
        padding: getComputedStyle(rank).padding,
      } : null,
      valueBox: valueBox ? { top: valueBox.top, left: valueBox.left, right: valueBox.right, bottom: valueBox.bottom } : null,
      rowAria: tooltip.querySelector('.cahier-figure-tooltip-row')?.getAttribute('aria-label') ?? null,
      drawn,
      stroke,
    }
  })

  const mountTooltip = async (width, position, size, ties) => {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => {
      document.querySelectorAll('[data-rank-circle-fixture="tooltip"]').forEach((node) => node.remove())
      const root = document.createElement('div')
      root.dataset.rankCircleFixture = 'tooltip'
      root.style.position = 'relative'
      root.style.width = innerWidth <= 400 ? 'calc(100% - 32px)' : '280px'
      root.style.height = '180px'
      root.style.margin = '24px auto'
      document.body.append(root)
    })
    await page.evaluate(async ({ url, position, size, ties }) => {
      const fixture = await import(url)
      const root = document.querySelector('[data-rank-circle-fixture="tooltip"]')
      await fixture.mountRankCircleTooltip(root, fixture.rankCircleTooltipRows(position, size, ties))
    }, { url: fixtureUrl, position, size, ties })
    await page.evaluate(() => document.fonts.ready)
  }

  for (const width of TOOLTIP_WIDTHS) {
    await mountTooltip(width, 1, 41)
    const circled = await measureTooltip()
    assert.equal(circled.rank?.text, '1er/41', `tooltip rank text is unchanged at ${width}px`)
    assert.equal(circled.drawn, true, `tooltip outline is drawn at ${width}px`)
    assert.equal(circled.rank?.role, null, 'the outline adds no second role=img announcement')
    assert.equal(circled.rank?.ariaLabel, null, 'the outline adds no second rank label')
    assert.equal(circled.rank?.ariaHidden, null, 'the outline keeps the existing exposure')
    assert.equal((circled.rowAria?.match(/1er\/41/gu) ?? []).length, 1, 'one rank mention per tooltip row')
    assert(!intersects(circled.stroke, circled.valueBox), `tooltip outline does not touch the compared value at ${width}px`)
    const border = { top: circled.tooltip.top, left: circled.tooltip.left,
      right: circled.tooltip.left + circled.tooltip.width, bottom: circled.tooltip.top + circled.tooltip.height }
    assert(inside(circled.stroke, border), `tooltip outline stays inside the tooltip box at ${width}px`)

    await mountTooltip(width, 20, 41)
    const plain = await measureTooltip()
    assert.equal(plain.drawn, false, `no tooltip outline on a middle rank at ${width}px`)
    assert.equal(plain.rank?.padding, circled.rank?.padding, 'the tooltip rank box is identical circled or not')
    close(plain.tooltip.height, circled.tooltip.height, `tooltip height at ${width}px`)
    await page.screenshot({ path: resolve(evidenceDir, `rank-circle-tooltip-${width}.png`) })
    receipt.tooltip.push({ width, circled: { rank: circled.rank, stroke: circled.stroke },
      plain: { rank: plain.rank }, tooltip: circled.tooltip })
  }

  // Production path: the real bars figure opens the tooltip on hover and on
  // keyboard focus, and the served extreme rank carries the same outline.
  await page.setViewportSize({ width: 760, height: 900 })
  await page.evaluate(() => {
    document.querySelectorAll('[data-rank-circle-fixture]').forEach((node) => node.remove())
    const root = document.createElement('div')
    root.dataset.rankCircleFixture = 'bars'
    root.style.width = '560px'
    root.style.margin = '24px auto'
    document.body.append(root)
  })
  await page.evaluate(async (url) => {
    const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', url).href)
    const root = document.querySelector('[data-rank-circle-fixture="bars"]')
    await fixture.mountMobiliteNetworkMeans(root, 'coherent')
  }, baseUrl)
  const readBarsTooltip = () => page.evaluate(() => {
    const root = document.querySelector('[data-rank-circle-fixture="bars"]')
    const rank = root?.querySelector('.cahier-figure-tooltip-comparison-rank')
    if (!root || !rank) return null
    const box = rank.getBoundingClientRect()
    const pseudo = getComputedStyle(rank, '::before')
    return { text: rank.textContent,
      extreme: rank.classList.contains('is-extreme'),
      drawn: Boolean(pseudo.content && pseudo.content !== 'none'),
      box: { top: box.top, left: box.left, width: box.width, height: box.height } }
  })
  const hitbox = page.locator('[data-rank-circle-fixture="bars"] .mobilite-comparison-bars__hitbox').first()
  await hitbox.hover()
  await page.waitForFunction(() => Boolean(document.querySelector('[data-rank-circle-fixture="bars"] .cahier-figure-tooltip-comparison-rank')))
  const hovered = await readBarsTooltip()
  assert.equal(hovered?.text, '1er/2', 'production tooltip keeps the served rank text')
  assert.equal(hovered?.drawn, true, 'production tooltip circles the extreme served rank')
  await page.mouse.move(0, 0)
  await hitbox.focus()
  await page.waitForFunction(() => Boolean(document.querySelector('[data-rank-circle-fixture="bars"] .cahier-figure-tooltip-comparison-rank')))
  const focused = await readBarsTooltip()
  assert.equal(focused?.drawn, true, 'keyboard focus exposes the same circled rank')
  receipt.production = { hovered, focused }

  console.log(JSON.stringify({ proof: 'rank-circles', fixture: 'app-fixture', receipt }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
