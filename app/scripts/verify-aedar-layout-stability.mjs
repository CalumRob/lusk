import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// #769 — real-browser regression harness for the Mobilité first-page order and
// scroll-anchor stability during progressive AEDAR hydration.
//
// Seam under test: ProductionMobiliteAedar.vue's `transformed` content (loading
// vs ready branch) rendered by VarianteCahierLibre on
// /territoire/commune/35238?theme=mobilite. The focal territory's AEDAR
// POST /api/resources/read-batch is HELD until we release it, so the interim
// (hydration-pending) DOM is observed deterministically; theme facts, the
// reference-territory AEDAR reads and the published map assets are NOT gated
// (the maps/editorial must stay mounted — that is #825's contract).
//
// Assertions (fail on the reported bug, pass after the fix):
//   1. the interim first-page section order already equals the final order
//      (prose -> aedar-car-overview -> aedar-diversity-loss -> ...), i.e. no
//      section is INSERTED above « Et sans voiture alors ? » when facts resolve;
//   2. the unit introduction prose is rendered before hydration (no empty
//      page-copy above the map);
//   3. geometry/scroll anchor: the diversity-loss section's document offset and
//      viewport top, and window.scrollY, move by at most a small tolerance when
//      the held AEDAR facts resolve (the reported jump is hundreds of px).
// A generic CLS number is deliberately not asserted; order + geometry + scroll
// are recorded explicitly in the JSON report.
//
// Run: npm run verify:aedar-layout-stability
// Browser: playwright-core chromium (PLAYWRIGHT_CHROMIUM_EXECUTABLE overrides).
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const FOCAL_ID = '35238'
// Residual vertical drift allowed when the held facts resolve: the unit
// introduction gains the published address-count clause and the scalar cells
// '—' -> number; both are one text line at most. The reported bug moves the
// section by several hundred px (whole prose block + map section inserted).
const GEOMETRY_TOLERANCE_PX = 72

const server = await createServer({
  configFile: resolve(appRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
let browser

try {
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  const { nativeBatchResponse, nativeReadFixture, nativeCatalogueResponse } =
    await server.ssrLoadModule('/src/__tests__/helpers/semanticApiFixtures.ts')
  const { AEDAR_TYPEQU_REGISTRY } = await server.ssrLoadModule('/src/fiche/content/aedarTypequRegistry.ts')
  const semanticContracts = JSON.parse(await readFile(
    resolve(repoRoot, 'pipeline/inst/extdata/semantic-resource-contracts.json'), 'utf8',
  ))
  const aedarContract = semanticContracts.resources.find(({ resource_id }) => resource_id === 'aedar_territorial_aggregate')
  assert(aedarContract?.source_id, 'AEDAR semantic resource contract must declare its source_id')

  // Same synthetic contract-valid AEDAR fixture shape as the existing browser
  // harness (verify-mobile-cahier-overflow.mjs) — not published facts.
  const catalogueResources = (await nativeCatalogueResponse().json()).resources
  const summaryDeclaration = catalogueResources
    .find((resource) => resource.resource_id === 'aedar_territory_summary')
  const aggregateDeclaration = catalogueResources
    .find((resource) => resource.resource_id === 'aedar_territorial_aggregate')
  assert(summaryDeclaration?.measure_facets && aggregateDeclaration?.measure_facets,
    'AEDAR declarations must publish their measure facets')
  const summaryMeasureKeys = Object.keys(summaryDeclaration.measure_facets)
  const aedarContentVersion = 'fixture-985-aedar-v1'
  const aedarReferenceVersion = 'fixture-985-territories-v1'
  const aedarSummaryVersion = 'fixture-985-aedar-summary-v1'
  const fixtureAttribution = 'Synthetic browser fixture; not published AEDAR facts'
  const summaryReading = (measure) => ({
    measure, value: 0.5, status: 'available', n_typequ: 235, n_addresses: 100,
    n_observed: 100, coverage_status: 'covered', statistic: 'direct',
    source_id: aedarContract.source_id, vintage_id: '2026-v1',
    source_url: 'https://example.test/aedar-fixture', licence: 'Licence Ouverte 2.0',
    attribution: fixtureAttribution, reference_date: '2026-01-01',
    publication_date: '2026-10-22',
  })
  const aggregateComparison = (item) => {
    const selected = item.intent.kind === 'selected_comparison'
    const members = selected
      ? item.intent.members.map((member) => ({ type: member.type, id: member.id }))
      : null
    const rows = item.coordinates.measure.map((measure) => ({
      typequ: null, measure,
      comparison_context: selected ? 'selected_comparison' : item.intent.context,
      statistic: selected ? 'pooled' : 'direct',
      group_value: 0.5, group_n_addresses: 100, group_n_observed: 100,
      group_coverage_status: 'covered',
      direction: aggregateDeclaration.measure_facets[measure].direction,
      source_id: aedarContract.source_id, vintage_id: '2026-v1',
      reference_date: '2026-01-01', publication_date: '2026-10-22',
      rank: null, rank_size: null, rank_ties: null,
    }))
    return {
      resource: item.resource, target: item.target,
      content_version: aedarContentVersion, aedar_content_version: aedarContentVersion,
      reference_content_version: aedarReferenceVersion,
      summary_content_version: aedarSummaryVersion,
      ...(selected
        ? { comparisons: rows, scope: { kind: 'explicit_selection', member_count: members.length },
          selection: members }
        : { comparison: rows[0] }),
    }
  }
  function aedarFixture(items) {
    const typequItems = items.filter((item) =>
      Array.isArray(item.coordinates?.typequ) && item.intent?.kind === 'facts')
    const otherItems = items.filter((item) => !typequItems.includes(item))
    return {
      contract: 'semantic-read-batch-v2',
      results: [
        ...typequItems.map((item) => ({
          id: item.id,
          data: {
          resource: item.resource,
          target: item.target,
          territory: { territory_type: item.target.type, territory_id: item.target.id },
          content_version: `fixture-769-aedar-${item.target.id}`,
          reference_content_version: 'fixture-769-territories-v1',
          limit: 100,
          offset: 0,
          facts: item.coordinates.typequ.map((code, typeIndex) => {
            const equipment = AEDAR_TYPEQU_REGISTRY.find(({ code: candidate }) => candidate === code)
            assert(equipment, `TYPEQU ${code} absent du registre producteur`)
            const measures = {}
            const selectedMeasures = item.fields?.map((field) => field.replace(/^measures\./u, ''))
            for (const [horizonIndex, horizon] of [5, 10, 15, 20].entries()) {
              for (const [modeIndex, mode] of ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].entries()) {
                const minimum = 1 + horizonIndex + modeIndex / 10 + (typeIndex % 4) / 10
                const projection = {
                  [`count_${horizon}_${mode}_share`]: Math.min(0.95, 0.35 + horizonIndex * 0.12 + modeIndex * 0.03 + (typeIndex % 7) * 0.01),
                  [`count_${horizon}_${mode}_min`]: minimum,
                  [`count_${horizon}_${mode}_max`]: minimum + 8,
                }
                for (let decile = 1; decile <= 9; decile += 1) {
                  projection[`count_${horizon}_${mode}_decile${decile}`] = minimum + decile * 0.8
                }
                projection[`count_${horizon}_${mode}_mean`] = minimum + 4
                for (const [key, value] of Object.entries(projection)) {
                  if (!selectedMeasures || selectedMeasures.includes(key)) measures[key] = value
                }
              }
            }
            return {
              territory_id: item.target.id,
              territory_type: item.target.type,
              typequ: code,
              typequ_label: equipment.label,
              identity: {},
              n_addresses: 100,
              n_observed: 100,
              coverage_status: 'covered',
              measures,
              source_id: aedarContract.source_id,
              vintage_id: '2026-v1',
              source_url: 'https://example.test/aedar-fixture',
              licence: 'Licence Ouverte 2.0',
              attribution: 'Synthetic browser fixture; not published AEDAR facts',
              reference_date: '2026-01-01',
              publication_date: '2026-10-22',
            }
          }),
        },
      })),
        ...otherItems.map((item) => ({ id: item.id,
          data: item.resource === 'aedar_territory_summary'
            ? { resource: item.resource, target: item.target,
              territory: { territory_type: item.target.type, territory_id: item.target.id },
              summary_content_version: aedarSummaryVersion,
              aedar_content_version: aedarContentVersion,
              reference_content_version: aedarReferenceVersion,
              readings: summaryMeasureKeys.map(summaryReading) }
            : aggregateComparison(item) })),
      ],
    }
  }

  // Gate ONLY the focal territory's AEDAR reads; everything else (theme facts,
  // reference-territory AEDAR, retired routes) flows immediately so the interim
  // state is exactly "focal aggregates pending".
  let releaseFocalAedar
  const focalGate = new Promise((resolvePromise) => { releaseFocalAedar = resolvePromise })
  let gateOpen = false
  const readCalls = { focalAedarBatches: 0, referenceAedarBatches: 0, themeBatches: 0, otherApi: 0 }
  const v2Envelope = (items, results) => {
    const byId = new Map(results.map((result) => [result.id, result]))
    return { contract: 'semantic-read-batch-v2', results: items.map((item) => {
      const result = byId.get(item.id)
      return result
        ? { ...result, resource: result.resource ?? item.resource, status: result.status ?? 'available' }
        : { id: item.id, resource: item.resource, status: 'publication_unavailable',
          reason: 'publication_absent', family: 'scalar' }
    }) }
  }

  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  // Remote published map assets are outside this proof: abort them fast and
  // deterministically (the map slots keep their fixed aspect-ratio geometry).
  await page.route('**://images.calumrobertson.fr/**', (route) => route.abort())
  // Fail-closed catch-all FIRST (Playwright last-registered-wins).
  await page.route('**/api/**', async (route) => {
    readCalls.otherApi += 1
    await route.fulfill({ status: 599, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected API traffic in fixture-only proof' }) })
  })
  await page.route('**/api/resources', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await nativeCatalogueResponse().json()) })
  })
  await page.route('**/api/resources/read-batch', async (route) => {
    const request = route.request().postDataJSON()
    // Classify by the declared producer resource identity, never by one
    // coordinate: AEDAR summary and aggregate-comparison reads carry only
    // `measure` and must not fall into the theme fixture.
    const aedarItems = request.items.filter((item) => String(item.resource).startsWith('aedar_'))
    const themeItems = request.items.filter((item) => !String(item.resource).startsWith('aedar_'))
    const focalItems = aedarItems.filter((item) => item.target?.kind === 'territory' && item.target?.id === FOCAL_ID)
    const referenceItems = aedarItems.filter((item) => !focalItems.includes(item))
    if (themeItems.length) {
      readCalls.themeBatches += 1
      const batch = await nativeBatchResponse(themeItems, (item, resource) =>
        nativeReadFixture(item, resource, { syntheticProfileComparisons: true })).json()
      const results = [...batch.results]
      if (referenceItems.length) {
        readCalls.referenceAedarBatches += 1
        results.push(...aedarFixture(referenceItems).results)
      }
      if (focalItems.length) {
        readCalls.focalAedarBatches += 1
        if (!gateOpen) await focalGate // hold the focal hydration until released
        results.push(...aedarFixture(focalItems).results)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v2Envelope(request.items, results)) })
      return
    }
    if (referenceItems.length) {
      readCalls.referenceAedarBatches += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v2Envelope(referenceItems, aedarFixture(referenceItems).results)) })
      return
    }
    readCalls.focalAedarBatches += 1
    if (!gateOpen) await focalGate
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v2Envelope(focalItems, aedarFixture(focalItems).results)) })
  })

  await page.goto(`${baseUrl}territoire/commune/${FOCAL_ID}?theme=mobilite`, { waitUntil: 'domcontentloaded' })

  // Interim state: the cahier is mounted, the loss map section is on the first
  // page, and the focal AEDAR batch has been requested and is being held.
  await page.waitForFunction(() => document.querySelector('.cahier-page .figure-stack [data-section="aedar-diversity-loss"]') !== null, null, { timeout: 20000 })
  await page.waitForFunction((calls) => calls.focalAedarBatches >= 1, readCalls, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)

  const measure = () => page.evaluate(() => {
    const firstPage = document.querySelector('.cahier-page')
    const rectOf = (el) => {
      const rect = el.getBoundingClientRect()
      return { docTop: rect.top + window.scrollY, viewportTop: rect.top, height: rect.height, width: rect.width }
    }
    const sections = [...firstPage.querySelectorAll('.figure-stack > [data-section]')].map((el) => ({
      key: el.getAttribute('data-section'),
      label: el.querySelector('.concept-group-heading h3')?.textContent?.trim() ?? null,
      ...rectOf(el),
    }))
    const prose = firstPage.querySelector('.page-copy')
    const loss = sections.find((section) => section.key === 'aedar-diversity-loss') ?? null
    return {
      scrollY: window.scrollY,
      proseText: prose?.innerText.trim() ?? '',
      proseBox: prose ? rectOf(prose) : null,
      sections,
      loss,
    }
  })

  const interim = await measure()

  // Release the held focal AEDAR reads and wait for the hydrated cahier.
  gateOpen = true
  releaseFocalAedar()
  await page.waitForFunction(() => {
    const scalar = document.querySelector('#section-aedar-car-overview .cahier-figure-scalar-value')
    return document.querySelector('#section-aedar-equipment-explorer') !== null && scalar !== null && scalar.textContent.trim() !== '—'
  }, null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
  const final = await measure()

  const sectionKeys = (state) => state.sections.map((section) => section.key)
  const EXPECTED_ORDER = ['aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer']
  // LUSK_769_MEASURE_ONLY=1 records both states without asserting (diagnosis).
  const MEASURE_ONLY = process.env.LUSK_769_MEASURE_ONLY === '1'
  const check = (condition, message) => { if (!MEASURE_ONLY) assert(condition, message) }

  // 1. Final hydrated order is the documented AEDAR order.
  check(JSON.stringify(sectionKeys(final)) === JSON.stringify(EXPECTED_ORDER),
    `hydrated first-page section order: got ${JSON.stringify(sectionKeys(final))}`)
  // 2. RED on the reported bug: the interim page must ALREADY show the same
  //    order — nothing may be inserted above « Et sans voiture alors ? » when
  //    the aggregates resolve.
  check(JSON.stringify(sectionKeys(interim)) === JSON.stringify(EXPECTED_ORDER),
    `interim (AEDAR pending) first-page order must match the hydrated order; ` +
    `got ${JSON.stringify(sectionKeys(interim))} vs ${JSON.stringify(EXPECTED_ORDER)}. ` +
    `Reported symptom: interim shows only [${JSON.stringify(sectionKeys(interim))}] with the loss map on top.`)
  // 3. The prose (unit introduction) is present before hydration, above the
  //    car-overview section.
  check(interim.proseText.includes('Base permanente des équipements'),
    `interim unit introduction must render the AEDAR prose before hydration; got ${JSON.stringify(interim.proseText.slice(0, 160))}`)
  check(interim.proseBox !== null && interim.proseBox.docTop <= (interim.sections[0]?.docTop ?? Infinity) + 1,
    'interim prose must sit above the first section')
  // 4. Geometry/scroll anchor: the « Et sans voiture alors ? » section must not
  //    jump when the held facts resolve.
  check(interim.loss !== null && final.loss !== null, 'diversity-loss section must be measured in both states')
  const docTopDelta = Math.abs(final.loss.docTop - interim.loss.docTop)
  const viewportTopDelta = Math.abs(final.loss.viewportTop - interim.loss.viewportTop)
  check(docTopDelta <= GEOMETRY_TOLERANCE_PX,
    `« Et sans voiture alors ? » jumped ${docTopDelta}px in document flow when AEDAR resolved ` +
    `(interim docTop ${interim.loss.docTop} -> final ${final.loss.docTop}); tolerance ${GEOMETRY_TOLERANCE_PX}px`)
  check(viewportTopDelta <= GEOMETRY_TOLERANCE_PX,
    `« Et sans voiture alors ? » moved ${viewportTopDelta}px in the viewport when AEDAR resolved`)
  check(final.scrollY === interim.scrollY, 'scroll anchor (scrollY) must not move during hydration')
  check(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`)

  console.log(JSON.stringify({
    pass: !MEASURE_ONLY,
    route: `/territoire/commune/${FOCAL_ID}?theme=mobilite`,
    gate: 'focal AEDAR read-batch held until release; reference/theme/map traffic ungated',
    geometryTolerancePx: GEOMETRY_TOLERANCE_PX,
    interim: {
      scrollY: interim.scrollY,
      proseText: interim.proseText.slice(0, 200),
      sections: interim.sections.map(({ key, label, docTop, height }) => ({ key, label, docTop: Math.round(docTop), height: Math.round(height) })),
      lossViewportTop: Math.round(interim.loss.viewportTop),
    },
    final: {
      scrollY: final.scrollY,
      proseText: final.proseText.slice(0, 200),
      sections: final.sections.map(({ key, label, docTop, height }) => ({ key, label, docTop: Math.round(docTop), height: Math.round(height) })),
      lossViewportTop: Math.round(final.loss.viewportTop),
    },
    deltas: {
      lossDocTop: Math.round(final.loss.docTop - interim.loss.docTop),
      lossViewportTop: Math.round(final.loss.viewportTop - interim.loss.viewportTop),
      scrollY: final.scrollY - interim.scrollY,
    },
    readCalls,
  }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
