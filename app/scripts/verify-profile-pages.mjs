import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
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
const browserArtifactDir = process.env.LUSK_BROWSER_ARTIFACT_DIR
const headAtStart = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
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
  const factResults = []
  const profileFocalReads = []
  const scalarFacts = []
  const comparisons = []
  const comparisonResults = []
  const fixedComparisons = []
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
    const members = target.kind === 'territory_cohort'
      ? membersFor(target.type, target.department_id, target.epci_id)
      : membersFor(target.type, null, null)
    const spec = specs.find((candidate) => candidate.indicator === item.resource || candidate.scalar === item.resource)
    if (spec && spec.indicator === item.resource) {
      if (target.kind === 'territory_cohort') profileFacts.push(item)
      else profileFocalReads.push(item)
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
      const observations = profiles.find((profile) => profile.territory.id === target.id)?.cells ?? []
      if (target.kind === 'territory') return { resource: item.resource, shape: 'declared_profile', target,
        content_version: `profile-content-${item.resource}-v1`, reference_content_version: 'reference-api-v1',
        descriptor, observations }
      return { resource: item.resource, shape: 'declared_profile', target,
        content_version: `profile-content-${item.resource}-v1`, reference_content_version: 'reference-api-v1',
        descriptor, cohort: { territory_type: target.type, department_id: target.department_id,
          epci_id: target.epci_id, member_count: members.length, members, reference_content_version: 'reference-api-v1' }, profiles }
    }

    const specWithScalar = specs.find((candidate) => candidate.scalar === item.resource)
    if (!specWithScalar) throw new Error(`Unexpected facts resource ${item.resource}`)
    scalarFacts.push(item)
    const scalarDescriptor = { indicator_id: item.resource, theme_id: specWithScalar.theme,
      label: `API label ${item.resource}`, unit: specWithScalar.page.comparison.unit,
      direction: specWithScalar.page.comparison.direction, comparison_facet: item.resource,
      allowed_levels: specWithScalar.page.levels, completeness: 'dense_complete',
      denominator_semantics: 'API scalar denominator', descriptor_version: `scalar-descriptor-${item.resource}-v1` }
    if (target.kind === 'territory') {
      const territory = members.find((candidate) => candidate.id === target.id)
      const index = members.findIndex((candidate) => candidate.id === target.id)
      return { resource: item.resource, shape: 'scalar', target,
        content_version: 'scalar-content-v1', reference_content_version: 'reference-api-v1',
        descriptor: scalarDescriptor, descriptor_version: scalarDescriptor.descriptor_version,
        observation: { territory_id: target.id, territory_type: target.type,
          value: 0.623 + index * 0.023, status: 'measured', support_count: 100 + index, denominator_count: 200 + index,
          sources: fixtureSources(specWithScalar.page.sources[0]) }, territory }
    }
    return { resource: item.resource, shape: 'scalar', target,
      content_version: 'scalar-content-v1', reference_content_version: 'reference-api-v1',
      descriptor: scalarDescriptor,
      cohort: { territory_type: target.type, department_id: target.department_id, epci_id: target.epci_id,
        member_count: members.length, members, reference_content_version: 'reference-api-v1' },
      observations: members.map((territory, index) => ({ territory: { id: territory.id, type: territory.type, name: territory.name },
        value: 0.623 + index * 0.023, status: 'measured', support_count: 100 + index, denominator_count: 200 + index,
        sources: fixtureSources(specWithScalar.page.sources[0]) })) }
  }

  function comparisonData(item) {
    const spec = specs.find((candidate) => candidate.indicator === item.resource || candidate.scalar === item.resource)
    if (!spec) throw new Error(`Unexpected comparison resource ${item.resource}`)
    const linkedScalar = spec.indicator !== item.resource
    const selectedMembers = item.intent.kind === 'selected_comparison'
      ? item.intent.members
      : membersFor(item.target.type, item.target.department_id ?? null, item.target.epci_id ?? null)
        .map(({ id, type }) => ({ id, type }))
    const coordinates = item.intent.kind === 'selected_comparison' ? item.coordinates : undefined
    const detail = coordinates?.detail?.[0] ?? spec.page.comparison?.detail ?? spec.details[0]
    const sex = coordinates?.sex?.[0] ?? spec.page.comparison?.sex ?? null
    const usesScalar = linkedScalar || Boolean(spec.scalar)
    const unit = usesScalar ? spec.page.comparison.unit : spec.units[detail]
    const direction = usesScalar ? spec.page.comparison.direction : spec.page.comparison?.direction ?? spec.page.direction
    const detailIndex = spec.details.indexOf(detail)
    const sexIndex = sex === null ? 0 : spec.sexes.indexOf(sex)
    const rankedMembers = selectedMembers.map((member) => {
      const index = membersFor(member.type, null, null).findIndex((territory) => territory.id === member.id)
      const value = usesScalar ? 0.623 + index * 0.023 : 0.317 + index * 0.071 + detailIndex * 0.019 + sexIndex * 0.007
      return { territory_id: member.id, value }
    })
    const values = rankedMembers.map(({ value }) => value).sort((left, right) => left - right)
    const midpoint = Math.floor(values.length / 2)
    const median = values.length % 2 ? values[midpoint] : (values[midpoint - 1] + values[midpoint]) / 2
    const focalValue = rankedMembers.find(({ territory_id }) => territory_id === item.target.id)?.value
    const focalInSelection = focalValue !== undefined
    const rank = !focalInSelection ? null : 1 + rankedMembers.filter(({ value }) =>
      direction === 'high' ? value > focalValue : value < focalValue).length
    const rankTies = !focalInSelection ? null : rankedMembers.filter(({ value }) => value === focalValue).length
    const enough = values.length >= 2
    const result = { indicator_id: item.resource, status: enough ? 'available' : 'unavailable',
      reason: enough ? null : 'fewer_than_two_comparable_values',
      source_facet: linkedScalar || spec.scalar ? spec.scalar : { detail, sex }, unit,
      direction,
      statistic: 'median', ...(linkedScalar ? { descriptor_version: `scalar-descriptor-${item.resource}-v1` }
        : { profile_descriptor_version: `profile-descriptor-${spec.indicator}-v1` }),
      denominator_semantics: descriptorFor(spec).denominator_semantics,
      focal_in_selection: focalInSelection,
      selected_member_count: selectedMembers.length, eligible_count: selectedMembers.length, missing_count: 0,
      median: enough ? median : null, rank: enough ? rank : null,
      rank_size: enough && rank !== null ? selectedMembers.length : null, rank_ties: enough ? rankTies : null,
      member_ranks: rankedMembers.map(({ territory_id, value }) => ({ territory_id,
        rank: !enough ? null : 1 + rankedMembers.filter(({ value: candidate }) => direction === 'high' ? candidate > value : candidate < value).length,
        rank_size: !enough ? null : selectedMembers.length,
        rank_ties: !enough ? null : rankedMembers.filter(({ value: candidate }) => candidate === value).length })),
      comparison_sources: fixtureSources(spec.page.sources[0]) }
    if (!linkedScalar && spec.scalar) Object.assign(result, {
      source_facet_indicator_id: spec.scalar, source_facet_label: `API label ${spec.scalar}`,
      scalar_descriptor_version: `scalar-descriptor-${spec.scalar}-v1`, required_scalar_version: 'scalar-content-v1',
    })
    return { resource: item.resource, target: item.target, contract: 'indicator-comparison-v1',
       indicator_id: item.resource, shape: linkedScalar ? 'scalar' : 'profile',
       content_version: linkedScalar ? 'scalar-content-v1' : null,
      ...(!linkedScalar ? { profile_content_version: `profile-content-${item.resource}-v1` } : {}),
      reference_content_version: 'reference-api-v1',
       scalar_content_version: !linkedScalar && spec.scalar ? 'scalar-content-v1' : null,
       selection: selectedMembers.map((member) => ({ territory_type: member.type, territory_id: member.id })),
       scope: { kind: 'explicit_selection', member_count: selectedMembers.length }, result }
  }

  return {
    profileFacts, factResults, profileFocalReads, scalarFacts, comparisons, comparisonResults,
    fixedComparisons, apiRequests, unexpectedApi,
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
            const data = factData(item)
            factResults.push(data)
            results.push({ id: item.id, resource: item.resource, data })
          } else {
            if (item.intent.kind === 'selected_comparison') comparisons.push(item)
            else fixedComparisons.push(item)
            if (item.resource === failComparisonFor) {
              failComparisonFor = null
              await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"fixture comparison outage"}' })
              return
            }
            const data = comparisonData(item)
            comparisonResults.push({ item, result: data.result })
            results.push({ id: item.id, resource: item.resource, data })
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

async function verifyStandaloneMap(browser, baseUrl, specs, territories, formatValue) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const harness = createApiHarness(specs, territories)
  const errors = []
  const externalRequests = []
  const workerUrls = []
  const artifactDir = process.env.LUSK_BROWSER_ARTIFACT_DIR
  const focal = territories.find((territory) => territory.type === 'commune')
  assert(focal)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('worker', (worker) => workerUrls.push(worker.url()))
  // All real MapLibre workers/modules and app data stay local. The replacement
  // style retains the actual vector-source -> TileJSON -> attribution path.
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseUrl).origin) {
      externalRequests.push(route.request().url())
      return route.abort()
    }
    await route.continue()
  })
  await page.route('**/positron-nolabels.json', (route) => route.fulfill({ json: {
    version: 8,
    sources: { fixture: { type: 'vector', url: `${baseUrl}__map-proof/tiles.json` } },
    layers: [{ id: 'fixture', type: 'fill', source: 'fixture', 'source-layer': 'fixture',
      paint: { 'fill-color': '#dddddd' } }],
  } }))
  await page.route('**/__map-proof/tiles.json', (route) => route.fulfill({ json: {
    tilejson: '3.0.0', tiles: [`${baseUrl}__map-proof/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14,
    attribution: '<a href="https://www.openstreetmap.org/copyright" onclick="void 0" onmouseover="void 0">© OpenStreetMap</a> | <a href="https://example.org/credits">Tile provider</a>',
    vector_layers: [{ id: 'fixture', fields: {} }],
  } }))
  await page.route('**/__map-proof/**/*.pbf', (route) => route.fulfill({
    contentType: 'application/x-protobuf',
    body: Buffer.from([0x1a, 0x0e, 0x0a, 0x07, 0x66, 0x69, 0x78, 0x74, 0x75, 0x72, 0x65, 0x28, 0x80, 0x20, 0x78, 0x02]),
  }))
  await page.route('**/api/**', (route) => harness.handleApi(route))
  await page.route('**/data/territoires.json', (route) => route.fulfill({ json: territories }))
  // Numerical browser exports are retired. Native map acquisition must not
  // request them, even when API responses fail or the reference is small.
  const retiredNumericalRequests = []
  await page.route('**/data/indicateurs_*.json', async (route) => {
    retiredNumericalRequests.push(route.request().url())
    await route.fulfill({ status: 410, body: 'Retired numerical projection' })
  })
  await page.route('**/data/histoires_*.json', async (route) => {
    retiredNumericalRequests.push(route.request().url())
    await route.fulfill({ status: 410, body: 'Retired numerical projection' })
  })
  try {
    await page.goto(`${baseUrl}carte`, { waitUntil: 'domcontentloaded' })
    const canvas = page.locator('.maplibregl-canvas')
    const sidebar = page.getByRole('complementary', { name: 'Options de la carte' })
    await canvas.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('.maplibregl-canvas')?.getContext('webgl2') !== null,
      null, { timeout: 10000 })
    await page.waitForTimeout(250)
    assert(workerUrls.some((url) => url.includes('maplibre-gl')), `real MapLibre worker starts: ${workerUrls.join(', ')}`)
    const attribution = page.locator('.maplibregl-ctrl-attrib-inner')
    await attribution.locator('a[href="https://www.openstreetmap.org/copyright"]').waitFor({ state: 'attached' })
    assert.equal(await attribution.locator('[onclick], [onmouseover]').count(), 0)
    assert.equal(await attribution.getByRole('link', { name: 'Tile provider' }).count(), 1)
    assert.equal(harness.apiRequests.length, 0, 'neutral map acquires no numerical API facts')

    async function searchFocal() {
      await sidebar.getByRole('combobox').fill(focal.nom)
      await sidebar.getByRole('option').filter({ hasText: focal.nom }).click()
      await page.locator('.popup-carte').waitFor({ state: 'visible' })
      assert((await page.locator('.popup-carte-titre').innerText()).includes(focal.nom))
    }
    await searchFocal()
    assert.equal(await page.locator('.popup-carte-kpi').count(), 0, 'neutral popup has no invented numbers')
    assert.equal(await page.getByRole('link', { name: 'Voir la fiche' }).getAttribute('href'),
      `/territoire/${focal.type}/${focal.territoire}`)

    // A real pointer drag and navigation control must change the geographic
    // popup's screen projection, not merely leave a canvas node mounted.
    const popup = page.locator('.popup-carte-fenetre')
    const box = await canvas.boundingBox()
    assert(box)
    let projection = await popup.getAttribute('style')
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.3 + 70, box.y + box.height * 0.7 + 35, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction((previous) => document.querySelector('.popup-carte-fenetre')?.getAttribute('style') !== previous, projection)
    projection = await popup.getAttribute('style')
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await page.waitForFunction((previous) => document.querySelector('.popup-carte-fenetre')?.getAttribute('style') !== previous, projection)
    await page.locator('.popup-carte-fenetre .maplibregl-popup-close-button').click()
    await searchFocal()
    await page.locator('.popup-carte-fenetre .maplibregl-popup-close-button').click()
    const centered = await canvas.boundingBox()
    await page.mouse.move(centered.x + centered.width / 2, centered.y + centered.height / 2)
    await page.locator('.tooltip-carte').waitFor({ state: 'visible' })
    assert((await page.locator('.tooltip-carte-nom').innerText()).length > 0, 'real map hover resolves a territory')

    const spec = specs.find((candidate) => candidate.indicator === 'mix_logements')
    assert(spec)
    await page.getByRole('tab', { name: 'Habitat', exact: true }).click()
    await page.waitForURL((url) => url.searchParams.get('theme') === spec.theme)
    const values = []
    for (const detail of spec.details.slice(0, 2)) {
      const label = spec.metadata.detail_labels[spec.indicator][detail]
      await sidebar.getByRole('button', { name: label, exact: true }).click()
      await searchFocal()
      const response = harness.factResults.find((result) => result.resource === spec.indicator && result.target.type === focal.type)
      assert(response, 'selected standalone layer acquires API facts')
      const cell = response.profiles.find((profile) => profile.territory.id === focal.territoire).cells.find((candidate) => candidate.detail === detail)
      const expected = `${formatValue(cell)} ${cell.unit}`
      await page.waitForFunction((value) => document.querySelector('.popup-carte-kpi')?.textContent?.includes(value), expected)
      assert((await page.locator('.popup-carte').innerText()).includes('API source'))
      values.push({ detail, expected })
    }
    const levelResponse = page.waitForResponse((response) => response.url().endsWith('/api/resources/read-batch') && response.ok())
    await sidebar.getByRole('radio', { name: 'EPCI', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[role="radio"].est-actif')?.textContent?.trim() === 'EPCI')
    await levelResponse
    assert(harness.profileFacts.some((item) => item.target.type === 'epci'), 'mask switch acquires the declared native level')
    await sidebar.getByRole('radio', { name: 'Communes', exact: true }).click()
    await searchFocal()
    const oldWidth = await canvas.evaluate((element) => element.clientWidth)
    await page.setViewportSize({ width: 1040, height: 760 })
    await page.waitForFunction((previous) => {
      const element = document.querySelector('.maplibregl-canvas')
      return element && element.clientWidth !== previous && element.width === Math.round(element.clientWidth * devicePixelRatio)
    }, oldWidth)
    let screenshot = null
    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true })
      screenshot = resolve(artifactDir, 'standalone-map.png')
      await page.screenshot({ path: screenshot, fullPage: true })
    }
    await page.getByRole('link', { name: 'Voir la fiche' }).click()
    await page.waitForURL((url) => url.pathname === `/territoire/${focal.type}/${focal.territoire}`)
    assert.equal(await canvas.count(), 0, 'navigation unmounts and disposes the real map')
    assert.deepEqual(harness.unexpectedApi, [])
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(retiredNumericalRequests, [], 'no retired numerical JSON requests')
    assert.deepEqual(errors, [])
    return { checks: ['real WebGL2 canvas and MapLibre module worker', 'TileJSON attribution sanitizer', 'neutral popup', 'search and popup', 'pointer pan',
      'zoom control', 'hover tooltip', 'native layer values and updates', 'mask level', 'resize', 'fiche navigation and cleanup'],
      values, screenshot, workerUrls, externalRequests, pageErrors: errors }
  } catch (error) {
    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true })
      await page.screenshot({ path: resolve(artifactDir, 'standalone-failure.png'), fullPage: true })
    }
    console.error('Standalone map evidence at failure:', JSON.stringify({ errors, externalRequests,
      unexpectedApi: harness.unexpectedApi, body: (await page.locator('body').innerText()).slice(0, 4000) }))
    throw error
  } finally {
    await page.close()
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
  const { formaterValeur, formaterRang } = await server.ssrLoadModule('/src/payload/selectors.ts')
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
    // MapLibre cancels in-flight vector tiles when the route/viewport changes;
    // these navigation aborts are not failed assets.
    if (!new URL(request.url()).hostname.startsWith('127.0.0.1') &&
        request.failure()?.errorText !== 'net::ERR_ABORTED') {
      externalFailures.push(`${request.url()} (${request.failure()?.errorText ?? 'request failed'})`)
    }
  })
  await page.route('**/api/**', (route) => harness.handleApi(route))
  await page.route('**/data/territoires.json', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(territoiresFixture) }))

  const routeEvidence = []
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

    const comparison = harness.comparisonResults.slice(startComparisons)
      .find(({ item }) => item.resource === spec.indicator)?.result
    assert(comparison, `${spec.indicator} must return a selected numeric comparison`)
    const expectedMedian = `${formaterValeur({ value: comparison.median, unit: comparison.unit })} ${comparison.unit}`
    const medianSurface = spec.family === 'distribution' || typeof comparison.source_facet === 'string'
      ? await page.locator('[data-testid="profile-comparison-summary"]').innerText()
      : await page.locator('.median strong').innerText()
    assert(medianSurface.includes(expectedMedian),
      `${spec.indicator} must render its selected API median ${expectedMedian}: ${medianSurface}`)

    const tableRows = page.locator('.comparison-table-scroll tbody tr')
    assert.equal(await tableRows.count(), comparison.member_ranks.length,
      `${spec.indicator} table must cover every selected API peer`)
    let selectedTableFact = null
    for (const peer of comparison.member_ranks) {
      const territory = territoiresFixture.find((candidate) => candidate.territoire === peer.territory_id)
      assert(territory, `${spec.indicator} peer ${peer.territory_id} must exist in the territory reference`)
      const cells = tableRows.filter({ hasText: territory.nom }).locator('td')
      const expectedRank = formaterRang(peer.rank, peer.rank_size) ?? ''
      assert.equal((await cells.nth(2).innerText()).trim(), expectedRank,
        `${spec.indicator} peer rank for ${territory.nom} must match the semantic API result`)
      if (peer.territory_id === '22001') {
        const detail = spec.page.comparison?.detail ?? spec.details[0]
        const sex = spec.page.comparison?.sex ?? null
        const detailIndex = spec.details.indexOf(detail)
        const sexIndex = sex === null ? 0 : spec.sexes.indexOf(sex)
        const value = spec.scalar ? 0.623 : 0.317 + detailIndex * 0.019 + sexIndex * 0.007
        const unit = spec.scalar ? spec.page.comparison.unit : spec.units[detail]
        const expectedFact = `${formaterValeur({ value, unit })} ${unit}`
        assert((await cells.nth(1).innerText()).includes(expectedFact),
          `${spec.indicator} peer table must render its selected API fact ${expectedFact}: ${await cells.nth(1).innerText()}`)
        selectedTableFact = expectedFact
      }
    }

    // Verify the actual map surface uses this route's native API fact, including
    // the separately declared scalar companion for DPE.
    await page.getByRole('button', { name: 'Carte', exact: true }).click()
    await page.locator('.popup-carte-kpi').first().waitFor({ state: 'visible', timeout: 20000 })
    const routeMapPopup = await page.locator('.popup-carte').innerText()
    const detail = spec.page.comparison?.detail ?? spec.details[0]
    const sex = spec.page.comparison?.sex ?? null
    const detailIndex = spec.details.indexOf(detail)
    const sexIndex = sex === null ? 0 : spec.sexes.indexOf(sex)
    const unit = spec.scalar ? spec.page.comparison.unit : spec.units[detail]
    const value = spec.scalar ? 0.623 : spec.sexes.length
      ? spec.sexes.reduce((sum, _sex, index) => sum + 0.317 + detailIndex * 0.019 + index * 0.007, 0)
      : 0.317 + detailIndex * 0.019 + sexIndex * 0.007
    const label = spec.scalar ? `API label ${spec.scalar}` : `API axis ${detail}`
    const expectedMapFact = `${formaterValeur({ value, unit })} ${unit}`
    assert(routeMapPopup.includes(label) && routeMapPopup.includes(expectedMapFact),
      `${spec.indicator} map must display ${label} · ${expectedMapFact}: ${routeMapPopup}`)
    routeEvidence.push({ theme: spec.theme, indicator: spec.indicator,
      comparison: { median: comparison.median, unit: comparison.unit, rendered: expectedMedian },
      selectedTableFact, peerRanks: comparison.member_ranks,
      mapFact: { label, rendered: expectedMapFact } })

    await page.getByRole('button', { name: 'L’indicateur' }).click()
    await page.getByText('API-2026', { exact: false }).first().waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('[role="status"]:not([hidden])')?.textContent?.includes('Chargement de'))
  }

  // The retained indicator-to-fiche handoff remains a live, routable destination
  // after the profile page has acquired its facts from the semantic API.
  await page.goto(`${baseUrl}indicateurs/habitat/mix_logements?territoire=22001&niveau=commune&vue=reperes`,
    { waitUntil: 'domcontentloaded' })
  const focalRow = page.locator('.comparison-table-scroll tbody tr').filter({ hasText: 'Commune A1' })
  await focalRow.getByRole('link', { name: 'Commune A1' }).click()
  await page.waitForURL((url) => url.pathname === '/territoire/commune/22001' && url.searchParams.get('theme') === 'habitat')
  // #868 — the fiche bootstraps from the compact territory reference, not from a
  // per-territory read model.
  // The /data/territoires.json route above serves this fixture, not the
  // repository's published names. Assert the identity the browser actually got.
  const reference = territoiresFixture
  const ficheTarget = reference.find((row) => row.territoire === '22001')
  await page.getByRole('heading', { name: ficheTarget.nom, level: 1 })
    .waitFor({ state: 'visible', timeout: 15000 })
  const ficheReferenceRequest = requests.find((path) => path === '/data/territoires.json')
  assert.equal(ficheReferenceRequest, '/data/territoires.json',
    'A retained profile table link must resolve to the territory fiche bootstrapped from the reference')
  assert.equal(requests.find((path) => path.includes('/data/modeles-lecture/')), undefined,
    'The fiche must never request a per-territory read model anymore')

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
  let indicatorMapScreenshot = null
  if (browserArtifactDir) {
    await mkdir(browserArtifactDir, { recursive: true })
    indicatorMapScreenshot = resolve(browserArtifactDir, 'indicator-map.png')
    await page.screenshot({ path: indicatorMapScreenshot, fullPage: true })
  }

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
  assert(harness.fixedComparisons.every((item) => item.coordinates === undefined),
    'Fixed profile comparisons must stay on their published default facet')
  assert.deepEqual(numericStatic, [], 'No static indicator numeric payload may be requested')
  assert.deepEqual(retired, [], 'No retired profile route may be called')
  assert.deepEqual(harness.unexpectedApi, [], 'Every API request must be intercepted by this fixture')
  assert.deepEqual(pageErrors, [], `The browser must finish without uncaught page errors: ${pageErrors.join('; ')}`)

  const standaloneMap = await verifyStandaloneMap(browser, baseUrl, specs, territoiresFixture, formaterValeur)

  const headAtEnd = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  assert.equal(headAtEnd, headAtStart, 'HEAD must remain unchanged throughout browser verification')
  const report = {
    issue: '#853', head: headAtEnd, headAtStart, headAtEnd, command: 'cd app && npm run verify:profile-pages',
    modeVariables: 'all VITE_* variables unset before Vite server start',
    profileRoutes: census.length, profileCensus: census,
    routeEvidence,
    checks: ['API-derived headings/axes/provenance and all four page families',
      'all ten routes render selected numeric facts/units, exact API peer ranks, and map values',
      'single semantic profile cohort per route; no static numeric payload or retired endpoint',
      'selected detail × sex coordinates update comparison without rereading facts',
      'selected API facet and unit in the map popup', 'DPE scalar companion remains separate',
      'missing and suppressed DPE cells remain an incomplete signature',
      'actual comparison HTTP 503 retry preserves warm profile facts', 'late route response cannot replace new profile',
      'EPCI cohort and regional facts-only behavior', 'profile table link to retained territory fiche',
      '360px mobile horizontal-overflow smoke'],
    counts: { interceptedApiRequests: harness.apiRequests.length, profileFactReads: harness.profileFacts.length,
      profileFocalReads: harness.profileFocalReads.length, fixedComparisonReads: harness.fixedComparisons.length,
      linkedScalarFactReads: harness.scalarFacts.length, selectedComparisonReads: harness.comparisons.length,
      staticNumericReads: numericStatic.length, retiredProfileCalls: retired.length,
      unexpectedApiRequests: harness.unexpectedApi.length, browserPageErrors: pageErrors.length,
      externalAssetFailures: externalFailures },
    renderedEvidence: { profileMapPopup: mapPopup, dpeScalarMapPopup: dpePopup, indicatorMapScreenshot },
    mobile,
    standaloneMap,
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
