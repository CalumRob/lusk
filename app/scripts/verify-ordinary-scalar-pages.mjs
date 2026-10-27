import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Bounded browser proof for #855. The API catalogue and response envelopes are
// generated from the producer-derived test bridge; all API traffic is intercepted.
// Run from app/: npm run verify:ordinary-scalar-pages
for (const name of Object.keys(process.env)) if (name.startsWith('VITE_')) delete process.env[name]
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
const headAtStart = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const themes = ['demographie', 'economie', 'habitat', 'mobilite']
const expectedPages = [
  'demographie/densite', 'demographie/evolution_1968', 'demographie/taille_menages',
  'economie/chomage', 'economie/eco_activites', 'economie/effectifs_salaries',
  'habitat/part_passoires',
  'mobilite/bornes_ev_par_station_service', 'mobilite/bornes_recharge',
  'mobilite/offre_tc', 'mobilite/places_stationnement_velo_1000',
  'mobilite/places_stationnement_voiture_1000', 'mobilite/raccordement_tc',
  'mobilite/surface_reseaux_routiers', 'mobilite/stationnement_velo_par_voiture',
].sort()

function createHarness(resources, territories, fixtures) {
  const byResource = new Map(resources.map((resource) => [resource.resource_id, resource]))
  const requests = []
  const unexpectedApi = []
  const factReads = []
  const comparisonReads = []
  let failNextComparison = false
  let delayResource = null
  let delayedStartedResolve
  let delayedReleaseResolve
  let delayedStarted = new Promise((resolve) => { delayedStartedResolve = resolve })
  let delayedRelease = new Promise((resolve) => { delayedReleaseResolve = resolve })

  function sentinel(data) {
    // An increasing affine transform gives deliberately different API values
    // while preserving producer fixture rank/tie evidence and its unit/clocks.
    if (Array.isArray(data.observations)) {
      data.observations = data.observations.map((observation) => observation.status === 'measured'
        ? { ...observation, value: Number(observation.value) * 10 + 1234.5 } : observation)
    }
    if (data.observation?.status === 'measured') {
      data.observation.value = Number(data.observation.value) * 10 + 1234.5
    }
    if (typeof data.value === 'number') data.value = data.value * 10 + 1234.5
    if (data.result && typeof data.result.median === 'number') data.result.median = data.result.median * 10 + 1234.5
    if (data.scalar_facet?.result && typeof data.scalar_facet.result.median === 'number') {
      data.scalar_facet.result.median = data.scalar_facet.result.median * 10 + 1234.5
    }
    return data
  }

  return {
    requests, factReads, comparisonReads, unexpectedApi,
    failComparison() { failNextComparison = true },
    delayFacts(resource) {
      delayResource = resource
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
        const fact = body.items.some((item) => item.intent.kind === 'facts')
        const resource = body.items[0]?.resource
        if (fact) factReads.push(...body.items.filter((item) => item.intent.kind === 'facts'))
        else comparisonReads.push(...body.items)
        if (!fact && failNextComparison) {
          failNextComparison = false
          await route.fulfill({ status: 503, contentType: 'text/plain', body: 'comparison temporarily unavailable' })
          return
        }
        if (fact && delayResource === resource) {
          delayResource = null
          delayedStartedResolve?.()
          await delayedRelease
        }
        const response = fixtures.nativeBatchResponse(body.items, (item, declaration) => {
          const context = { territories: territories }
          const data = fixtures.nativeReadFixture(item, declaration, context)
          return sentinel(data)
        })
        await route.fulfill({ status: 200, contentType: 'application/json', body: await response.text() })
        return
      }
      unexpectedApi.push({ path: url.pathname, method: request.method() })
      await route.fulfill({ status: 599, contentType: 'text/plain', body: 'Unexpected API request in #855 browser proof' })
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
  const { formaterValeur } = await server.ssrLoadModule('/src/payload/selectors.ts')
  const resources = fixtures.nativeResources().filter((resource) => resource.shapes.length === 1 && resource.shapes[0] === 'scalar' &&
    resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts'))
  const metadataByTheme = Object.fromEntries(await Promise.all(themes.map(async (theme) => {
    const text = await readFile(resolve(repoRoot, 'public/data', `theme_${theme}.json`), 'utf8')
    return [theme, JSON.parse(text)]
  })))
  const census = resources.flatMap((resource) => {
    const page = metadataByTheme[resource.theme_id]?.indicator_pages?.[resource.resource_id]
    const registered = Object.hasOwn(metadataByTheme[resource.theme_id]?.scalar_contracts ?? {}, resource.resource_id)
    if (!page || !registered || (page.family !== undefined && page.family !== 'scalar')) return []
    return [{ theme: resource.theme_id, indicator: resource.resource_id, page, resource }]
  }).sort((a, b) => `${a.theme}/${a.indicator}`.localeCompare(`${b.theme}/${b.indicator}`))
  assert.deepEqual(census.map(({ theme, indicator }) => `${theme}/${indicator}`), expectedPages,
    'The API/page-grammar intersection must stay complete for all 15 ordinary scalar pages')
  assert(!census.some(({ indicator }) => ['prix_m2', 'subventions_annuelles'].includes(indicator)))

  const fixtureMeta = JSON.parse(await readFile(resolve(repoRoot, 'public/data/theme_demographie.json'), 'utf8'))
  // Deliberately stale editorial values must not own native unit/direction/source.
  const staleMetadata = structuredClone(fixtureMeta)
  staleMetadata.indicator_pages.densite.unit = 'unité éditoriale obsolète'
  staleMetadata.indicator_pages.densite.direction = 'low'
  staleMetadata.indicator_pages.densite.read_model = false
  const harness = createHarness(resources, territoiresFixture, fixtures)
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
  await page.route('**/data/territoires.json', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(territoiresFixture) }))
  await page.route('**/data/theme_demographie.json', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(staleMetadata) }))

  const focal = territoiresFixture.find((territory) => territory.type === 'commune' && territory.territoire === '22001')
  assert(focal?.epci, 'Browser fixture must contain the selected commune and its EPCI identity')
  const focusFor = (spec) => {
    const countsAvailable = Boolean(metadataByTheme[spec.theme].scalar_contracts[spec.indicator].counts_available)
    const probe = fixtures.nativeReadFixture({ resource: spec.indicator,
      target: { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null },
      fields: countsAvailable ? ['value', 'support_count', 'denominator_count'] : ['value'],
      intent: { kind: 'facts' } }, spec.resource, { territories: territoiresFixture })
    const refs = new Map(territoiresFixture.map((territory) => [territory.territoire, territory]))
    const byEpci = new Map()
    for (const observation of probe.observations ?? []) {
      if (observation.status !== 'measured') continue
      const reference = refs.get(observation.territory.id)
      if (!reference?.epci) continue
      const members = byEpci.get(reference.epci) ?? []
      members.push(observation)
      byEpci.set(reference.epci, members)
    }
    const selected = [...byEpci.entries()].sort((left, right) => right[1].length - left[1].length)[0]
    if (!selected) return focal
    const territoryId = selected[1][0].territory.id
    const territory = refs.get(territoryId)
    return { ...territory, epci: selected[0] }
  }
  const routeEvidence = []
  for (const spec of census) {
    const pageFocal = focusFor(spec)
    const factStart = harness.factReads.length
    const compareStart = harness.comparisonReads.length
    const epciQuery = spec.page.levels.includes('commune') ? `&epci=${pageFocal.epci}` : ''
    await page.goto(`${baseUrl}indicateurs/${spec.theme}/${spec.indicator}?territoire=${pageFocal.territoire}&niveau=commune${epciQuery}&vue=reperes`,
      { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: spec.page.label }).waitFor({ state: 'visible', timeout: 20000 })
    await page.locator('[data-testid="scalar-comparison-summary"], [data-testid="scalar-comparison-unavailable"]').first()
      .waitFor({ state: 'visible', timeout: 20000 })
    const factItem = harness.factReads.slice(factStart).find((item) => item.resource === spec.indicator &&
      item.target.kind === 'territory_cohort')
    assert(factItem, `${spec.indicator} must acquire its selected native scalar cohort`)
    assert.equal(factItem.fields.includes('support_count'), Boolean(spec.page.counts_available ??
      metadataByTheme[spec.theme].scalar_contracts[spec.indicator].counts_available),
    `${spec.indicator} must request only producer-supported support fields`)
    const comparisonItem = harness.comparisonReads.slice(compareStart).find((item) => item.resource === spec.indicator)
    assert(comparisonItem, `${spec.indicator} must acquire native comparison evidence`)
    const rowCount = await page.locator('tbody tr').count()
    assert.equal(rowCount > 0, true,
      `${spec.indicator} should render peer rows; focal=${pageFocal.territoire} epci=${pageFocal.epci}; ` +
      `native target=${JSON.stringify(factItem.target)}; comparison=${JSON.stringify(comparisonItem)}`)
    assert((await page.locator('body').innerText()).includes(spec.resource.unit), `${spec.indicator} must render its API unit`)
    const bodyText = await page.locator('body').innerText()
    const nativeFact = fixtures.nativeReadFixture(factItem, spec.resource, { territories: territoiresFixture })
    const focalObservation = nativeFact.observations?.find((row) => row.territory.id === pageFocal.territoire)
    assert(focalObservation?.status === 'measured', `${spec.indicator} browser fixture needs a measured focal sentinel`)
    const expectedApiValue = formaterValeur({ value: Number(focalObservation.value) * 10 + 1234.5,
      unit: spec.resource.unit })
    assert(bodyText.includes(expectedApiValue),
      `${spec.indicator} must render changed API value ${expectedApiValue}: ${bodyText.slice(0, 1800)}`)
    assert(!(await page.locator('body').innerText()).includes('unité éditoriale obsolète'),
      'A stale scalar presentation unit must not replace the native descriptor unit')
    const rankCount = rowCount
    await page.getByRole('button', { name: 'Carte', exact: true }).click()
    await page.locator('.popup-carte-kpi').first().waitFor({ state: 'visible', timeout: 20000 })
    const mapText = await page.locator('.popup-carte').innerText()
    assert(compactText(mapText).includes(compactText(expectedApiValue)) && mapText.includes(spec.resource.unit),
      `${spec.indicator} indicator map must render native API value/unit: ${mapText}`)
    await page.getByRole('button', { name: 'L’indicateur', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.includes('Chargement'))
    const sourceText = await page.locator('body').innerText()
    const observedSource = focalObservation.sources?.[0]
    if (observedSource?.name) assert(sourceText.includes(observedSource.name), `${spec.indicator} must expose API provenance`)
    await page.getByRole('button', { name: 'Repères', exact: true }).click()
    await page.waitForFunction(() => Boolean(document.querySelector('tbody tr')))
    routeEvidence.push({ theme: spec.theme, indicator: spec.indicator, unit: spec.resource.unit,
      nativeTarget: factItem.target, comparisonKind: comparisonItem.intent.kind, focal: pageFocal.territoire,
      tableRows: rankCount, mapFact: mapText.slice(0, 500), provenance: observedSource?.name ?? null })
  }

  // Published non-commune fixed comparison is bound at its own level.
  const density = census.find(({ indicator }) => indicator === 'densite')
  assert(density)
  const epci = territoiresFixture.find((territory) => territory.type === 'epci')
  assert(epci)
  const epciStart = harness.comparisonReads.length
  await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${epci.territoire}&niveau=epci&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="scalar-comparison-summary"]').waitFor({ state: 'visible', timeout: 20000 })
  assert.equal(harness.comparisonReads.slice(epciStart).at(-1)?.intent.kind, 'fixed_comparison')
  assert.equal(harness.comparisonReads.slice(epciStart).at(-1)?.target.type, 'epci')

  // Scope changes acquire only the newly filtered commune cohort/comparison.
  const secondEpci = territoiresFixture.find((territory) => territory.type === 'epci' && territory.territoire !== focal.epci)
  assert(secondEpci)
  const scopeStart = harness.factReads.length
  await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${focal.territoire}&niveau=commune&epci=${focal.epci}&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="scalar-comparison-summary"]').waitFor({ state: 'visible', timeout: 20000 })
  const firstScopeItem = harness.factReads.slice(scopeStart).at(-1)
  await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${focal.territoire}&niveau=commune&epci=${secondEpci.territoire}&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="scalar-comparison-summary"]').waitFor({ state: 'visible', timeout: 20000 })
  const changedScopeItem = harness.factReads.slice(scopeStart).at(-1)
  assert.notDeepEqual(firstScopeItem?.target, changedScopeItem?.target, 'Changing EPCI scope must change the native target')

  // The URL focal outside the filtered cohort remains selected and gets one bounded fact read.
  const outsideFocal = territoiresFixture.find((territory) => territory.type === 'commune' && territory.epci !== focal.epci)
  assert(outsideFocal)
  const outsideStart = harness.factReads.length
  await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${outsideFocal.territoire}&niveau=commune&epci=${focal.epci}&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="scalar-comparison-summary"], [data-testid="scalar-comparison-unavailable"]').first()
    .waitFor({ state: 'visible', timeout: 20000 })
  const outsideReads = harness.factReads.slice(outsideStart)
  assert(outsideReads.some((item) => item.target.kind === 'territory_cohort' && item.target.epci_id === focal.epci))
  assert(outsideReads.some((item) => item.target.kind === 'territory' && item.target.id === outsideFocal.territoire),
    'Out-of-cohort focal should be one bounded native territory read')

  // HTTP comparison retry leaves acquired cohort facts warm.
  harness.failComparison()
  const retryFactsBefore = harness.factReads.length
  await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${focal.territoire}&niveau=commune&epci=${focal.epci}&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.getByTestId('scalar-comparison-error').waitFor({ state: 'visible', timeout: 20000 })
  const readsBeforeRetry = harness.factReads.length
  await page.getByTestId('scalar-comparison-retry').click()
  await page.locator('[data-testid="scalar-comparison-summary"]').waitFor({ state: 'visible', timeout: 20000 })
  assert.equal(harness.factReads.length, readsBeforeRetry)
  assert(harness.factReads.length > retryFactsBefore)

  // A late native response from a previous indicator cannot overwrite the new route.
  harness.delayFacts('densite')
  await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${focal.territoire}&niveau=commune&epci=${focal.epci}&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await harness.waitForDelayed()
  await page.evaluate(() => {
    history.pushState({}, '', '/indicateurs/economie/chomage?territoire=22001&niveau=commune&vue=reperes')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.locator('h1').filter({ hasText: census.find(({ indicator }) => indicator === 'chomage').page.label })
    .waitFor({ state: 'visible', timeout: 20000 })
  harness.releaseDelayed()
  await page.waitForTimeout(100)
  assert((await page.locator('h1').innerText()).includes(census.find(({ indicator }) => indicator === 'chomage').page.label))

  // Small-screen surface keeps the table in its own scroll box; the page itself does not overflow.
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${focal.territoire}&niveau=commune&epci=${focal.epci}&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 20000 })
  const mobile = await page.evaluate(() => {
    const root = document.querySelector('.indicateur-page')
    const table = document.querySelector('.comparison-table-scroll')
    return { viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
      rootClient: root?.clientWidth, rootScroll: root?.scrollWidth, tableOverflowX: table && getComputedStyle(table).overflowX }
  })
  assert(mobile.document <= mobile.viewport && mobile.rootClient === mobile.rootScroll && mobile.tableOverflowX === 'auto',
    `360px ordinary scalar page must not overflow: ${JSON.stringify(mobile)}`)

  const numericStatic = requests.filter((path) => /^\/data\/indicateurs_/u.test(path))
  const retired = requests.filter((path) => path.includes('/indicator-cohorts/') || path.startsWith('/api/territories/'))
  assert.deepEqual(numericStatic, [], 'No static numeric indicator rows may be fetched')
  assert.deepEqual(retired, [], 'No retired scalar cohort API endpoint may be called')
  assert.deepEqual(harness.unexpectedApi, [], 'Every API request is intercepted by a native fixture')
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('; ')}`)
  assert.deepEqual(externalFailures, [], `Unexpected external requests: ${externalFailures.join('; ')}`)
  const headAtEnd = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  assert.equal(headAtEnd, headAtStart, 'HEAD must remain unchanged during browser verification')
  console.log(JSON.stringify({ issue: '#855', headAtStart, headAtEnd, modeVariables: 'all VITE_* variables unset',
    pageCount: census.length, pages: routeEvidence, checks: ['all 15 producer/API/page-grammar identities',
      'API value, unit, comparison ranks, provenance, and indicator-page map', 'EPCI published same-level comparison',
      'commune EPCI-filter scope change', 'focal outside cohort bounded read', 'HTTP 503 comparison-only retry',
      'late response rejection', '360px no page overflow'], counts: { apiRequests: harness.requests.length,
      scalarCohortReads: harness.factReads.filter((item) => item.target.kind === 'territory_cohort').length,
      focalReads: harness.factReads.filter((item) => item.target.kind === 'territory').length,
      comparisons: harness.comparisonReads.length, staticNumericReads: numericStatic.length, retiredCalls: retired.length,
      unexpectedApiRequests: harness.unexpectedApi.length, pageErrors: pageErrors.length }, mobile }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
