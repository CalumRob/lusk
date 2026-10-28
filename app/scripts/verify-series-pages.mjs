import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Bounded intercepted browser proof for #857 — the five producer-declared
// ordered-series indicator pages, API-only in source, mode variables absent.
// All API traffic is intercepted; series response values are transformed by a
// sentinel so no checked-in numeric row can satisfy the assertions. The
// expected page models are recomputed through the app's own acquisition and
// family seams from the exact transformed responses the browser received.
for (const name of Object.keys(process.env)) if (name.startsWith('VITE_')) delete process.env[name]
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
const branchAtStart = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const headAtStart = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const statusAtStart = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
assert.equal(statusAtStart, '', 'Browser acceptance requires a clean committed source tree')

const expectedPages = [
  'habitat/prix_m2', 'milieux/artif_par_habitant', 'milieux/conso_enaf_annuel',
  'mobilite/raccordement_courbe', 'programmes/subventions_annuelles',
].sort()
const THEMES = ['habitat', 'milieux', 'mobilite', 'programmes']

const SENTINEL = (value) => Number(value) * 10 + 1234.5

/** Sentinel-transform measured display values only: ranks, ties, counts,
 *  statuses, axes, units and clocks must survive unmodified. */
function sentinelSeriesData(data) {
  if (Array.isArray(data?.points)) {
    data.points = data.points.map((point) => point?.status === 'measured' && point.value !== null
      ? { ...point, value: SENTINEL(point.value) } : point)
  }
  if (Array.isArray(data?.series)) {
    data.series = data.series.map((group) => group && Array.isArray(group.points)
      ? { ...group, points: group.points.map((point) => point?.status === 'measured' && point.value !== null
        ? { ...point, value: SENTINEL(point.value) } : point) } : group)
  }
  if (Array.isArray(data?.result?.axis_comparisons)) {
    data.result = { ...data.result, axis_comparisons: data.result.axis_comparisons.map((row) =>
      row?.status === 'available' ? { ...row, value: SENTINEL(row.value),
        min: row.min === null ? null : SENTINEL(row.min), max: row.max === null ? null : SENTINEL(row.max) } : row) }
  }
  if (typeof data?.result?.median === 'number') data.result = { ...data.result, median: SENTINEL(data.result.median) }
  if (typeof data?.result?.mean === 'number') data.result = { ...data.result, mean: SENTINEL(data.result.mean) }
  if (Array.isArray(data?.result?.mean_curve?.points)) {
    data.result = { ...data.result, mean_curve: { ...data.result.mean_curve,
      points: data.result.mean_curve.points.map((point) => ({ ...point, value: SENTINEL(point.value) })) } }
  }
  if (data?.scalar_facet?.observation?.status === 'measured' && typeof data.scalar_facet.observation.value === 'number') {
    data.scalar_facet = { ...data.scalar_facet,
      observation: { ...data.scalar_facet.observation, value: SENTINEL(data.scalar_facet.observation.value) } }
  }
  if (Array.isArray(data?.scalar_facet?.observations)) {
    data.scalar_facet = { ...data.scalar_facet,
      observations: data.scalar_facet.observations.map((observation) =>
        observation?.status === 'measured' && typeof observation.value === 'number'
          ? { ...observation, value: SENTINEL(observation.value) } : observation) }
  }
  if (typeof data?.scalar_facet?.result?.median === 'number') {
    data.scalar_facet = { ...data.scalar_facet,
      result: { ...data.scalar_facet.result, median: SENTINEL(data.scalar_facet.result.median) } }
  }
  return data
}

const batchSignature = (items) => JSON.stringify(items.map((item) =>
  [item.resource, item.target?.kind, item.target?.type, item.target?.id ?? null,
    item.target?.department_id ?? null, item.target?.epci_id ?? null,
    item.intent?.kind, item.intent?.context ?? null,
    item.intent?.members ?? null, item.fields ?? null]))

function createHarness(resources, territories, fixtures) {
  const requests = []
  const factReads = []
  const comparisonReads = []
  const unexpectedApi = []
  const servedBatches = []
  let failNextBatch = false
  let failNextComparisonOnly = false
  let anonymizeNextSeriesSources = false
  let delayNextResource = null
  let delayedStartedResolve
  let delayedReleaseResolve
  let delayedStarted = new Promise((resolve) => { delayedStartedResolve = resolve })
  let delayedRelease = new Promise((resolve) => { delayedReleaseResolve = resolve })
  const renameSources = (value) => {
    if (Array.isArray(value)) return value.map(renameSources)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
        key === 'source_id' && typeof entry === 'string' ? [key, `inconnu_${entry}`]
          : key === 'sourceId' && typeof entry === 'string' ? [key, `inconnu_${entry}`]
            : key === 'source_name' && typeof entry === 'string' ? [key, `Source native inconnue (${entry})`]
              : key === 'name' && typeof entry === 'string' ? [key, `Source native inconnue (${entry})`]
                : [key, renameSources(entry)]))
    }
    return value
  }
  return {
    requests, factReads, comparisonReads, unexpectedApi, servedBatches,
    failNextBatchOnce() { failNextBatch = true },
    failNextComparisonOnlyOnce() { failNextComparisonOnly = true },
    anonymizeNextSeriesSourcesOnce() { anonymizeNextSeriesSources = true },
    delayNextBatch(resource) {
      delayNextResource = resource
      delayedStarted = new Promise((resolve) => { delayedStartedResolve = resolve })
      delayedRelease = new Promise((resolve) => { delayedReleaseResolve = resolve })
    },
    waitForDelayed() { return delayedStarted },
    releaseDelayed() { delayedReleaseResolve?.() },
    async handle(route) {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/api/resources') {
        const response = await fixtures.nativeCatalogueResponse()
        await route.fulfill({ status: 200, contentType: 'application/json', body: await response.text() })
        return
      }
      if (url.pathname === '/api/resources/read-batch' && request.method() === 'POST') {
        const body = request.postDataJSON()
        requests.push(...body.items)
        const hasFacts = body.items.some((item) => item.intent.kind === 'facts')
        const hasComparison = body.items.some((item) => item.intent.kind !== 'facts')
        if (hasFacts) factReads.push(...body.items.filter((item) => item.intent.kind === 'facts'))
        if (hasComparison) comparisonReads.push(...body.items.filter((item) => item.intent.kind !== 'facts'))
        const resource = body.items[0]?.resource
        if (failNextBatch) {
          failNextBatch = false
          await route.fulfill({ status: 503, contentType: 'text/plain', body: 'series read temporarily unavailable' })
          return
        }
        if (failNextComparisonOnly && hasComparison && !hasFacts) {
          failNextComparisonOnly = false
          await route.fulfill({ status: 503, contentType: 'text/plain', body: 'comparison temporarily unavailable' })
          return
        }
        if (delayNextResource === resource ||
            (delayNextResource && body.items.some((item) => item.resource === delayNextResource))) {
          delayNextResource = null
          delayedStartedResolve?.()
          await delayedRelease
        }
        const response = await fixtures.nativeBatchResponse(body.items, (item, declaration) => {
          const data = fixtures.nativeReadFixture(item, declaration, { territories })
          return sentinelSeriesData(data)
        })
        const parsed = JSON.parse(await response.text())
        if (anonymizeNextSeriesSources && body.items.some((item) =>
          resources.find((candidate) => candidate.resource_id === item.resource)?.shapes?.includes('ordered_series'))) {
          anonymizeNextSeriesSources = false
          const anonymized = JSON.parse(JSON.stringify(renameSources(parsed)))
          servedBatches.push({ items: body.items, response: anonymized })
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(anonymized) })
          return
        }
        servedBatches.push({ items: body.items, response: parsed })
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(parsed) })
        return
      }
      unexpectedApi.push({ path: url.pathname, method: request.method() })
      await route.fulfill({ status: 599, contentType: 'text/plain', body: 'Unexpected API request in #857 browser proof' })
    },
  }
}

const compactText = (value) => value.replace(/[\s\u00a0\u202f]+/gu, '')

const server = await createServer({ configFile: resolve(appRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false } })
let browser
const pageErrors = []
const externalFailures = []

try {
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  const fixtures = await server.ssrLoadModule('/src/__tests__/helpers/semanticApiFixtures.ts')
  const territoiresFixture = JSON.parse(await readFile(resolve(repoRoot, 'public/data/territoires.json'), 'utf8'))
  const { formaterValeur, formaterRang } = await server.ssrLoadModule('/src/payload/selectors.ts')
  const { orderedSeriesFacts } = await server.ssrLoadModule('/src/payload/orderedSeriesAdapter.ts')
  const { acquireOrderedSeriesSemantic } = await server.ssrLoadModule('/src/payload/seriesSemanticAcquisition.ts')
  const { dispatchIndicatorFamily } = await server.ssrLoadModule('/src/indicateurs/familySeam.ts')
  const { modeleTrajectoire, modeleExploration } = await server.ssrLoadModule('/src/indicateurs/explorationModel.ts')

  const allResources = fixtures.nativeResources()
  const metadataByTheme = Object.fromEntries(await Promise.all(THEMES.map(async (theme) => {
    const text = await readFile(resolve(repoRoot, 'public/data', `theme_${theme}.json`), 'utf8')
    return [theme, JSON.parse(text)]
  })))
  const census = allResources.flatMap((resource) => {
    if (!resource.shapes.includes('ordered_series') || !resource.target_kinds.includes('territory_cohort') ||
        !resource.intents.includes('facts')) return []
    const metadata = metadataByTheme[resource.theme_id]
    const page = metadata?.indicator_pages?.[resource.resource_id]
    const registered = Boolean(page?.series_dataset_id || metadata?.owned_series_routes?.[resource.resource_id])
    if (!page || !registered || !['trajectory', 'scalar'].includes(page.family)) return []
    return [{ theme: resource.theme_id, indicator: resource.resource_id, page, resource }]
  }).sort((a, b) => `${a.theme}/${a.indicator}`.localeCompare(`${b.theme}/${b.indicator}`))
  assert.deepEqual(census.map(({ theme, indicator }) => `${theme}/${indicator}`), expectedPages,
    'The producer/API/page-grammar intersection must stay complete for all five series pages')

  // Deliberately stale editorial presentation must not own native facts.
  const staleMetadata = Object.fromEntries(THEMES.map((theme) => {
    const clone = structuredClone(metadataByTheme[theme])
    for (const page of Object.values(clone.indicator_pages ?? {})) {
      if (page?.series_dataset_id || clone.owned_series_routes?.[page?.indicator]) {
        page.unit = 'unité éditoriale obsolète'
        page.direction = page.direction === 'low' ? 'high' : 'low'
      }
    }
    return [theme, clone]
  }))

  const harness = createHarness(allResources, territoiresFixture, fixtures)
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const requests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  page.on('requestfailed', (request) => {
    if (!new URL(request.url()).hostname.startsWith('127.0.0.1') && request.failure()?.errorText !== 'net::ERR_ABORTED') {
      externalFailures.push(`${request.url()} (${request.failure()?.errorText ?? 'request failed'})`)
    }
  })
  await page.route('**/api/**', (route) => harness.handle(route))
  for (const theme of THEMES) {
    await page.route(`**/data/theme_${theme}.json`, (route) => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify(staleMetadata[theme]) }))
  }

  /** Recompute the page's expected model through the app's own seams from the
   *  exact transformed batch the browser received. */
  async function expectedModel(spec, { level, focal, department, epci, facetQuery }) {
    const stored = [...harness.servedBatches].reverse().find(({ items }) =>
      items.some((item) => item.resource === spec.indicator &&
        item.target?.kind === 'territory_cohort' && item.intent?.kind === 'facts') &&
      items.some((item) => item.resource === spec.indicator && item.intent?.kind !== 'facts'))
    assert(stored, `${spec.indicator}: the browser batch must be captured before recomputation`)
    const previousFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify(stored.response), { status: 200, contentType: 'application/json' })
    try {
      const read = await acquireOrderedSeriesSemantic({ resource: spec.indicator, level, focal,
        territories: territoiresFixture, includeScalarFacet: spec.resource.shapes.includes('scalar'),
        ...(department ? { departmentId: department } : {}), ...(epci ? { epciId: epci } : {}) })
      const axisFacet = spec.page.comparison?.dimensions !== undefined || spec.page.comparison?.dimension !== undefined
        ? 'dimension' : 'detail'
      const facts = orderedSeriesFacts(read, spec.theme, territoiresFixture, axisFacet)
      const axes = read.comparison?.axis_comparisons?.map((row) => row.axis) ?? []
      const editorial = metadataByTheme[spec.theme].indicator_pages[spec.indicator]
      const dimensionFacet = editorial.comparison?.dimensions !== undefined || editorial.comparison?.dimension !== undefined
      const permitted = dimensionFacet
        ? { dimensions: axes, dimension: axes.includes(editorial.comparison?.dimension ?? '')
          ? editorial.comparison?.dimension : axes.at(-1) }
        : { details: axes, detail: axes.includes(editorial.comparison?.detail ?? '')
          ? editorial.comparison?.detail : axes.at(-1) }
      const boundPage = { ...editorial, label: read.native_descriptor.label, unit: read.native_descriptor.unit,
        direction: read.native_descriptor.direction === 'none' ? editorial.direction : read.native_descriptor.direction,
        comparison: { ...editorial.comparison, ...permitted, unit: read.native_descriptor.unit,
          direction: read.native_descriptor.direction === 'none' ? editorial.comparison?.direction : read.native_descriptor.direction } }
      const dispatch = dispatchIndicatorFamily(boundPage, { theme: spec.theme, facts,
        territories: territoiresFixture, selected: focal.territoire, facet: facetQuery })
      const requested = { niveau: level, ...(department ? { departement: department } : {}),
        ...(epci ? { epci } : {}), territoire: focal.territoire }
      const exploration = modeleExploration(facts, dispatch.facet, territoiresFixture, requested, undefined, false)
      const rankSorted = modeleExploration(facts, dispatch.facet, territoiresFixture,
        { ...requested, tri: 'rang', ordre: 'asc' }, undefined, false)
      const trajectory = dispatch.family === 'trajectory'
        ? modeleTrajectoire(facts, dispatch.facet, boundPage.trajectory.endpoints, territoiresFixture,
          { niveau: level, territoire: focal.territoire }, [], null, { nativeSeries: true,
            nativeAxisComparisons: read.comparison?.axis_comparisons })
        : null
      return { read, facts, dispatch, exploration, rankSorted, trajectory, boundPage }
    } finally { globalThis.fetch = previousFetch }
  }

  const routeEvidence = []
  for (const spec of census) {
    const isRaccordement = spec.indicator === 'raccordement_courbe'
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')
    assert(focal, 'Browser fixture must contain the selected commune')
    const level = 'commune'
    const facetQuery = spec.indicator === 'subventions_annuelles' ? { dimension: '2025' }
      : spec.indicator === 'prix_m2' ? { detail: '2022' }
        : spec.indicator === 'conso_enaf_annuel' ? { detail: '2024' } : {}
    const factStart = harness.factReads.length
    const query = new URLSearchParams({ territoire: focal.territoire, niveau: level, ...facetQuery })
    if (level === 'commune' && !isRaccordement) query.set('departement', '22')
    await page.goto(`${baseUrl}indicateurs/${spec.theme}/${spec.indicator}?${query}&vue=reperes`,
      { waitUntil: 'domcontentloaded' })
    try {
      await page.locator('h1').filter({ hasText: spec.resource.label }).waitFor({ state: 'visible', timeout: 20000 })
    } catch (cause) {
      if (process.env.LUSK_SERIES_PROOF_DEBUG) {
        await page.screenshot({ path: `E:/Temp/opencode/857-series-evidence/wip/debug-h1-${spec.indicator}.png`, fullPage: false })
        const text = await page.locator('body').innerText().catch(() => 'no body')
        console.error(`DEBUG H1 ${spec.indicator}: url=${page.url()} h1=${await page.locator('h1').innerText().catch(() => 'none')} body=${text.slice(0, 300).replace(/\s+/g, ' ')}`)
      }
      throw cause
    }
    await page.locator('figure[data-renderer], .indicateur-page').first().waitFor({ state: 'visible', timeout: 20000 })
    await page.waitForTimeout(250)

    const expected = isRaccordement ? null : await expectedModel(spec, {
      level, focal, department: '22', epci: undefined, facetQuery })
    const bodyText = await page.locator('body').innerText()
    assert.equal(bodyText.includes('unité éditoriale obsolète'), false,
      `${spec.indicator}: the stale editorial unit must never replace the native descriptor unit`)
    assert(bodyText.includes(spec.resource.unit), `${spec.indicator} must render its API unit`)

    // One bounded batch; no per-member fan-out, no retired routes.
    const seriesReads = harness.requests.slice(factStart).filter((item) => item.resource === spec.indicator)
    if (isRaccordement) {
      assert(seriesReads.length >= 2 && seriesReads.length <= 12,
        `raccordement rides the retained theme acquisition within bounds (${seriesReads.length})`)
    } else {
      assert(seriesReads.length === 3,
        `${spec.indicator} must acquire exactly cohort+focal+comparison in one bounded batch (${seriesReads.length})`)
      assert(seriesReads[2]?.fields?.includes('axis_comparisons'),
        `${spec.indicator} must request the axis_comparisons projection`)
    }

    if (expected) {
      assert(bodyText.includes(expected.read.native_descriptor.label),
        `${spec.indicator} must render the native descriptor label`)
      const activeCoordinate = Object.values(facetQuery)[0] ?? null
      const trajectoryFamily = expected.dispatch.family === 'trajectory'
      if (activeCoordinate && trajectoryFamily) {
        const focalPoint = expected.read.points.find((point) => point.axis === activeCoordinate)
        const rendered = page.locator(`.trajectoire-territoire-point[data-detail="${activeCoordinate}"]`)
        if (focalPoint?.status === 'measured') {
          await rendered.waitFor({ state: 'visible', timeout: 20000 })
          assert.equal(await rendered.getAttribute('data-value'), String(focalPoint.value),
            `${spec.indicator} focal point at ${activeCoordinate} must bind the sentinel API value`)
        } else {
          if (await rendered.count()) {
            assert.equal(await rendered.getAttribute('data-value'), null,
              `${spec.indicator} missing ${activeCoordinate} focal point must not invent a value`)
          }
          const comparison = (expected.read.comparison?.axis_comparisons ?? [])
            .find((row) => row.axis === activeCoordinate)
          if (comparison?.status !== 'available') {
            assert.equal(await page.locator(`[data-etape="${activeCoordinate}"]`).getAttribute('data-etat'), 'sans-valeur',
              `${spec.indicator} missing ${activeCoordinate} step must render as a no-value fact, never zero`)
          }
        }
      }
      // Native per-step medians render from axis_comparisons, not browser math.
      const medianTitles = trajectoryFamily
        ? await page.locator('.trajectoire-mediane-point title').allTextContents() : []
      for (const comparison of trajectoryFamily
        ? (expected.read.comparison?.axis_comparisons ?? []) : []) {
        if (comparison.status !== 'available' || comparison.value === null) continue
        const formatted = formaterValeur({ value: comparison.value, unit: expected.boundPage.unit })
        assert(medianTitles.some((title) => title.includes(comparison.axis) && title.includes(formatted)),
          `${spec.indicator} step ${comparison.axis} must render the native ${comparison.statistic} ${formatted}: ${JSON.stringify(medianTitles)}`)
      }
      // Hero summary and peer table bind the same served facts.
      if (expected.exploration.median !== null) {
        const heroText = await page.locator('.median').innerText()
        assert(heroText.includes(formaterValeur({ value: expected.exploration.median, unit: expected.boundPage.unit })),
          `${spec.indicator} hero median must equal the model recomputed from the served batch: ${heroText}`)
      }
      const rowCount = await page.locator('tbody tr').count()
      assert.equal(rowCount, expected.exploration.rows.length,
        `${spec.indicator} peer table must render exactly the comparable population`)
      if (rowCount > 1) {
        await page.locator('.comparison-table-scroll thead').getByRole('button', { name: 'Rang', exact: true }).click()
        await page.waitForTimeout(120)
        const sortedRows = await page.locator('tbody tr').evaluateAll((rows) => rows.map((row) =>
          decodeURIComponent((row.querySelector('td a')?.getAttribute('href') ?? '').split('?')[0].split('/').at(-1) ?? '')))
        const expectedOrder = expected.rankSorted.rows.map((row) => row.territoire.territoire)
        if (process.env.LUSK_SERIES_PROOF_DEBUG && sortedRows.join() !== expectedOrder.join()) {
          let firstDiff = -1
          for (let index = 0; index < Math.max(sortedRows.length, expectedOrder.length); index++) {
            if (sortedRows[index] !== expectedOrder[index]) { firstDiff = index; break }
          }
          const liveRanks = await page.locator('tbody tr').evaluateAll((rows) => rows.map((row) =>
            [decodeURIComponent((row.querySelector('td a')?.getAttribute('href') ?? '').split('?')[0].split('/').at(-1) ?? ''),
              row.querySelectorAll('td')[1]?.innerText.trim(), row.querySelectorAll('td')[2]?.innerText.trim()]))
          const expectedRanks = expected.rankSorted.rows.map((row) =>
            [row.territoire.territoire, row.value, row.rang, row.rangTaille])
          console.error(`DEBUG SORT ${spec.indicator}: firstDiff=${firstDiff}` +
            ` aroundLive=${JSON.stringify(liveRanks.slice(Math.max(0, firstDiff - 2), firstDiff + 4))}` +
            ` aroundExpected=${JSON.stringify(expectedRanks.slice(Math.max(0, firstDiff - 2), firstDiff + 4))}`)
        }
        assert.deepEqual(sortedRows, expectedOrder,
          `${spec.indicator} table rank sort must follow the model's rank order`)
        const focalRowRank = expected.rankSorted.rows.find((row) => row.territoire.territoire === focal.territoire)?.rang
        if (focalRowRank !== null && focalRowRank !== undefined) {
          const focalRowText = await page.locator('tbody tr.selection').innerText()
          assert(focalRowText.includes(formaterRang(focalRowRank, expected.rankSorted.rows.length)),
            `${spec.indicator} focal row must render its model rank`)
        }
      }
    }
    if (isRaccordement) {
      assert((await page.locator('.trajectoire-territoire-point').count()) > 0,
        'raccordement must render its native duration curve points')
      assert.equal(await page.locator('.trajectoire-reference').count(), 1,
        'raccordement must render its exact named reference curve')
      assert.equal(await page.locator('[data-testid="raccordement-selected-mean"]').count(), 1,
        'raccordement must render its selected-group mean at the supported level')
    }

    // Source card: native provenance, exact-identity Sources link, revision hash.
    await page.getByRole('button', { name: 'L’indicateur', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.includes('Chargement'))
    const sourceCards = page.locator('.source-card')
    await sourceCards.first().waitFor({ state: 'visible', timeout: 20000 })
    const sourceText = await sourceCards.first().innerText()
    const nativeSource = isRaccordement
      ? null
      : expected.read.points.find((point) => point.provenance?.length)?.provenance?.[0]
    if (isRaccordement) {
      // The combined producer record: one card, native name/dates/revision
      // hash. Its API source id (raccordement_gtfs_national) matches no
      // Sources record, so the Sources-page link is truthfully omitted (#732).
      assert(sourceText.includes('Révision :'), 'raccordement source card must expose the API revision hash')
      assert.equal(await page.locator('.source-card a[href^="/sources#"]').count(), 0,
        'raccordement must omit the Sources link without an exact record match')
    } else if (nativeSource?.source_name) {
      assert(sourceText.includes(nativeSource.source_name), `${spec.indicator} source card must expose the API source name`)
      assert(sourceText.includes(nativeSource.reference_date) && sourceText.includes(nativeSource.publication_date),
        `${spec.indicator} source card must expose the API reference/publication dates`)
      assert(sourceText.includes('Révision :') && sourceText.includes(nativeSource.revision_hash),
        `${spec.indicator} source card must expose the API revision hash`)
      assert(await page.locator('.source-card a[href^="/sources#"]').first().isVisible(),
        `${spec.indicator} native source identity matches a Sources record; the fiche-source link must render`)
    }

    // Indicator-page Carte maps the active coordinate's native layer.
    await page.getByRole('button', { name: 'Carte', exact: true }).click()
    const mapPoint = expected
      ? expected.read.points.find((point) => point.axis === (Object.values(facetQuery)[0] ?? null) &&
        point.status === 'measured')
      : null
    if (mapPoint) {
      await page.locator('.popup-carte-kpi').first().waitFor({ state: 'visible', timeout: 20000 })
      const mapText = await page.locator('.popup-carte').innerText()
      const expectedApiValue = formaterValeur({ value: mapPoint.value, unit: expected.boundPage.unit })
      assert(compactText(mapText).includes(compactText(expectedApiValue)) && mapText.includes(spec.resource.unit),
        `${spec.indicator} indicator map must render the native API value/unit: ${mapText}`)
    } else {
      await page.locator('.map-explorer').waitFor({ state: 'visible', timeout: 20000 })
    }
    routeEvidence.push({ theme: spec.theme, indicator: spec.indicator, unit: spec.resource.unit,
      focal: focal.territoire, level, coordinate: Object.values(facetQuery)[0] ?? null,
      nativeComparisons: isRaccordement ? 'mean_curve+named_reference' :
        (expected.read.comparison?.axis_comparisons ?? []).map((row) => [row.axis, row.status, row.value]) })
    await page.getByRole('button', { name: 'Repères', exact: true }).click()
  }

  // OCS-GE approved restriction: calendar facts stay visible as facts, while
  // comparison evidence and the selector keep the published M2/M3 roles only.
  // The EPCI level carries real published M2/M3 peer evidence (4 measured EPCIs).
  const artif = census.find(({ indicator }) => indicator === 'artif_par_habitant')
  assert(artif)
  const epciFocal = territoiresFixture.find((territory) => territory.type === 'epci' &&
    territory.territoire === '243500725')
  assert(epciFocal, 'Browser fixture must contain the M3-measured EPCI')
  await page.goto(`${baseUrl}indicateurs/milieux/artif_par_habitant?territoire=${epciFocal.territoire}&niveau=epci&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('h1').filter({ hasText: artif.page.label }).waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-etape]').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(250)
  const selectorOptions = await page.locator('select').evaluateAll((selects) =>
    selects.map((select) => Array.from(select.options).map((option) => option.value)))
  const comparisonSelect = selectorOptions.find((options) => options.includes('M2') && options.includes('M3'))
  assert(comparisonSelect, 'the OCS-GE comparison selector must offer the published state roles')
  assert(comparisonSelect.every((value) => value === '' || value === 'M2' || value === 'M3'),
    `the OCS-GE comparison selector must not offer calendar years: ${JSON.stringify(comparisonSelect)}`)
  const calendarSteps = ['2020', '2021', '2022', '2023', '2024', '2025']
  const calendarEtats = {}
  for (const year of calendarSteps) {
    const etape = page.locator(`[data-etape="${year}"]`)
    if (await etape.count()) calendarEtats[year] = await etape.getAttribute('data-etat')
  }
  for (const [year, etat] of Object.entries(calendarEtats)) {
    assert.equal(etat, 'sans-valeur', `calendar step ${year} must not carry peer aggregate evidence`)
  }
  const m3Etape = page.locator('[data-etape="M3"]')
  assert.equal(await m3Etape.getAttribute('data-etat'), 'valeurs',
    'the published M3 role keeps its native peer comparison')
  const artificialCaption = await page.locator('figure[data-renderer="trajectory"] figcaption').innerText()
  assert(artificialCaption.includes('Comparaison non publiée pour'),
    'the trajectory must name the unpublished calendar comparisons')
  const calendarFactPoint = await page.locator('.trajectoire-territoire-point[data-detail^="20"]').count()
  assert(calendarFactPoint > 0, 'calendar observations remain rendered as factual trajectory points')
  // The indicator-page Carte maps the published M3 role with its native value.
  await page.getByRole('button', { name: 'Carte', exact: true }).click()
  await page.locator('.popup-carte-kpi').first().waitFor({ state: 'visible', timeout: 20000 })
  const artifMapText = await page.locator('.popup-carte').innerText()
  const artifM3 = SENTINEL(947.2711327209256)
  assert(compactText(artifMapText).includes(compactText(formaterValeur({ value: artifM3, unit: artif.resource.unit }))),
    `the OCS-GE map must render the native M3 role value: ${artifMapText}`)
  await page.getByRole('button', { name: 'Repères', exact: true }).click()
  // A legacy calendar URL resolves truthfully: the role replaces the year label.
  await page.goto(`${baseUrl}indicateurs/milieux/artif_par_habitant?territoire=${epciFocal.territoire}&niveau=epci&detail=2023&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-etape]').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(250)
  const canonicalDetail = new URL(page.url()).searchParams.get('detail')
  assert(canonicalDetail === 'M3' || canonicalDetail === 'M2',
    `a legacy calendar URL must canonicalize to the published role, never keep a year label: ${canonicalDetail}`)
  const relabelledCaption = await page.locator('figure[data-renderer="trajectory"] figcaption').innerText()
  assert(relabelledCaption.includes('Comparaison non publiée pour'),
    'the canonicalized role view must still mark the calendar steps as unpublished comparisons')
  // A missing prix_m2 annual point never invents a value (and never renders zero).
  await page.goto(`${baseUrl}indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22&detail=2024&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-etape="2024"]').waitFor({ state: 'visible', timeout: 20000 })
  const missingPrixPoint = page.locator('.trajectoire-territoire-point[data-detail="2024"]')
  if (await missingPrixPoint.count()) {
    assert.equal(await missingPrixPoint.getAttribute('data-value'), null,
      'a missing annual price point must not invent a value')
  }

  // A URL focal outside the filtered cohort keeps its own bounded focal read.
  const outsideFocal = territoiresFixture.find((territory) => territory.type === 'commune' &&
    territory.departement !== '35' && territory.departement !== '22')
  assert(outsideFocal, 'Browser fixture must contain an out-of-scope commune')
  const outsideStart = harness.requests.length
  await page.goto(`${baseUrl}indicateurs/milieux/conso_enaf_annuel?territoire=${outsideFocal.territoire}&niveau=commune&departement=22&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('h1').waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(400)
  const outsideReads = harness.requests.slice(outsideStart).filter((item) => item.resource === 'conso_enaf_annuel')
  assert(outsideReads.some((item) => item.target.kind === 'territory' && item.target.id === outsideFocal.territoire),
    'the out-of-cohort focal must receive its own bounded territory read')

  // Whole-batch HTTP failure: page error, forced retry recovers.
  harness.failNextBatchOnce()
  await page.goto(`${baseUrl}indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[role="alert"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await page.locator('figure[data-renderer="trajectory"]').waitFor({ state: 'visible', timeout: 20000 })
  assert.equal(await page.locator('[role="alert"]').count(), 0, 'the forced retry must recover the page')

  // Comparison-only HTTP failure keeps acquired facts; the retry re-reads only
  // the comparison evidence (raccordement's separately acquired comparison).
  await page.goto(`${baseUrl}indicateurs/mobilite/raccordement_courbe?territoire=22001&niveau=commune&departement=22&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('h1').filter({ hasText: 'raccordement' }).waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-testid="raccordement-selected-mean"]').waitFor({ state: 'visible', timeout: 20000 })
  harness.failNextComparisonOnlyOnce()
  await page.locator('[data-testid="raccordement-comparison-error"]').waitFor({ state: 'visible', timeout: 20000 })
  const factsWhileBroken = harness.requests.length
  assert((await page.locator('.trajectoire-territoire-point').count()) > 0,
    'the acquired curve must stay visible during a comparison-only failure')
  await page.getByTestId('raccordement-comparison-retry').click()
  await page.locator('[data-testid="raccordement-selected-mean"]').waitFor({ state: 'visible', timeout: 20000 })
  assert.equal(harness.requests.length, factsWhileBroken,
    'the comparison-only retry must not reread facts')

  // A late series batch from a previous route cannot overwrite the new page.
  harness.delayNextBatch('conso_enaf_annuel')
  await page.goto(`${baseUrl}indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await harness.waitForDelayed()
  await page.evaluate(() => {
    history.pushState({}, '', '/indicateurs/programmes/subventions_annuelles?territoire=22001&vue=reperes')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.locator('h1').filter({ hasText: 'subventions' }).waitFor({ state: 'visible', timeout: 20000 })
  harness.releaseDelayed()
  await page.waitForTimeout(150)
  assert((await page.locator('h1').innerText()).includes('subventions'),
    'a late conso response must not overwrite the new route')
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 20000 })

  // Small screen keeps the page inside its viewport.
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`${baseUrl}indicateurs/programmes/subventions_annuelles?territoire=22001&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 20000 })
  const mobile = await page.evaluate(() => {
    const root = document.querySelector('.indicateur-page')
    const table = document.querySelector('.comparison-table-scroll')
    return { viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
      rootClient: root?.clientWidth, rootScroll: root?.scrollWidth, tableOverflowX: table && getComputedStyle(table).overflowX }
  })
  assert(mobile.document <= mobile.viewport && mobile.rootClient === mobile.rootScroll,
    `360px series page must not overflow: ${JSON.stringify(mobile)}`)

  // Source no-match probe: an API source identity without a Sources record
  // keeps its native card but never receives a fabricated Sources link.
  await page.setViewportSize({ width: 1280, height: 900 })
  harness.anonymizeNextSeriesSourcesOnce()
  await page.goto(`${baseUrl}indicateurs/programmes/subventions_annuelles?territoire=22001&vue=indicateur`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('.source-card').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(300)
  const anonymizedText = await page.locator('.source-card').first().innerText()
  assert(anonymizedText.includes('Source native inconnue'), 'the card must keep the native (anonymized) identity')
  assert.equal(await page.locator('.source-card a[href^="/sources#"]').count(), 0,
    'a source identity without an exact Sources match must not render a Sources link')

  const retired = requests.filter((path) => path.includes('/series-datasets') ||
    /\/api\/territories\/.*\/(series|themes)\//.test(path) || path.includes('/indicator-cohorts/'))
  assert.deepEqual(retired, [], 'No retired series/cohort route may be called')
  assert.deepEqual(harness.unexpectedApi, [], 'Every API request is intercepted')
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('; ')}`)
  assert.deepEqual(externalFailures, [], `Unexpected external requests: ${externalFailures.join('; ')}`)
  const headAtEnd = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const branchAtEnd = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const statusAtEnd = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  assert.equal(headAtEnd, headAtStart, 'HEAD must remain unchanged during browser verification')
  assert.equal(branchAtEnd, branchAtStart, 'Branch must remain unchanged during browser verification')
  assert.equal(statusAtEnd, '', 'Source tree must remain clean throughout browser verification')
  console.log(JSON.stringify({ issue: '#857', branchAtStart, branchAtEnd, headAtStart, headAtEnd,
    sourceCleanBeforeAndAfter: true, modeVariables: 'all VITE_* variables unset',
    pageCount: census.length, pages: routeEvidence,
    ocsgeRestriction: { comparisonSelector: comparisonSelect,
      calendarStepsWithoutPeerAggregates: calendarEtats,
      calendarFactPoints: calendarFactPoint, legacyCalendarUrlCanonicalDetail: canonicalDetail },
    checks: ['all five producer/API/page-grammar series identities',
      'sentinel-bound focal values, native descriptor label/unit/direction over stale editorial metadata',
      'native per-step comparison medians from axis_comparisons (not browser math)',
      'peer table population + rank sort + focal rank', 'OCS-GE M2/M3-only comparison selector',
      'calendar facts visible without calendar peer aggregates', 'legacy calendar URL canonicalization',
      'out-of-cohort focal bounded read', 'whole-batch 503 forced retry recovery',
      'comparison-only 503 retry with unchanged fact reads', 'late response rejection',
      'source cards: native provenance/dates/revision hash + exact-identity Sources link + no-match suppression',
      'indicator-page Carte native value/unit', '360px no page overflow'],
    counts: { apiRequests: harness.requests.length,
      cohortFacts: harness.factReads.filter((item) => item.target.kind === 'territory_cohort').length,
      focalFacts: harness.factReads.filter((item) => item.target.kind === 'territory').length,
      comparisons: harness.comparisonReads.length, retiredCalls: retired.length,
      unexpectedApiRequests: harness.unexpectedApi.length, pageErrors: pageErrors.length },
    mobile }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
