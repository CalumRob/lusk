import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

import { installApiRoutes, makeApiHandlers } from './overflow-api-routes.mjs'

/**
 * #1002 — quiet, repeatable browser receipt for AEDAR page-1 demand.
 *
 * One scenario, one fixture set, one response delay, one environment:
 *   1. landing: `/territoire/commune/35238?theme=mobilite` (AEDAR is the
 *      requested chapter) — records every semantic read-batch POST with its FULL
 *      semantic identity (resource, target, intent incl. statistic, coordinates
 *      incl. TYPEQU, projected fields) and its issue time, then clicks the REAL
 *      Sommaire link to page 2 and keeps recording.
 *   2. quiet landing: the same page without the click, to time first-useful and
 *      comparison-ready separately (they are different events and must not be
 *      conflated).
 *
 * Acceptance (asserted, so this is a gate and not a log):
 *   - no AEDAR page-1 batch (facts/detail/cells/aggregate comparison) STARTS
 *     after the Sommaire click; only requests already issued at click time settle
 *   - no exact duplicate semantic identity anywhere in the run
 *   - the requested page-2 chapter still lands its own 33 items in 3 POSTs
 *
 * The fixtures are the app's own producer-derived catalogue and native read
 * fixtures plus the audit's AEDAR shapes (40 aggregate readings, 235-TYPEQU core
 * projections, B207 detail chunks, 240 per-TYPEQU cells). This proves request
 * behaviour in a controlled local browser; it is not a live-latency claim.
 *
 * Run: npm run verify:aedar-demand
 */

const COMMUNAUTE = '/territoire/commune/35238?theme=mobilite'
const PAGE_TWO_LINK = 'a[href="#figure-partage-de-lespace-public"]'
const PAGE_THREE_LINK = 'a[href="#figure-offre-transports-commun"]'
/** The requested page-2 chapter's own resources (13 facts + their comparisons). */
const PAGE_TWO = ['reseaux', 'reseaux_par_habitant', 'surface_reseaux_routiers',
  'places_stationnement_velo_1000', 'places_stationnement_voiture_1000', 'stationnement_velo_par_voiture',
  'offre_cyclable', 'voitures_menage', 'bornes_recharge', 'bornes_ev_par_station_service',
  'bornes_recharge_1000', 'stations_service', 'stations_service_1000']
/** The page-3 chapter's own resources (4 resources, 7 items in one batch). */
const PAGE_THREE = ['offre_tc', 'raccordement_courbe', 'raccordement_tc', 'raccordement_reference']
const RESPONSE_DELAY_MS = 60
const SETTLE_AFTER_CLICK_MS = 2500
const PAGE_TWO_ITEMS = 33

const appRoot = process.cwd()

const server = await createServer({
  configFile: `${appRoot}/vite.config.ts`,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'error',
})
let browser
const receipt = { scenario: 'AEDAR page 1 -> Sommaire page 2', delayMs: RESPONSE_DELAY_MS }

function fullIdentity(item) {
  return JSON.stringify([item.resource, item.target ?? null, item.intent ?? null,
    item.coordinates ?? null, item.fields ? [...item.fields].sort() : null])
}

function classify(item) {
  if (item.resource === 'aedar_territory_summary') return 'summary'
  if (item.resource !== 'aedar_territorial_aggregate') return 'other'
  if (item.intent?.kind === 'facts') return (item.coordinates?.typequ?.length ?? 0) > 1 ? 'core' : 'detail'
  return (item.coordinates?.typequ?.length ?? 0) === 0 ? 'aggregate-comparison' : 'cell-comparison'
}

try {
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  const {
    nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture, nativeResources,
  } = await server.ssrLoadModule('/src/__tests__/helpers/semanticApiFixtures.ts')
  const { AEDAR_AGGREGATE_READING_KEYS, AEDAR_EXPLORER_DETAIL_MEASURE_KEYS } =
    await server.ssrLoadModule('/src/fiche/content/aedarTimeRampFacts.ts')
  const { AEDAR_TYPEQU_REGISTRY } = await server.ssrLoadModule('/src/fiche/content/aedarTypequRegistry.ts')

  const resources = new Map(nativeResources().map((resource) => [resource.resource_id, resource]))
  const aedarAggregate = resources.get('aedar_territorial_aggregate')
  assert(aedarAggregate?.measure_facets, 'AEDAR aggregate declaration must publish measure facets')
  const summaryResource = resources.get('aedar_territory_summary')
  assert(summaryResource?.measure_facets, 'AEDAR summary declaration must publish measure facets')
  const factsProbe = nativeReadFixture({ resource: 'aedar_territorial_aggregate',
    target: { kind: 'territory', type: 'commune', id: '35238' }, intent: { kind: 'facts' },
    coordinates: { typequ: [] } }, aedarAggregate)
  const clocks = {
    summary: 'receipt-aedar-summary-v1',
    aedar: factsProbe.content_version,
    reference: factsProbe.reference_content_version,
  }
  const source = {
    source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
    licence: 'ODbL', attribution: 'AEDAR', reference_date: '2026-01-01', publication_date: '2026-09-30',
  }
  const summaryReadings = Object.keys(summaryResource.measure_facets).map((measure) => ({
    measure, value: 3.5, status: 'available', n_typequ: AEDAR_TYPEQU_REGISTRY.length,
    n_addresses: 100, n_observed: 90, coverage_status: 'covered', statistic: 'direct', ...source,
  }))
  const comparisonRow = (item, measure) => ({
    typequ: (item.coordinates?.typequ ?? [])[0] ?? null, measure,
    comparison_context: item.intent.context, statistic: 'direct', group_value: 3.5,
    group_n_addresses: 100, group_n_observed: 90, group_coverage_status: 'covered',
    rank: 1, rank_size: 43, rank_ties: 1, direction: 'high', ...source,
  })
  const aedarData = (item) => {
    if (item.resource === 'aedar_territory_summary') {
      return { resource: item.resource, target: item.target,
        territory: { territory_type: item.target.type, territory_id: item.target.id },
        summary_content_version: clocks.summary, aedar_content_version: clocks.aedar,
        reference_content_version: clocks.reference, readings: summaryReadings }
    }
    if (item.intent?.kind !== 'facts') {
      return { resource: item.resource, target: item.target, content_version: 'receipt-aedar-comparison-v1',
        summary_content_version: clocks.summary, aedar_content_version: clocks.aedar,
        reference_content_version: clocks.reference,
        comparison: comparisonRow(item, item.coordinates.measure[0]) }
    }
    return nativeReadFixture(item, resources.get(item.resource))
  }

  /** One recorded semantic batch with its issue time and full item identities. */
  const batches = []
  const record = (items) => batches.push({ at: Date.now(), items })
  const delay = () => new Promise((resolve) => setTimeout(resolve, RESPONSE_DELAY_MS))
  const resourceKind = (id) => resources.get(id)?.resource_kind
  const familyForResource = (id) => {
    const declaration = resources.get(id)
    return declaration ? (declaration.shapes.includes('aedar_source_grain') ||
      declaration.shapes.includes('aedar_territory_summary') ? 'aedar' : 'scalar') : undefined
  }

  const makePage = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => console.error('[browser pageerror]', error))
    const readCalls = { retiredThemeFactsRoutes: 0, themeBatches: 0, aedarBatches: 0,
      aedarSummaryBatches: 0, aedarSummaryTargets: [], aedarComparisonBatches: 0, aedarItems: [] }
    await installApiRoutes(page, makeApiHandlers({
      catalogue: () => nativeCatalogueResponse(),
      resourceKind,
      familyForResource,
      themeBatch: ({ items }) => {
        record(items)
        // `makeApiHandlers` awaits `.json()`; keep the fixture synchronous and
        // apply the shared response delay inside it.
        return { json: async () => {
          await delay()
          return nativeBatchResponse(items, (item, resource) => {
            const data = nativeReadFixture(item, resource, { syntheticProfileComparisons: true })
            // #1008 — the live page-3 coverage fact and its displayed median:
            // the fixture shape is unchanged, only the published value is pinned
            // so the browser proof asserts the real reading (99,6 %).
            if (item.resource === 'offre_tc' && item.intent?.kind === 'facts') {
              if ('value' in data) data.value = 0.9957355031616097
              const focal = data.observations?.find((row) =>
                row.territory?.id === item.target?.id && row.territory?.type === item.target?.type)
              if (focal) focal.value = 0.9957355031616097
            }
            if (item.resource === 'offre_tc' && item.intent?.kind !== 'facts' && data.result) {
              data.result.median = 0.841743662639185
              data.result.rank = 3
              data.result.rank_size = 43
              data.result.selected_member_count = 43
              data.result.eligible_count = 43
            }
            return data
          }).json()
        } }
      },
      aedarBatch: ({ items }) => {
        record(items)
        return { json: async () => {
          await delay()
          return { results: items.map((item) => ({ id: item.id, resource: item.resource,
            status: 'available', data: aedarData(item) })) }
        } }
      },
      readCalls,
    }))
    return page
  }

  /** A visible AEDAR value means the requested chapter is useful. */
  const waitUseful = (page) => page.waitForFunction(() => {
    const section = document.querySelector('[data-section="aedar-car-overview"]')
    if (!section) return false
    return /209|3,5|3\.5/.test(section.textContent ?? '') ||
      section.querySelector('.summary-metrics') !== null
  }, null, { timeout: 30000 })

  /** A served rank on the comparison marks means the comparison is ready. */
  const waitComparisonReady = (page) => page.waitForFunction(() => {
    const section = document.querySelector('[data-section="aedar-car-overview"]')
    if (!section) return false
    if (section.querySelector('.cahier-comparison-value') !== null) return true
    return /\/\s*43|1er\s*\/\s*43/.test(section.textContent ?? '')
  }, null, { timeout: 30000 })

  /**
   * #1008 — natural scroll only: real wheel events over the content, no
   * scrollIntoView, no hash change. The wheel direction is corrected from the
   * target's actual position, so a long page cannot overshoot and then run away
   * from the chapter; the app's own IntersectionObserver owns admission.
   */
  const wheelToPage = async (page, selector, maxSteps = 80) => {
    await page.mouse.move(720, 450)
    for (let step = 0; step < maxSteps; step += 1) {
      const position = await page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.bottom < window.innerHeight * 0.15) return -1
        if (rect.top > window.innerHeight * 0.55) return 1
        return 0
      }).catch(() => 0)
      if (position === 0) return true
      await page.mouse.wheel(0, position * 350)
      await page.waitForTimeout(100)
    }
    return false
  }

  /** The page is in the band; wheel a little more until its content is visible. */
  const wheelUntilVisible = async (page, selector, maxSteps = 60) => {
    await page.mouse.move(720, 450)
    const viewportHeight = page.viewportSize()?.height ?? 900
    for (let step = 0; step < maxSteps; step += 1) {
      const box = await page.locator(selector).first().boundingBox().catch(() => null)
      if (box) {
        if (box.y < viewportHeight * 0.55 && box.y + box.height > viewportHeight * 0.15) return true
        await page.mouse.wheel(0, box.y < viewportHeight * 0.15 ? -300 : 300)
      } else {
        // Not rendered yet (data-backed figure): keep moving down to it.
        await page.mouse.wheel(0, 300)
      }
      await page.waitForTimeout(100)
    }
    return Boolean(await page.locator(selector).first().boundingBox().catch(() => null))
  }

  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })

  // Pass 1 — navigation while page-1 work is in flight (the audit scenario).
  const page = await makePage()
  const startedAt = Date.now()
  await page.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}`, { waitUntil: 'domcontentloaded' })
  await page.locator('#section-aedar-car-overview').waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('#section-aedar-equipment-explorer').waitFor({ state: 'visible', timeout: 30000 })
  // The explorer's per-TYPEQU cell comparison is the page-1 read the audit saw
  // running after the Sommaire click: leave once it is genuinely in flight, so
  // most of its 20 bounded batches are still queued.
  const waitForCellRead = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (batches.some((batch) => batch.items.some((item) => classify(item) === 'cell-comparison'))) return true
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return false
  }
  assert(await waitForCellRead(30000), 'scenario not exercised: the explorer cell comparison never started')
  const cellBatchesAtClick = batches.filter((batch) => batch.items.some((item) => classify(item) === 'cell-comparison')).length
  const clickAt = Date.now() - startedAt
  await page.locator(PAGE_TWO_LINK).first().click()
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
  const atClick = batches.length
  await page.evaluate((wait) => new Promise((resolve) => setTimeout(resolve, wait)), SETTLE_AFTER_CLICK_MS)
  const afterClick = batches.length
  await page.locator('[data-section="mobilite-reseaux"], .mobilite-comparison-bars').first()
    .waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined)
  // The requested page-2 chapter's own demand (13 facts + 20 displayed
  // comparisons). It may legitimately have been acquired on page-1 entry — the
  // audit's "numeric planner" — so it is counted over the whole run.
  const pageTwoBatches = batches.filter((batch) => batch.items.some((item) =>
    PAGE_TWO.includes(item.resource) && item.intent?.kind !== 'facts'))
  const pageTwoVisible = await page.locator('.mobilite-comparison-bars').first()
    .isVisible().catch(() => false)

  const aedarBatches = batches.filter((batch) => batch.items.some((item) =>
    String(item.resource).startsWith('aedar_')))
  const byShape = (predicate) => aedarBatches.filter((batch) => batch.items.some(predicate))
  const shape = {
    core: byShape((item) => classify(item) === 'core'),
    detail: byShape((item) => classify(item) === 'detail'),
    'aggregate-comparison': byShape((item) => classify(item) === 'aggregate-comparison'),
    'cell-comparison': byShape((item) => classify(item) === 'cell-comparison'),
  }
  const startedAfterClick = batches.slice(atClick).filter((batch) => batch.items.some((item) =>
    String(item.resource).startsWith('aedar_')))
  const identities = aedarBatches.flatMap((batch) => batch.items.map(fullIdentity))
  const duplicates = [...new Set(identities.filter((key, index) => identities.indexOf(key) !== index))]
  const pageTwoItems = pageTwoBatches.flatMap((batch) => batch.items)

  receipt.navigation = {
    clickAtMs: clickAt,
    cellBatchesAtClick,
    batchesAtClick: atClick,
    batchesAfterSettle: afterClick,
    aedarBatchesStartedAfterClick: startedAfterClick.length,
    aedarBatchesStartedAfterClickShapes: startedAfterClick.map((batch) => classify(batch.items[0])),
    aedarBatchesByShape: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.length])),
    aedarBatchTotal: aedarBatches.length,
    cellItems: shape['cell-comparison'].flatMap((batch) => batch.items).length,
    detailItems: shape.detail.flatMap((batch) => batch.items).length,
    coreTypequ: new Set(shape.core.flatMap((batch) => batch.items)
      .flatMap((item) => item.coordinates?.typequ ?? [])).size,
    pageTwoPosts: pageTwoBatches.length,
    pageTwoItems: pageTwoItems.length,
    pageTwoVisible,
    duplicateIdentities: duplicates.length,
    duplicateSample: duplicates.slice(0, 3),
  }
  await page.close()

  // Pass 2 — quiet landing: first-useful and comparison-ready, measured apart.
  const quietStartIndex = batches.length
  const quiet = await makePage()
  const quietStart = Date.now()
  await quiet.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}`, { waitUntil: 'domcontentloaded' })
  await waitUseful(quiet)
  const firstUsefulAt = Date.now() - quietStart
  try {
    await waitComparisonReady(quiet)
  } catch (error) {
    console.error('COMPARISON-NOT-READY', (await quiet.locator('#section-aedar-car-overview').innerText()).slice(0, 1200))
    throw error
  }
  const comparisonReadyAt = Date.now() - quietStart
  // The explorer's per-TYPEQU cells belong to the demanded page-1 evidence: on a
  // quiet landing every one of them (and its intended measure) is requested.
  const cellsDeadline = Date.now() + 30000
  while (Date.now() < cellsDeadline) {
    const cells = batches.slice(quietStartIndex).flatMap((batch) => batch.items)
      .filter((item) => classify(item) === 'cell-comparison')
    if (new Set(cells.map((item) => item.coordinates?.measure?.[0])).size >= 240) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const quietAedarBatches = batches.slice(quietStartIndex).filter((batch) => batch.items.some((item) =>
    String(item.resource).startsWith('aedar_')))
  const quietCells = quietAedarBatches.flatMap((batch) => batch.items).filter((item) => classify(item) === 'cell-comparison')
  receipt.quietLanding = { firstUsefulMs: firstUsefulAt, comparisonReadyMs: comparisonReadyAt,
    aedarBatches: quietAedarBatches.length, cellItems: quietCells.length,
    cellMeasures: new Set(quietCells.flatMap((item) => item.coordinates?.measure ?? [])).size }
  await quiet.close()

  // Pass 3 — #1008 the actual reader path: no hash, natural wheel down to page
  // 3, one real Sommaire click, then natural wheel back to page 2 and page 1
  // while the URL keeps the page-3 hash. The app's own IntersectionObserver
  // must admit the visible chapter; no scrollIntoView and no hash is written by
  // passive scrolling.
  const naturalStartIndex = batches.length
  const natural = await makePage()
  await natural.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}`, { waitUntil: 'domcontentloaded' })
  await waitUseful(natural)
  await natural.locator('.mobilite-section--reseaux .mobilite-comparison-bars').first()
    .waitFor({ state: 'visible', timeout: 30000 })
  await natural.waitForTimeout(500)
  const beforeNaturalPage3 = batches.slice(naturalStartIndex).flatMap((batch) => batch.items)
    .filter((item) => PAGE_THREE.includes(item.resource))
  assert.equal(beforeNaturalPage3.length, 0, 'page 3 must not be read while it is off-screen')

  const page3Reached = await wheelToPage(natural, '#figure-offre-transports-commun')
  assert.ok(page3Reached, 'page 3 did not become visible by natural wheel')
  assert.ok(await wheelUntilVisible(natural, '.mobilite-raccordement-curve__territory'),
    'the page-3 curve did not become visible by natural wheel')
  await natural.waitForFunction(() => (document.body.innerText ?? '').includes('99,6 %'),
    null, { timeout: 30000 })
  const page3Reading = await natural.evaluate(() => {
    const section = document.querySelector('#figure-offre-transports-commun')
    const path = section?.querySelector('.mobilite-raccordement-curve__territory')?.getAttribute('d') ?? ''
    return {
      coverage: (section?.innerText ?? '').includes('99,6 %'),
      curvePoints: (path.match(/L/gu) ?? []).length + 1,
    }
  })
  assert.equal(page3Reading.coverage, true, 'the live page-3 coverage (99,6 %) did not render')
  assert.equal(page3Reading.curvePoints, 73, `page-3 curve points: ${page3Reading.curvePoints}`)
  const page3Batches = batches.slice(naturalStartIndex)
    .filter((batch) => batch.items.some((item) => PAGE_THREE.includes(item.resource)))
  assert.equal(page3Batches.length, 1, `page-3 POSTs after natural admission: ${page3Batches.length}`)
  assert.equal(page3Batches[0].items.length, 7,
    `page-3 items after natural admission: ${page3Batches[0].items.length}`)

  // Explicit navigation: click page 3, then naturally scroll back up while the
  // hash still says page 3. Page 2 and page 1 must come back with their retained
  // data; page 3 must not be re-read.
  await natural.locator(PAGE_THREE_LINK).first().click()
  await natural.waitForFunction(() => location.hash === '#figure-offre-transports-commun',
    null, { timeout: 5000 })
  const page2Reached = await wheelToPage(natural, '#figure-partage-de-lespace-public')
  assert.ok(page2Reached, 'page 2 did not become visible after scrolling back')
  assert.ok(await wheelUntilVisible(natural, '.mobilite-section--reseaux .mobilite-comparison-bars'),
    'the page-2 bars did not come back after scrolling back')
  const page1Reached = await wheelToPage(natural, '#figure-lecture')
  assert.ok(page1Reached, 'page 1 did not become visible after scrolling back')
  assert.ok(await wheelUntilVisible(natural, '#section-aedar-car-overview'),
    'the page-1 AEDAR evidence did not come back after scrolling back')
  const activeAfterBack = await natural.locator('aside.cahier-spine a[aria-current="location"]')
    .getAttribute('href')
  assert.equal(activeAfterBack, '#figure-lecture',
    `active chapter after scrolling back: ${activeAfterBack}`)
  assert.equal(await natural.evaluate(() => location.hash), '#figure-offre-transports-commun',
    'passive scrolling must not write the URL hash')

  const naturalBatches = batches.slice(naturalStartIndex)
  const page3AfterBack = naturalBatches
    .filter((batch) => batch.items.some((item) => PAGE_THREE.includes(item.resource)))
  assert.equal(page3AfterBack.length, 1, 'page 3 was re-read on a repeated crossing')
  const naturalPageTwo = naturalBatches
    .filter((batch) => batch.items.some((item) => PAGE_TWO.includes(item.resource)))
  assert.equal(naturalPageTwo.length, 3, `page-2 POSTs after natural crossing: ${naturalPageTwo.length}`)
  assert.equal(naturalPageTwo.flatMap((batch) => batch.items)
    .filter((item) => PAGE_TWO.includes(item.resource)).length, 33,
  'page-2 demand items changed after natural crossing')
  const naturalItems = naturalBatches.flatMap((batch) => batch.items)
  const naturalIdentities = naturalItems.map(fullIdentity)
  const naturalDuplicates = [...new Set(naturalIdentities
    .filter((identity, index) => naturalIdentities.indexOf(identity) !== index))]
  assert.equal(naturalDuplicates.length, 0,
    `duplicate semantic identities after natural crossing: ${JSON.stringify(naturalDuplicates.slice(0, 3))}`)
  const naturalCoreTypequ = new Set(naturalItems
    .filter((item) => classify(item) === 'core')
    .flatMap((item) => item.coordinates?.typequ ?? [])).size
  assert.equal(naturalCoreTypequ, AEDAR_TYPEQU_REGISTRY.length,
    `AEDAR TYPEQU universe after natural crossing: ${naturalCoreTypequ}`)

  receipt.naturalScroll = {
    page3Reached,
    page3Coverage: page3Reading.coverage,
    page3CurvePoints: page3Reading.curvePoints,
    page3Posts: page3Batches.length,
    page3Items: page3Batches[0]?.items.length ?? 0,
    page2Posts: naturalPageTwo.length,
    page2Items: naturalPageTwo.flatMap((batch) => batch.items)
      .filter((item) => PAGE_TWO.includes(item.resource)).length,
    page3PostsAfterBack: page3AfterBack.length,
    activeAfterBack,
    hashAfterBack: await natural.evaluate(() => location.hash),
    duplicateIdentities: naturalDuplicates.length,
    coreTypequ: naturalCoreTypequ,
  }
  await natural.close()

  // Pass 4 — cold page-3 deep link, then the reader scrolls back up. The hash
  // remains page 3; page 2 and page 1 become the visible demand and resume only
  // their genuinely missing reads, without erasing the settled page-3 entry.
  const coldStartIndex = batches.length
  const cold = await makePage()
  await cold.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}#figure-offre-transports-commun`,
    { waitUntil: 'domcontentloaded' })
  await cold.locator('.mobilite-raccordement-curve__territory')
    .waitFor({ state: 'visible', timeout: 30000 })
  await cold.waitForFunction(() => location.hash === '#figure-offre-transports-commun',
    null, { timeout: 5000 })
  const coldPage3 = batches.slice(coldStartIndex)
    .filter((batch) => batch.items.some((item) => PAGE_THREE.includes(item.resource)))
  assert.equal(coldPage3.length, 1, `cold page-3 POSTs: ${coldPage3.length}`)
  assert.equal(coldPage3[0].items.length, 7, `cold page-3 items: ${coldPage3[0].items.length}`)

  const coldPage2Reached = await wheelToPage(cold, '#figure-partage-de-lespace-public')
  assert.ok(coldPage2Reached, 'cold deep link: page 2 did not become visible by natural wheel')
  assert.ok(await wheelUntilVisible(cold, '.mobilite-section--reseaux .mobilite-comparison-bars'),
    'cold deep link: the page-2 bars did not come back')
  const coldPage1Reached = await wheelToPage(cold, '#figure-lecture')
  assert.ok(coldPage1Reached, 'cold deep link: page 1 did not become visible by natural wheel')
  assert.ok(await wheelUntilVisible(cold, '#section-aedar-car-overview'),
    'cold deep link: the page-1 AEDAR evidence did not come back')
  const coldDeadline = Date.now() + 30000
  while (Date.now() < coldDeadline) {
    const core = new Set(batches.slice(coldStartIndex).flatMap((batch) => batch.items)
      .filter((item) => classify(item) === 'core')
      .flatMap((item) => item.coordinates?.typequ ?? []))
    if (core.size >= AEDAR_TYPEQU_REGISTRY.length) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const coldActive = await cold.locator('aside.cahier-spine a[aria-current="location"]').getAttribute('href')
  assert.equal(coldActive, '#figure-lecture', `cold active chapter after scroll back: ${coldActive}`)
  assert.equal(await cold.evaluate(() => location.hash), '#figure-offre-transports-commun',
    'cold scroll back must keep the explicit hash')
  const coldBatches = batches.slice(coldStartIndex)
  const coldPage3AfterBack = coldBatches
    .filter((batch) => batch.items.some((item) => PAGE_THREE.includes(item.resource)))
  assert.equal(coldPage3AfterBack.length, 1, 'cold page 3 was re-read on scroll back')
  const coldPageTwo = coldBatches
    .filter((batch) => batch.items.some((item) => PAGE_TWO.includes(item.resource)))
  assert.equal(coldPageTwo.length, 3, `cold page-2 POSTs after scroll back: ${coldPageTwo.length}`)
  assert.equal(coldPageTwo.flatMap((batch) => batch.items)
    .filter((item) => PAGE_TWO.includes(item.resource)).length, 33,
  'cold page-2 demand items changed after scroll back')
  const coldItems = coldBatches.flatMap((batch) => batch.items)
  const coldIdentities = coldItems.map(fullIdentity)
  const coldDuplicates = [...new Set(coldIdentities
    .filter((identity, index) => coldIdentities.indexOf(identity) !== index))]
  assert.equal(coldDuplicates.length, 0,
    `cold duplicate semantic identities: ${JSON.stringify(coldDuplicates.slice(0, 3))}`)
  const coldCoreTypequ = new Set(coldItems
    .filter((item) => classify(item) === 'core')
    .flatMap((item) => item.coordinates?.typequ ?? [])).size
  assert.equal(coldCoreTypequ, AEDAR_TYPEQU_REGISTRY.length,
    `cold AEDAR TYPEQU universe after scroll back: ${coldCoreTypequ}`)

  receipt.coldDeepLinkScrollBack = {
    page3Posts: coldPage3.length,
    page3Items: coldPage3[0]?.items.length ?? 0,
    page2Posts: coldPageTwo.length,
    page2Items: coldPageTwo.flatMap((batch) => batch.items)
      .filter((item) => PAGE_TWO.includes(item.resource)).length,
    page3PostsAfterBack: coldPage3AfterBack.length,
    activeAfterBack: coldActive,
    hashAfterBack: await cold.evaluate(() => location.hash),
    duplicateIdentities: coldDuplicates.length,
    coreTypequ: coldCoreTypequ,
  }
  await cold.close()

  // Pass 5 - #1010 cold direct inner-section anchors. The fragment is resolved
  // before the SPA content exists, so the Cahier must report the typed owner and
  // land the target after render. All five rendered AEDAR section ids are
  // exercised, plus a non-AEDAR page-3 section, an in-session jump, an unknown
  // fragment and a scroll away while the section hash remains.
  const waitAedarCore = async (page, startIndex) => {
    const deadline = Date.now() + 30000
    let core = 0
    while (Date.now() < deadline) {
      core = new Set(batches.slice(startIndex).flatMap((batch) => batch.items)
        .filter((item) => classify(item) === 'core')
        .flatMap((item) => item.coordinates?.typequ ?? [])).size
      if (core >= AEDAR_TYPEQU_REGISTRY.length) break
      await page.waitForTimeout(40)
    }
    return core
  }
  const sectionGeometry = (page, targetId) => page.evaluate((id) => {
    const target = document.getElementById(id)
    const active = document.querySelector('aside.cahier-spine a[aria-current="location"]')
    const sticky = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--header-height')) || 0
    return {
      hash: location.hash,
      scrollY: Math.round(window.scrollY),
      targetTop: target ? Math.round(target.getBoundingClientRect().top) : null,
      sticky,
      active: active?.getAttribute('href') ?? null,
    }
  }, targetId)
  const sectionAnchors = []
  const readColdSection = async (id, { aedar = true, query = '' } = {}) => {
    const startIndex = batches.length
    const page = await makePage()
    await page.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}${query}#${id}`,
      { waitUntil: 'domcontentloaded' })
    const coreTypequ = aedar
      ? await waitAedarCore(page, startIndex)
      : 0
    if (!aedar) {
      await page.locator('.mobilite-raccordement-curve__territory')
        .waitFor({ state: 'visible', timeout: 30000 })
    }
    await page.waitForFunction((targetId) => Boolean(document.getElementById(targetId)),
      id, { timeout: 30000 })
    try {
      await page.waitForFunction((targetId) => {
        const element = document.getElementById(targetId)
        if (!element) return false
        const top = element.getBoundingClientRect().top
        return top >= 0 && top <= 120
      }, id, { timeout: 15000 })
    } catch (error) {
      console.error('SECTION-TOP-DEBUG', id, await page.evaluate((targetId) => {
        const element = document.getElementById(targetId)
        return { top: element?.getBoundingClientRect().top ?? null, scrollY: window.scrollY,
          active: document.querySelector('aside.cahier-spine a[aria-current="location"]')?.getAttribute('href') }
      }, id))
      throw error
    }
    const geometry = await sectionGeometry(page, id)
    const items = batches.slice(startIndex).flatMap((batch) => batch.items)
    const entry = {
      id,
      ...geometry,
      coreTypequ,
      page2Items: items.filter((item) => PAGE_TWO.includes(item.resource)).length,
      page3Items: items.filter((item) => PAGE_THREE.includes(item.resource)).length,
      page3Posts: batches.slice(startIndex)
        .filter((batch) => batch.items.some((item) => PAGE_THREE.includes(item.resource))).length,
      selectedPage3: items.filter((item) => item.resource === 'raccordement_courbe' &&
        item.intent?.kind === 'selected_comparison').length,
    }
    sectionAnchors.push(entry)
    await page.close()
    return entry
  }

  const aedarSectionIds = ['section-aedar-car-overview', 'section-aedar-diversity-loss',
    'section-aedar-access', 'section-aedar-equipment-profile', 'section-aedar-equipment-explorer']
  for (const id of aedarSectionIds) {
    const entry = await readColdSection(id)
    assert.equal(entry.coreTypequ, AEDAR_TYPEQU_REGISTRY.length,
      `${id}: AEDAR core TYPEQU ${entry.coreTypequ}`)
    assert.ok(entry.scrollY > 0, `${id}: target did not scroll (scrollY ${entry.scrollY})`)
    assert.ok(entry.targetTop !== null && entry.targetTop >= 0 && entry.targetTop <= 180,
      `${id}: target top ${entry.targetTop} outside sticky clearance`)
    assert.equal(entry.active, '#figure-lecture', `${id}: active chapter ${entry.active}`)
  }

  const nonAedarSection = await readColdSection('section-visiter-la-bretagne',
    { aedar: false, query: '&comparaison=commune:35238,commune:35240' })
  assert.ok(nonAedarSection.scrollY > 0,
    `non-AEDAR section did not scroll (scrollY ${nonAedarSection.scrollY})`)
  assert.ok(nonAedarSection.targetTop !== null && nonAedarSection.targetTop >= 0 &&
    nonAedarSection.targetTop <= 180,
  `non-AEDAR target top ${nonAedarSection.targetTop} outside sticky clearance`)
  assert.equal(nonAedarSection.active, '#figure-offre-transports-commun',
    `non-AEDAR active chapter ${nonAedarSection.active}`)
  assert.equal(nonAedarSection.page3Posts, 1, `non-AEDAR page-3 posts ${nonAedarSection.page3Posts}`)
  assert.equal(nonAedarSection.page3Items, 7, `non-AEDAR page-3 items ${nonAedarSection.page3Items}`)
  assert.ok(nonAedarSection.selectedPage3 > 0,
    'the non-AEDAR section must keep the typed custom comparison group')

  // In-session page 3 -> inner AEDAR section.
  {
    const startIndex = batches.length
    const page = await makePage()
    await page.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}#figure-offre-transports-commun`,
      { waitUntil: 'domcontentloaded' })
    await page.locator('.mobilite-raccordement-curve__territory')
      .waitFor({ state: 'visible', timeout: 30000 })
    await page.evaluate(() => { location.hash = '#section-aedar-access' })
    const coreTypequ = await waitAedarCore(page, startIndex)
    await page.waitForFunction(() => {
      const element = document.getElementById('section-aedar-access')
      if (!element) return false
      const top = element.getBoundingClientRect().top
      return top >= 0 && top <= 120
    }, null, { timeout: 15000 })
    const geometry = await sectionGeometry(page, 'section-aedar-access')
    assert.equal(coreTypequ, AEDAR_TYPEQU_REGISTRY.length,
      `in-session section core TYPEQU ${coreTypequ}`)
    assert.ok(geometry.scrollY > 0, `in-session section scrollY ${geometry.scrollY}`)
    assert.equal(geometry.active, '#figure-lecture',
      `in-session section active chapter ${geometry.active}`)
    receipt.inSessionSection = { ...geometry, coreTypequ }
    await page.close()
  }

  // Unknown fragment keeps the safe numeric fallback and does not activate AEDAR.
  {
    const startIndex = batches.length
    const page = await makePage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}#section-does-not-exist`,
      { waitUntil: 'domcontentloaded' })
    await page.locator('.mobilite-section--reseaux .mobilite-comparison-bars').first()
      .waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(500)
    const items = batches.slice(startIndex).flatMap((batch) => batch.items)
    const coreTypequ = new Set(items.filter((item) => classify(item) === 'core')
      .flatMap((item) => item.coordinates?.typequ ?? [])).size
    assert.equal(coreTypequ, 0, `unknown fragment activated ${coreTypequ} AEDAR TYPEQU`)
    assert.equal(items.filter((item) => PAGE_TWO.includes(item.resource)).length, 33,
      'unknown fragment must keep the page-2 numeric fallback')
    assert.deepEqual(pageErrors, [], `unknown fragment page errors: ${JSON.stringify(pageErrors)}`)
    receipt.unknownFragment = { coreTypequ, page2Items: 33, errors: pageErrors }
    await page.close()
  }

  // Scrolling away from the section must not be undone by the initial reveal.
  {
    const startIndex = batches.length
    const page = await makePage()
    await page.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}#section-aedar-access`,
      { waitUntil: 'domcontentloaded' })
    await waitAedarCore(page, startIndex)
    await wheelToPage(page, '#figure-partage-de-lespace-public')
    await page.locator('.mobilite-section--reseaux .mobilite-comparison-bars').first()
      .waitFor({ state: 'visible', timeout: 30000 })
    const readState = () => page.evaluate(() => ({
      hash: location.hash,
      scrollY: Math.round(window.scrollY),
      targetTop: Math.round(document.getElementById('section-aedar-access')
        ?.getBoundingClientRect().top ?? 0),
      active: document.querySelector('aside.cahier-spine a[aria-current="location"]')?.getAttribute('href'),
    }))
    const afterScroll = await readState()
    await page.waitForTimeout(600)
    const settled = await readState()
    assert.equal(settled.hash, '#section-aedar-access', 'the section hash changed on scroll')
    assert.ok(settled.targetTop < -500,
      `section reveal yanked the reader back: ${JSON.stringify(settled)}`)
    receipt.sectionScrollAway = { afterScroll, settled }
    await page.close()
  }

  // A user wheel before/while the late reveal settles must win: the pending
  // target scroll and its resize settle are cancelled, and the page the reader
  // actually scrolled to owns the chapter.
  {
    const startIndex = batches.length
    const page = await makePage()
    await page.goto(`${baseUrl.replace(/\/$/, '')}${COMMUNAUTE}#section-aedar-access`,
      { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(document.getElementById('section-aedar-access')))
    const reached = await wheelToPage(page, '#figure-partage-de-lespace-public')
    await page.waitForTimeout(700)
    const state = await page.evaluate(() => ({
      hash: location.hash,
      scrollY: Math.round(window.scrollY),
      targetTop: Math.round(document.getElementById('section-aedar-access')
        ?.getBoundingClientRect().top ?? 0),
    }))
    assert.ok(reached, 'the user scroll did not reach page 2')
    assert.equal(state.hash, '#section-aedar-access', 'the section hash changed on user scroll')
    assert.ok(state.scrollY > 3000, `the user scroll did not move: ${state.scrollY}`)
    assert.ok(state.targetTop < -500,
      `the pending section reveal yanked the user back: ${JSON.stringify(state)}`)
    receipt.sectionInterrupt = state
    await page.close()
  }

  receipt.sectionAnchors = sectionAnchors

  console.log(JSON.stringify(receipt, null, 2))

  assert.equal(receipt.navigation.aedarBatchesStartedAfterClick, 0,
    `AEDAR page-1 batches started after the Sommaire click: ${JSON.stringify(receipt.navigation.aedarBatchesStartedAfterClickShapes)}`)
  assert.equal(receipt.navigation.duplicateIdentities, 0,
    `duplicate semantic identities: ${JSON.stringify(receipt.navigation.duplicateSample)}`)
  assert.equal(receipt.navigation.pageTwoItems, PAGE_TWO_ITEMS,
    `page-2 demand items: ${receipt.navigation.pageTwoItems}`)
  assert.equal(receipt.navigation.pageTwoPosts, 3, `page-2 demand POSTs: ${receipt.navigation.pageTwoPosts}`)
  assert.equal(receipt.navigation.coreTypequ, AEDAR_TYPEQU_REGISTRY.length,
    `AEDAR core TYPEQU universe: ${receipt.navigation.coreTypequ}`)
  // Page 1 keeps its complete demanded evidence on a quiet landing: every
  // per-TYPEQU cell and its intended measure, never a partial universe.
  assert.equal(receipt.quietLanding.cellItems, 240, `explorer cell items: ${receipt.quietLanding.cellItems}`)
  assert.equal(receipt.quietLanding.cellMeasures, 240,
    `explorer cell measures: ${receipt.quietLanding.cellMeasures}`)
  assert.ok(receipt.navigation.detailItems > 0, 'explorer detail projections must be requested when demanded')
  assert.equal(receipt.navigation.cellItems, 36,
    `in-flight explorer cells at the click: ${receipt.navigation.cellItems}`)
  assert.ok(receipt.navigation.pageTwoVisible, 'the requested page-2 chapter must be visible')
  assert.ok(receipt.quietLanding.comparisonReadyMs > receipt.quietLanding.firstUsefulMs,
    'first-useful and comparison-ready are distinct events')
  console.log('AEDAR demand receipt: OK')
} finally {
  if (browser) await browser.close()
  await server.close()
}
