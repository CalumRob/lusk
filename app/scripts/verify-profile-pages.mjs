import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Bounded browser evidence for #853. All semantic API calls are intercepted;
// only retained theme presentation metadata, the compact territory reference,
// and published map geometry remain static inputs.
// Run from app/: npm run verify:profile-pages
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_')) delete process.env[name]
}
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
const expectedCensus = [
  ['demographie', 'structure_age', 'pyramid'],
  ['habitat', 'mix_logements', 'composition'], ['habitat', 'statut', 'composition'],
  ['habitat', 'age_du_bati', 'composition'], ['habitat', 'type', 'composition'],
  ['habitat', 'distribution_dpe', 'distribution'],
  ['mobilite', 'voitures_menage', 'composition'], ['mobilite', 'offre_cyclable', 'composition'],
  ['mobilite', 'reseaux', 'list'], ['mobilite', 'reseaux_par_habitant', 'list'],
]
const fixtureSources = (id) => [{ source_id: id, name: `API source ${id}`, vintage_id: `${id}-api-v1`,
  version: 'API-2026', reference_date: '2026-05-04', publication_date: '2026-05-05' }]

function getSpecs(metadataByTheme) {
  const specs = []
  for (const theme of ['demographie', 'habitat', 'mobilite']) {
    const metadata = metadataByTheme[theme]
    const contracts = metadata.profile_contracts ?? {}
    for (const [indicator, page] of Object.entries(metadata.indicator_pages ?? {})) {
      if (!Object.hasOwn(contracts, indicator) &&
          !(page.family === 'pyramid' && page.pyramid.dimensions.includes('detail'))) continue
      const contract = contracts[indicator] ?? {}
      const details = page.comparison?.details ??
        (page.family === 'distribution' ? page.distribution.signature : Object.keys(metadata.detail_labels[indicator] ?? {}))
      const sexes = page.comparison?.sexes ?? []
      const detailUnits = contract.detail_units ?? {}
      const units = Object.fromEntries(details.map((detail) => [detail,
        detailUnits[detail] ?? page.comparison?.unit ?? page.unit]))
      const scalar = page.comparison?.indicator && page.comparison.indicator !== indicator
        ? page.comparison.indicator : undefined
      specs.push({ theme, indicator, metadata, page, contract, details, sexes, units, scalar })
    }
  }
  return specs
}

function descriptorFor(spec) {
  const axes = [
    ...spec.details.map((key, order) => ({ name: 'detail', key, label: `API axis ${key}`, order, unit: spec.units[key] })),
    ...spec.sexes.map((key, order) => ({ name: 'sex', key, label: key, order, unit: null })),
  ]
  const detail = spec.page.comparison?.detail ?? spec.details[0]
  const point = spec.scalar ? null : { detail, sex: spec.page.comparison?.sex ?? null,
    direction: spec.page.comparison?.direction ?? spec.page.direction, unit: spec.units[detail] }
  return {
    indicator: spec.indicator, label: `API label ${spec.indicator}`, unit: spec.page.unit,
    allowed_levels: spec.contract.allowed_levels ?? spec.page.levels,
    completeness: spec.contract.completeness ?? 'dense_complete',
    descriptor_version: `profile-descriptor-${spec.indicator}-v1`,
    denominator_semantics: spec.contract.denominator_semantics ?? `API denominator ${spec.indicator}`,
    comparison_scalar: spec.scalar ?? null,
    required_scalar_version: spec.scalar ? 'scalar-content-v1' : null,
    comparison_point: point, axes,
  }
}

function makeDeclarations(specs) {
  const profiles = specs.map((spec) => ({
    resource_id: spec.indicator, theme_id: spec.theme, indicator_id: spec.indicator,
    label: `API label ${spec.indicator}`, unit: spec.page.unit,
    direction: spec.page.comparison?.direction ?? spec.page.direction,
    allowed_levels: spec.page.levels, sources: spec.page.sources,
    shapes: ['declared_profile'], target_kinds: ['territory', 'territory_cohort'],
    axes: [...new Set(['detail', ...(spec.sexes.length ? ['sex'] : [])])],
    axis_values: [['detail', spec.details], ...(spec.sexes.length ? [['sex', spec.sexes]] : [])],
    dynamic_axes: [], fields: ['value'], intents: ['facts', 'fixed_comparison', 'selected_comparison'],
  }))
  const scalars = specs.filter((spec) => spec.scalar).map((spec) => ({
    resource_id: spec.scalar, theme_id: spec.theme, indicator_id: spec.scalar,
    label: `API label ${spec.scalar}`, unit: spec.page.comparison.unit,
    direction: spec.page.comparison.direction, allowed_levels: spec.page.levels,
    sources: spec.page.sources, shapes: ['scalar'], target_kinds: ['territory', 'territory_cohort'],
    axes: [], axis_values: [], dynamic_axes: [], fields: ['value', 'support_count', 'denominator_count'],
    intents: ['facts', 'fixed_comparison', 'selected_comparison'],
  }))
  return [...profiles, ...scalars]
}

function createApiHarness(specs, territories) {
  const declarations = makeDeclarations(specs)
  const profileFacts = []
  const scalarFacts = []
  const comparisons = []
  const apiRequests = []
  const unexpectedApi = []
  let failComparisonFor = null
  let suppressDpeSignature = false
  let delayedProfileFor = null
  let delayedStartedResolve
  let releaseDelayedResolve
  let delayedStarted = new Promise((resolve) => { delayedStartedResolve = resolve })
  let delayedRelease = new Promise((resolve) => { releaseDelayedResolve = resolve })

  const membersFor = (type, department, epci) => territories
    .filter((territory) => territory.type === type && (!department || territory.departement === department) &&
      (!epci || territory.epci === epci))
    .map((territory) => ({ id: territory.territoire, type, name: territory.nom }))

  function factData(item) {
    const target = item.target
    const members = membersFor(target.type, target.department_id, target.epci_id)
    const spec = specs.find((candidate) => candidate.indicator === item.resource)
    if (spec) {
      profileFacts.push(item)
      const descriptor = descriptorFor(spec)
      const profiles = members.map((territory, memberIndex) => ({ territory: { id: territory.id, type: territory.type, name: territory.name },
        cells: spec.details.flatMap((detail, detailIndex) => (spec.sexes.length ? spec.sexes : [null]).map((sex, sexIndex) => ({
          detail, sex, unit: spec.units[detail], denominator_semantics: descriptor.denominator_semantics,
          status: suppressDpeSignature && spec.indicator === 'distribution_dpe' && memberIndex === 0
            ? detail === 'F' ? 'not_available' : detail === 'G' ? 'suppressed' : 'measured'
            : 'measured',
          value: suppressDpeSignature && spec.indicator === 'distribution_dpe' && memberIndex === 0 && ['F', 'G'].includes(detail)
            ? null : 0.317 + memberIndex * 0.071 + detailIndex * 0.019 + sexIndex * 0.007,
          sources: fixtureSources(spec.page.sources[0]),
        }))) }))
      if (spec.indicator === 'distribution_dpe') suppressDpeSignature = false
      return { resource: item.resource, shape: 'declared_profile', target,
        content_version: `profile-content-${item.resource}-v1`, reference_content_version: 'reference-api-v1',
        descriptor, cohort: { territory_type: target.type, department_id: target.department_id,
          epci_id: target.epci_id, member_count: members.length, members, reference_content_version: 'reference-api-v1' }, profiles }
    }

    const specWithScalar = specs.find((candidate) => candidate.scalar === item.resource)
    if (!specWithScalar) throw new Error(`Unexpected facts resource ${item.resource}`)
    scalarFacts.push(item)
    return { resource: item.resource, shape: 'scalar', target,
      content_version: 'scalar-content-v1', reference_content_version: 'reference-api-v1',
      descriptor: { indicator_id: item.resource, theme_id: specWithScalar.theme,
        label: `API label ${item.resource}`, unit: specWithScalar.page.comparison.unit,
        direction: specWithScalar.page.comparison.direction, comparison_facet: item.resource,
        allowed_levels: specWithScalar.page.levels, completeness: 'dense_complete',
        denominator_semantics: 'API scalar denominator', descriptor_version: `scalar-descriptor-${item.resource}-v1` },
      cohort: { territory_type: target.type, department_id: target.department_id, epci_id: target.epci_id,
        member_count: members.length, members, reference_content_version: 'reference-api-v1' },
      observations: members.map((territory, index) => ({ territory: { id: territory.id, type: territory.type, name: territory.name },
        value: 0.623 + index * 0.023, status: 'measured', support_count: 100 + index, denominator_count: 200 + index,
        sources: fixtureSources(specWithScalar.page.sources[0]) })) }
  }

  function comparisonData(item) {
    const spec = specs.find((candidate) => candidate.indicator === item.resource)
    if (!spec) throw new Error(`Unexpected comparison resource ${item.resource}`)
    const selectedMembers = item.intent.members
    const coordinates = item.coordinates
    const detail = coordinates?.detail?.[0] ?? spec.page.comparison?.detail ?? spec.details[0]
    const sex = coordinates?.sex?.[0] ?? spec.page.comparison?.sex ?? null
    const unit = spec.scalar ? spec.page.comparison.unit : spec.units[detail]
    const result = { indicator_id: spec.indicator, status: 'available', reason: null,
      source_facet: spec.scalar ?? { detail, sex }, unit,
      direction: spec.scalar ? spec.page.comparison.direction : spec.page.comparison?.direction ?? spec.page.direction,
      statistic: 'median', profile_descriptor_version: `profile-descriptor-${spec.indicator}-v1`,
      denominator_semantics: descriptorFor(spec).denominator_semantics,
      focal_in_selection: selectedMembers.some((member) => member.id === item.target.id),
      selected_member_count: selectedMembers.length, eligible_count: selectedMembers.length, missing_count: 0,
      median: 0.777, rank: 1, rank_size: selectedMembers.length, rank_ties: 1,
      comparison_sources: fixtureSources(spec.page.sources[0]) }
    if (spec.scalar) Object.assign(result, {
      source_facet_indicator_id: spec.scalar, source_facet_label: `API label ${spec.scalar}`,
      scalar_descriptor_version: `scalar-descriptor-${spec.scalar}-v1`, required_scalar_version: 'scalar-content-v1',
    })
    return { resource: item.resource, target: item.target, contract: 'indicator-comparison-v1',
      indicator_id: item.resource, shape: 'profile', content_version: `comparison-content-${item.resource}-v1`,
      profile_content_version: `profile-content-${item.resource}-v1`, reference_content_version: 'reference-api-v1',
      scalar_content_version: spec.scalar ? 'scalar-content-v1' : null,
      selection: selectedMembers.map((member) => ({ territory_type: member.type, territory_id: member.id })),
      scope: { kind: 'explicit_selection', territory_type: item.target.type, member_count: selectedMembers.length }, result }
  }

  return {
    profileFacts, scalarFacts, comparisons, apiRequests, unexpectedApi,
    failNextComparison(resource) { failComparisonFor = resource },
    suppressNextDpeSignature() { suppressDpeSignature = true },
    delayNextProfile(resource) {
      delayedProfileFor = resource
      delayedStarted = new Promise((resolve) => { delayedStartedResolve = resolve })
      delayedRelease = new Promise((resolve) => { releaseDelayedResolve = resolve })
    },
    waitForDelayedProfile() { return delayedStarted },
    releaseDelayedProfile() { releaseDelayedResolve?.() },
    async handleApi(route) {
      const request = route.request()
      const path = new URL(request.url()).pathname
      apiRequests.push({ path, method: request.method() })
      if (path === '/api/resources' && request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: declarations }) })
        return
      }
      if (path === '/api/resources/read-batch' && request.method() === 'POST') {
        const body = request.postDataJSON()
        const results = []
        for (const item of body.items) {
          if (item.intent.kind === 'facts') {
            if (item.resource === delayedProfileFor && item.resource !== null) {
              delayedProfileFor = null
              delayedStartedResolve?.()
              await delayedRelease
            }
            results.push({ id: item.id, resource: item.resource, data: factData(item) })
          } else {
            comparisons.push(item)
            if (item.resource === failComparisonFor) {
              failComparisonFor = null
              await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"fixture comparison outage"}' })
              return
            }
            results.push({ id: item.id, resource: item.resource, data: comparisonData(item) })
          }
        }
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ contract: 'semantic-read-batch-v1', results }) })
        return
      }
      unexpectedApi.push({ path, method: request.method() })
      await route.fulfill({ status: 599, contentType: 'text/plain', body: 'Unanticipated API request in profile browser proof' })
    },
  }
}

const server = await createServer({
  configFile: resolve(appRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
let browser
const pageErrors = []
const externalFailures = []

try {
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  const { territoiresFixture } = await server.ssrLoadModule('/src/payload/fixtures.ts')
  const metadataByTheme = Object.fromEntries(await Promise.all(['demographie', 'habitat', 'mobilite'].map(async (theme) => {
    const text = await readFile(resolve(repoRoot, 'public/data', `theme_${theme}.json`), 'utf8')
    return [theme, JSON.parse(text)]
  })))
  const specs = getSpecs(metadataByTheme)
  const census = specs.map(({ theme, indicator, page }) => [theme, indicator, page.family])
  assert.deepEqual(census, expectedCensus, 'The producer-derived profile census must remain complete and exact')
  const harness = createApiHarness(specs, territoiresFixture)
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const requests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  page.on('requestfailed', (request) => {
    if (!new URL(request.url()).hostname.startsWith('127.0.0.1')) externalFailures.push(request.url())
  })
  await page.route('**/api/**', (route) => harness.handleApi(route))
  await page.route('**/data/territoires.json', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(territoiresFixture) }))

  for (const spec of specs) {
    const startFacts = harness.profileFacts.length
    const startComparisons = harness.comparisons.length
    await page.goto(`${baseUrl}indicateurs/${spec.theme}/${spec.indicator}?territoire=22001&niveau=commune&vue=reperes`,
      { waitUntil: 'domcontentloaded' })
    await page.locator('h1').filter({ hasText: `API label ${spec.indicator}` }).waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`[data-renderer="${spec.page.family}"]`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator('[data-testid="profile-comparison-summary"]').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(harness.profileFacts.slice(startFacts).filter((item) => item.resource === spec.indicator).length, 1,
      `${spec.indicator} must acquire exactly one semantic profile cohort`)
    assert.equal(harness.comparisons.slice(startComparisons).filter((item) => item.resource === spec.indicator).length, 1,
      `${spec.indicator} must acquire one selected semantic comparison`)
    assert((await page.locator('body').innerText()).includes('API source'), `${spec.indicator} must display API provenance`)
    assert((await page.locator('body').innerText()).includes('API axis'), `${spec.indicator} must use native API axes`)
    await page.getByRole('button', { name: 'L’indicateur' }).click()
    await page.getByText('API-2026', { exact: false }).first().waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('[role="status"]:not([hidden])')?.textContent?.includes('Chargement de'))
  }

  // The selected category/sex controls must drive the actual semantic compare request,
  // while the table/figure remain populated from the already acquired API facts.
  const age = specs.find((spec) => spec.indicator === 'structure_age')
  await page.goto(`${baseUrl}indicateurs/demographie/structure_age?territoire=22001&niveau=commune&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-renderer="pyramid"]').first().waitFor({ state: 'visible' })
  const ageFactsBeforeFacet = harness.profileFacts.filter((item) => item.resource === age.indicator).length
  await page.getByLabel('Catégorie comparée').selectOption('15-24')
  await page.getByLabel('Sexe comparé').selectOption('M')
  await page.waitForFunction(() => document.querySelector('[data-testid="profile-comparison-summary"]')?.textContent?.includes('API source'))
  assert.deepEqual(harness.comparisons.at(-1).coordinates, { detail: ['15-24'], sex: ['M'] })
  assert.equal(harness.profileFacts.filter((item) => item.resource === age.indicator).length, ageFactsBeforeFacet,
    'A facet change must reread only its comparison, not the profile cohort')
  const ageTable = await page.locator('table').innerText()
  assert(ageTable.includes('34'), `The table must contain the selected API-backed age × sex sentinel: ${ageTable}`)
  assert((await page.locator('table tbody').innerText()).length > 0, 'The table must retain API-backed facts')

  // Map view uses the selected profile detail and the app's real map payload path.
  await page.getByRole('button', { name: 'Carte', exact: true }).click()
  await page.locator('.map-explorer-canevas').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.popup-carte-kpi').first().waitFor({ state: 'visible', timeout: 20000 })
  const mapPopup = await page.locator('.popup-carte').innerText()
  assert(mapPopup.includes('API axis 15-24'), `The map popup must use the selected API facet: ${mapPopup}`)
  assert(mapPopup.includes('%'), `The map popup must display the API unit: ${mapPopup}`)

  // A linked DPE scalar remains a distinct map/comparison resource, never the bins.
  const dpe = specs.find((spec) => spec.indicator === 'distribution_dpe')
  await page.goto(`${baseUrl}indicateurs/habitat/distribution_dpe?territoire=22001&niveau=commune&vue=carte`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('.map-explorer-canevas').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.popup-carte-kpi').first().waitFor({ state: 'visible', timeout: 20000 })
  assert(harness.scalarFacts.some((item) => item.resource === 'part_passoires'), 'The DPE page must acquire its linked scalar companion')
  const dpePopup = await page.locator('.popup-carte').innerText()
  assert(dpePopup.includes('%') && dpePopup.includes('API label part_passoires'),
    `The DPE map must show its distinct API scalar companion: ${dpePopup}`)

  harness.suppressNextDpeSignature()
  await page.goto(`${baseUrl}indicateurs/habitat/distribution_dpe?territoire=22001&niveau=commune&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="signature-distribution"] [role="status"]').waitFor({ state: 'visible', timeout: 15000 })
  assert((await page.locator('[data-testid="signature-distribution"] [role="status"]').innerText())
    .includes('distribution incomplète ou supprimée'), 'Missing/suppressed DPE cells must not become a complete signature')

  // Comparison failure/retry is an actual HTTP failure; the validated cohort stays warm.
  const mix = specs.find((spec) => spec.indicator === 'mix_logements')
  harness.failNextComparison('mix_logements')
  await page.goto(`${baseUrl}indicateurs/habitat/mix_logements?territoire=22001&niveau=commune&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="profile-comparison-error"]').waitFor({ state: 'visible', timeout: 15000 })
  const mixFactsBeforeRetry = harness.profileFacts.filter((item) => item.resource === mix.indicator).length
  await page.getByTestId('profile-comparison-retry').click()
  await page.locator('[data-testid="profile-comparison-summary"]').waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(harness.profileFacts.filter((item) => item.resource === mix.indicator).length, mixFactsBeforeRetry,
    'Comparison retry must preserve the already acquired profile facts')

  // Route staleness: hold a real late profile HTTP response while the same SPA
  // navigates to another profile, then release it and verify the new page wins.
  harness.delayNextProfile('structure_age')
  await page.goto(`${baseUrl}indicateurs/demographie/structure_age?territoire=22001&niveau=commune&vue=indicateur`,
    { waitUntil: 'domcontentloaded' })
  await harness.waitForDelayedProfile()
  await page.evaluate(() => {
    history.pushState({}, '', '/indicateurs/habitat/mix_logements?territoire=22001&niveau=commune&vue=indicateur')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.locator('h1').filter({ hasText: 'API label mix_logements' }).waitFor({ state: 'visible', timeout: 15000 })
  harness.releaseDelayedProfile()
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('API label mix_logements'))
  assert(!(await page.locator('h1').innerText()).includes('structure_age'), 'A stale profile response must not replace the routed page')

  // Supported non-commune level and regional facts-only boundary.
  await page.goto(`${baseUrl}indicateurs/habitat/mix_logements?territoire=200000001&niveau=epci&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="profile-comparison-summary"]').waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(harness.profileFacts.at(-1).target.type, 'epci')
  const regionalComparisonsBefore = harness.comparisons.filter((item) => item.resource === 'offre_cyclable').length
  await page.goto(`${baseUrl}indicateurs/mobilite/offre_cyclable?territoire=53&vue=carte`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="profile-regional-map-unavailable"]').waitFor({ state: 'visible', timeout: 15000 })
  assert((await page.locator('[data-testid="note-contexte"]').innerText()).includes('sans comparaison entre territoires'))
  assert.equal(harness.profileFacts.at(-1).target.type, 'region')
  assert.equal(harness.comparisons.filter((item) => item.resource === 'offre_cyclable').length, regionalComparisonsBefore,
    'Regional profile facts must not trigger peer comparisons')

  // Mobile viewport smoke: no page-level horizontal overflow on a retained composition page.
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`${baseUrl}indicateurs/habitat/mix_logements?territoire=22001&niveau=commune&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  await page.locator('[data-renderer="composition"]').first().waitFor({ state: 'visible' })
  const mobile = await page.evaluate(() => {
    const profile = document.querySelector('.indicateur-page')
    const table = profile.querySelector('.comparison-table-scroll')
    return { viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      profileClient: profile.clientWidth, profileScroll: profile.scrollWidth,
      tableClient: table.clientWidth, tableScroll: table.scrollWidth,
      tableOverflowX: getComputedStyle(table).overflowX }
  })
  assert(mobile.document <= mobile.viewport && mobile.profileScroll <= mobile.profileClient &&
    mobile.tableOverflowX === 'auto',
    `The 360px profile page must not overflow horizontally: ${JSON.stringify(mobile)}`)

  const numericStatic = requests.filter((path) => /^\/data\/indicateurs_/u.test(path))
  const retired = requests.filter((path) => path.includes('/profiles/') || path.startsWith('/api/territories/'))
  assert.deepEqual(numericStatic, [], 'No static indicator numeric payload may be requested')
  assert.deepEqual(retired, [], 'No retired profile route may be called')
  assert.deepEqual(harness.unexpectedApi, [], 'Every API request must be intercepted by this fixture')
  assert.deepEqual(pageErrors, [], `The browser must finish without uncaught page errors: ${pageErrors.join('; ')}`)

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const report = {
    issue: '#853', head, command: 'cd app && npm run verify:profile-pages',
    modeVariables: 'all VITE_* variables unset before Vite server start',
    profileRoutes: census.length, profileCensus: census,
    checks: ['API-derived headings/axes/provenance and all four page families',
      'single semantic profile cohort per route; no static numeric payload or retired endpoint',
      'selected detail × sex coordinates update comparison without rereading facts',
      'selected API facet and unit in the map popup', 'DPE scalar companion remains separate',
      'missing and suppressed DPE cells remain an incomplete signature',
      'actual comparison HTTP 503 retry preserves warm profile facts', 'late route response cannot replace new profile',
      'EPCI cohort and regional facts-only behavior', '360px mobile horizontal-overflow smoke'],
    counts: { interceptedApiRequests: harness.apiRequests.length, profileFactReads: harness.profileFacts.length,
      linkedScalarFactReads: harness.scalarFacts.length, selectedComparisonReads: harness.comparisons.length,
      staticNumericReads: numericStatic.length, retiredProfileCalls: retired.length,
      unexpectedApiRequests: harness.unexpectedApi.length, browserPageErrors: pageErrors.length,
      externalAssetFailures: externalFailures.length },
    renderedEvidence: { profileMapPopup: mapPopup, dpeScalarMapPopup: dpePopup },
    mobile,
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
