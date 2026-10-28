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
const branchAtStart = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const headAtStart = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const statusAtStart = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
assert.equal(statusAtStart, '', 'Browser acceptance requires a clean committed source tree')
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
  let forcedStatus = null
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
    forceStatus(resource, status) { forcedStatus = { resource, status } },
    clearForcedStatus() { forcedStatus = null },
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
          const context = { territories,
            ...(forcedStatus?.resource === item.resource ? { facts: territories.map((territory) => ({
              territoire: territory.territoire, type: territory.type, key: item.resource,
              value: null, fact_status: forcedStatus.status,
            })) } : {}),
          }
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
  const { formaterValeur, formaterRang } = await server.ssrLoadModule('/src/payload/selectors.ts')
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
  staleMetadata.source_records.serie_historique.sha256 = 'editorial-stale-source-hash'
  staleMetadata.source_records.serie_historique.clocks = [{ name: 'Horloge éditoriale obsolète',
    reference: 'mercredi réel de période scolaire 1999-01-01', frequency: 'factice' }]
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
  async function renderedRanks() {
    return page.locator('tbody tr').evaluateAll((rows) => rows.map((row) => {
      const href = row.querySelector('td a')?.getAttribute('href') ?? ''
      const territoryId = decodeURIComponent(href.split('?')[0].split('/').at(-1) ?? '')
      const cells = row.querySelectorAll('td')
      return { territoryId, name: cells[0]?.innerText.trim() ?? '', rankText: cells[2]?.innerText.trim() ?? '' }
    }))
  }
  async function assertRankTable(result, indicator) {
    const expectedById = new Map(result.member_ranks.map((rank) => [rank.territory_id, rank]))
    const initial = await renderedRanks()
    const matched = initial.map((row) => {
      const expected = expectedById.get(row.territoryId)
      assert(expected, `${indicator} rendered a row without native member rank evidence: ${JSON.stringify(row)}`)
      assert.equal(row.rankText, formaterRang(expected.rank, expected.rank_size),
        `${indicator}/${row.territoryId} table rank must equal the native API peer rank`)
      return { ...row, rank: expected.rank, rank_size: expected.rank_size, rank_ties: expected.rank_ties }
    })
    const visibleRankCount = matched.filter((row) => row.rank !== null).length
    const nativeRankCount = result.member_ranks.filter((rank) => rank.rank !== null).length
    assert.equal(visibleRankCount, nativeRankCount,
      `${indicator} rendered rank count must equal actual native ranked peer evidence, not table row count`)
    assert.equal(nativeRankCount, result.eligible_count,
      `${indicator} native measured members must reconcile with eligible_count`)
    for (const rank of result.member_ranks) {
      if (rank.rank === null) {
        assert.equal(rank.rank_size, null)
        assert.equal(rank.rank_ties, null)
      } else {
        assert(Number.isInteger(rank.rank) && Number.isInteger(rank.rank_size) && Number.isInteger(rank.rank_ties))
        assert.equal(rank.rank_size, result.eligible_count)
        assert(rank.rank_ties >= 1 && rank.rank_ties <= rank.rank_size)
        assert(rank.rank + rank.rank_ties <= rank.rank_size + 1)
      }
    }
    await page.locator('.comparison-table-scroll thead').getByRole('button', { name: 'Rang', exact: true }).click()
    const sorted = await renderedRanks()
    const expectedRanks = [...matched].map((row) => row.rank).sort((left, right) =>
      (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER))
    const actualRanks = sorted.map((row) => expectedById.get(row.territoryId)?.rank ?? null)
    assert.deepEqual(actualRanks, expectedRanks,
      `${indicator} table rank sort must use native rank order (unranked last; tie order is unspecified)`)
    return { rows: matched, renderedRankCount: visibleRankCount,
      nativeRankCount, sortedTerritoryIds: sorted.map((row) => row.territoryId), sortedRanks: actualRanks }
  }
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
    const nativeComparison = fixtures.nativeReadFixture(comparisonItem, spec.resource, { territories: territoiresFixture })
    const comparisonResult = nativeComparison.result
    assert.equal(comparisonResult.selected_member_count, comparisonResult.member_ranks.length,
      `${spec.indicator} API comparison must return exactly one rank/status row per selected member`)
    const expectedEligible = (nativeFact.observations ?? []).filter((row) =>
      row.status === 'measured' && Number.isFinite(row.value)).length
    assert.equal(comparisonResult.eligible_count, expectedEligible,
      `${spec.indicator} API comparison eligible count must agree with the acquired native facts`)
    assert.equal(comparisonResult.member_ranks.filter((row) => row.rank !== null).length, expectedEligible,
      `${spec.indicator} API peer ranks must represent measured members, including singleton populations`)
    const focalObservation = nativeFact.observations?.find((row) => row.territory.id === pageFocal.territoire)
    assert(focalObservation?.status === 'measured', `${spec.indicator} browser fixture needs a measured focal sentinel`)
    const expectedApiValue = formaterValeur({ value: Number(focalObservation.value) * 10 + 1234.5,
      unit: spec.resource.unit })
    assert(bodyText.includes(expectedApiValue),
      `${spec.indicator} must render changed API value ${expectedApiValue}: ${bodyText.slice(0, 1800)}`)
    assert(!(await page.locator('body').innerText()).includes('unité éditoriale obsolète'),
      'A stale scalar presentation unit must not replace the native descriptor unit')
    const median = comparisonResult.median === null ? null : comparisonResult.median * 10 + 1234.5
    if (comparisonResult.status === 'available') {
      assert(median !== null)
      const expectedMedian = formaterValeur({ value: median, unit: spec.resource.unit })
      const summary = await page.getByTestId('scalar-comparison-summary').innerText()
      assert(summary.includes(expectedMedian) && summary.includes(String(comparisonResult.eligible_count)),
        `${spec.indicator} summary must render the native API median and eligible count: ${summary}`)
    } else {
      assert.equal(comparisonResult.status, 'unavailable')
      assert.equal(median, null)
      assert(await page.getByTestId('scalar-comparison-unavailable').isVisible())
    }
    const rankEvidence = await assertRankTable(comparisonResult, spec.indicator)
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
    if (spec.indicator === 'densite') {
      assert(!sourceText.includes('Horloge éditoriale obsolète') && !sourceText.includes('1999-01-01'),
        'Stale static source clocks must not enter native scalar source cards')
      assert(observedSource?.reference_date && sourceText.includes(observedSource.reference_date),
        'Native source reference date must be rendered from acquired scalar provenance')
      assert(observedSource?.publication_date && sourceText.includes(observedSource.publication_date),
        'Native source publication date must be rendered from acquired scalar provenance')
    }
    await page.getByRole('button', { name: 'Repères', exact: true }).click()
    await page.waitForFunction(() => Boolean(document.querySelector('tbody tr')))
    routeEvidence.push({ theme: spec.theme, indicator: spec.indicator, unit: spec.resource.unit,
      nativeTarget: factItem.target, comparisonKind: comparisonItem.intent.kind, focal: pageFocal.territoire,
      tableRows: rowCount, eligibleCount: comparisonResult.eligible_count, median: comparisonResult.median,
      renderedRankCount: rankEvidence.renderedRankCount, nativeRanks: comparisonResult.member_ranks,
      sortedTerritories: rankEvidence.sortedTerritoryIds, mapFact: mapText.slice(0, 500),
      provenance: observedSource?.name ?? null, referenceDate: observedSource?.reference_date ?? null,
      publicationDate: observedSource?.publication_date ?? null })
  }

  // Published non-commune comparisons keep their own page/table population and rank evidence.
  const density = census.find(({ indicator }) => indicator === 'densite')
  assert(density)
  async function verifyFixedLevel(level) {
    const territory = territoiresFixture.find((item) => item.type === level)
    assert(territory, `Browser fixture must contain a ${level} territory`)
    const factsStart = harness.factReads.length
    const comparisonStart = harness.comparisonReads.length
    await page.goto(`${baseUrl}indicateurs/demographie/densite?territoire=${territory.territoire}&niveau=${level}&vue=reperes`,
      { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="scalar-comparison-summary"], [data-testid="scalar-comparison-unavailable"]')
      .first().waitFor({ state: 'visible', timeout: 20000 })
    const factItem = harness.factReads.slice(factsStart).find((item) => item.resource === 'densite' &&
      item.target.kind === 'territory_cohort')
    const comparisonItem = harness.comparisonReads.slice(comparisonStart).find((item) => item.resource === 'densite')
    assert.equal(factItem?.target.type, level, `${level} page must acquire native facts at its selected level`)
    assert.equal(comparisonItem?.intent.kind, 'fixed_comparison')
    assert.equal(comparisonItem?.target.type, level, `${level} page comparison must retain its native typed target`)
    const comparison = fixtures.nativeReadFixture(comparisonItem, density.resource, { territories: territoiresFixture })
    assert.equal(comparison.scope.kind, 'same_level')
    assert.equal(comparison.scope.territory_type, level)
    assert.equal(comparison.result.status, 'available', `${level} comparison fixture must publish a median`)
    assert(Number.isFinite(comparison.result.median), `${level} comparison must carry a finite native median`)
    const median = comparison.result.median * 10 + 1234.5
    const expectedMedian = formaterValeur({ value: median, unit: density.resource.unit })
    const summary = await page.getByTestId('scalar-comparison-summary').innerText()
    assert(summary.includes(expectedMedian) && summary.includes(density.resource.unit),
      `${level} summary must render the exact formatted native API median and unit: ${summary}`)
    const ranks = await assertRankTable(comparison.result, `densite/${level}`)
    return { level, territory: territory.territoire, scope: comparison.scope, median: comparison.result.median,
      renderedMedian: `${expectedMedian} ${density.resource.unit}`,
      eligibleCount: comparison.result.eligible_count, memberRanks: comparison.result.member_ranks, ...ranks }
  }
  const epciEvidence = await verifyFixedLevel('epci')
  const departementEvidence = await verifyFixedLevel('departement')

  const suppressionPage = census.find(({ indicator }) => indicator === 'part_passoires')
  assert(suppressionPage)
  const suppressionFocal = focusFor(suppressionPage)
  const suppressionFacts = territoiresFixture.map((territory) => ({ territoire: territory.territoire,
    type: territory.type, key: suppressionPage.indicator, value: null, fact_status: 'suppressed' }))
  harness.forceStatus(suppressionPage.indicator, 'suppressed')
  const suppressionFactStart = harness.factReads.length
  const suppressionComparisonStart = harness.comparisonReads.length
  await page.goto(`${baseUrl}indicateurs/${suppressionPage.theme}/${suppressionPage.indicator}?territoire=${suppressionFocal.territoire}&niveau=commune&epci=${suppressionFocal.epci}&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.getByTestId('scalar-comparison-unavailable').waitFor({ state: 'visible', timeout: 20000 })
  const suppressionFactItem = harness.factReads.slice(suppressionFactStart).find((item) =>
    item.resource === suppressionPage.indicator && item.target.kind === 'territory_cohort')
  const suppressionComparisonItem = harness.comparisonReads.slice(suppressionComparisonStart).find((item) =>
    item.resource === suppressionPage.indicator)
  assert(suppressionFactItem && suppressionComparisonItem)
  const suppressionFact = fixtures.nativeReadFixture(suppressionFactItem, suppressionPage.resource,
    { territories: territoiresFixture, facts: suppressionFacts })
  const suppressionComparison = fixtures.nativeReadFixture(suppressionComparisonItem, suppressionPage.resource,
    { territories: territoiresFixture, facts: suppressionFacts })
  assert.equal(suppressionFact.observations.every((row) => row.status === 'suppressed'), true)
  assert.equal(suppressionComparison.result.status, 'unavailable')
  assert.equal(suppressionComparison.result.eligible_count, 0)
  assert.equal(suppressionComparison.result.median, null)
  assert(suppressionComparison.result.member_ranks.every((row) => row.rank === null && row.rank_size === null))
  harness.clearForcedStatus()
  const suppressionEvidence = { indicator: suppressionPage.indicator, factStatus: 'suppressed',
    comparisonStatus: suppressionComparison.result.status, eligibleCount: suppressionComparison.result.eligible_count,
    median: suppressionComparison.result.median, memberRanks: suppressionComparison.result.member_ranks }

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
  const branchAtEnd = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const statusAtEnd = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  assert.equal(headAtEnd, headAtStart, 'HEAD must remain unchanged during browser verification')
  assert.equal(branchAtEnd, branchAtStart, 'Branch must remain unchanged during browser verification')
  assert.equal(statusAtEnd, '', 'Source tree must remain clean throughout browser verification')
  console.log(JSON.stringify({ issue: '#855', branchAtStart, branchAtEnd, headAtStart, headAtEnd,
    sourceCleanBeforeAndAfter: true, modeVariables: 'all VITE_* variables unset',
    pageCount: census.length, pages: routeEvidence, checks: ['all 15 producer/API/page-grammar identities',
      'API value, unit, native median/status/rank/ties/provenance, table rank sort, and indicator-page map',
      'EPCI and department published same-level comparison and table ranks',
      'suppressed native facts and unavailable comparison', 'native source dates supersede stale static clocks',
      'commune EPCI-filter scope change', 'focal outside cohort bounded read', 'HTTP 503 comparison-only retry',
      'late response rejection', '360px no page overflow'], counts: { apiRequests: harness.requests.length,
      scalarCohortReads: harness.factReads.filter((item) => item.target.kind === 'territory_cohort').length,
      focalReads: harness.factReads.filter((item) => item.target.kind === 'territory').length,
      comparisons: harness.comparisonReads.length, staticNumericReads: numericStatic.length, retiredCalls: retired.length,
       unexpectedApiRequests: harness.unexpectedApi.length, pageErrors: pageErrors.length },
    epciEvidence, departementEvidence, suppressionEvidence, mobile }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
