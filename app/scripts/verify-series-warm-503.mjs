import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

for (const name of Object.keys(process.env)) if (name.startsWith('VITE_')) delete process.env[name]
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
assert(process.argv[2], 'Pass an external UTF-8 JSON evidence path as the first argument')
const evidencePath = resolve(process.argv[2])
const evidenceRelativeToRepo = relative(repoRoot, evidencePath)
assert(evidenceRelativeToRepo.startsWith('..') || isAbsolute(evidenceRelativeToRepo),
  'Evidence output must be outside the repository')
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
assert.equal(statusBefore, '', 'Warm 503 browser proof requires a clean committed source tree')

const server = await createServer({ configFile: resolve(appRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false } })
let browser
try {
  await server.listen()
  const fixtures = await server.ssrLoadModule('/src/__tests__/helpers/semanticApiFixtures.ts')
  const territories = JSON.parse(await readFile(resolve(repoRoot, 'public/data/territoires.json'), 'utf8'))
  const { formaterValeur } = await server.ssrLoadModule('/src/payload/selectors.ts')
  const metadataByTheme = Object.fromEntries(await Promise.all(['habitat', 'milieux', 'programmes'].map(async (theme) =>
    [theme, JSON.parse(await readFile(resolve(repoRoot, 'public/data', `theme_${theme}.json`), 'utf8'))])))
  const resources = fixtures.nativeResources()
  const pages = [
    ['habitat', 'prix_m2', '&detail=2022'],
    ['milieux', 'artif_par_habitant', ''],
    ['milieux', 'conso_enaf_annuel', '&detail=2024'],
    ['programmes', 'subventions_annuelles', '&dimension=2025'],
  ].map(([theme, indicator, facetQuery]) => ({ theme, indicator, facetQuery,
    resource: resources.find((candidate) => candidate.resource_id === indicator),
    page: metadataByTheme[theme].indicator_pages[indicator] }))
  assert(pages.every((page) => page.resource && page.page), 'The four shared pages must come from producer declarations')

  const trace = []
  const factReads = []
  const comparisonReads = []
  let failWholeBatch = false
  let failComparison = false
  const handle = async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/resources' && request.method() === 'GET') {
      const response = await fixtures.nativeCatalogueResponse()
      await route.fulfill({ status: 200, contentType: 'application/json', body: await response.text() })
      return
    }
    if (url.pathname === '/api/resources/read-batch' && request.method() === 'POST') {
      const { items } = request.postDataJSON()
      const record = { status: null, items: structuredClone(items) }
      trace.push(record)
      factReads.push(...items.filter((item) => item.intent.kind === 'facts'))
      comparisonReads.push(...items.filter((item) => item.intent.kind !== 'facts'))
      if (failWholeBatch) {
        failWholeBatch = false
        record.status = 503
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'native read-batch unavailable' })
        return
      }
      if (failComparison && items.length === 1 && items[0]?.intent.kind !== 'facts') {
        failComparison = false
        record.status = 503
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'comparison unavailable' })
        return
      }
      const response = await fixtures.nativeBatchResponse(items, (item, declaration) => {
        const data = fixtures.nativeReadFixture(item, declaration, { territories })
        if (data.shape === 'ordered_series') {
          if (Array.isArray(data.points)) data.points = data.points.map((point) => point.status === 'measured'
            ? { ...point, value: Number(point.value) * 10 + 1234.5 } : point)
          if (Array.isArray(data.series)) data.series = data.series.map((group) => ({ ...group, points: group.points.map((point) =>
            point.status === 'measured' ? { ...point, value: Number(point.value) * 10 + 1234.5 } : point) }))
          if (Array.isArray(data.result?.axis_comparisons)) data.result.axis_comparisons = data.result.axis_comparisons.map((row) =>
            row.status === 'available' ? { ...row, value: row.value * 10 + 1234.5,
              min: row.min === null ? null : row.min * 10 + 1234.5,
              max: row.max === null ? null : row.max * 10 + 1234.5 } : row)
        }
        if (data.shape === 'scalar' && Array.isArray(data.observations)) data.observations = data.observations.map((row) =>
          row.status === 'measured' ? { ...row, value: Number(row.value) * 10 + 1234.5 } : row)
        return data
      })
      record.status = 200
      const responseBody = await response.text()
      record.response = JSON.parse(responseBody)
      await route.fulfill({ status: 200, contentType: 'application/json', body: responseBody })
      return
    }
    await route.fulfill({ status: 599, contentType: 'text/plain', body: `Unexpected API request: ${url.pathname}` })
  }

  browser = await chromium.launch({ headless: true,
    proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' },
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/**', handle)

  const focalA = territories.find((territory) => territory.territoire === '22001' && territory.type === 'commune')
  const focalB = territories.find((territory) => territory.type === 'commune' && territory.departement === '22' &&
    territory.territoire !== '22001')
  assert(focalA && focalB, 'The browser fixture requires two department-22 communes')
  const outcomes = []
  for (const spec of pages) {
    const route = `${server.resolvedUrls.local[0]}indicateurs/${spec.theme}/${spec.indicator}?territoire=${focalA.territoire}&niveau=commune&departement=22${spec.facetQuery}&vue=reperes`
    failWholeBatch = true
    const start = trace.length
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Réessayer', exact: true }).waitFor({ state: 'visible', timeout: 20000 })
    assert.deepEqual(trace.slice(start).map(({ status, items }) => [status, items.length]), [[503, 3]],
      `${spec.indicator}: cold 503 is all-or-none and admits nothing`)
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
    try {
      await waitPageData(page, spec)
    } catch (cause) {
      throw new Error(`${spec.indicator} cold recovery failed; text=${await page.locator('body').innerText()} trace=${JSON.stringify(trace.slice(start))}`, { cause })
    }
    assert.deepEqual(trace.slice(start).map(({ status, items }) => [status, items.length]), [[503, 3], [200, 3]],
      `${spec.indicator}: cold retry reacquires the bounded compound batch`)

    const cohortBefore = factReads.filter((item) => item.resource === spec.indicator &&
      item.target.kind === 'territory_cohort').length
    const initialSuccess = trace.at(-1)
    const initialCohort = fixturesResponseCohort(initialSuccess, spec.indicator)
    failWholeBatch = true
    await page.evaluate((id) => {
      const url = new URL(location.href)
      url.searchParams.set('territoire', id)
      history.pushState({}, '', url)
      dispatchEvent(new PopStateEvent('popstate'))
    }, focalB.territoire)
    await page.getByRole('button', { name: 'Réessayer', exact: true }).waitFor({ state: 'visible', timeout: 20000 })
    const miss = trace.at(-1)
    assert.deepEqual([miss.status, miss.items.length, miss.items[0]?.intent.kind,
      miss.items[0]?.target.kind, miss.items[0]?.target.id], [503, 1, 'facts', 'territory', focalB.territoire],
    `${spec.indicator}: warm route reads only the uncached exact focal, never a new compound/cohort read`)
    assert.equal(factReads.filter((item) => item.resource === spec.indicator &&
      item.target.kind === 'territory_cohort').length, cohortBefore,
    `${spec.indicator}: validated cohort facts are retained through focal 503`)
    await waitPageData(page, spec)
    await assertCohortFactsVisible(page, spec, initialCohort, focalB, formaterValeur)

    failComparison = true
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
    await page.getByTestId('series-comparison-error').waitFor({ state: 'visible', timeout: 20000 })
    const staged = trace.slice(start + 3)
    assert.deepEqual(staged.map(({ status, items }) => [status, items.length]), [[200, 1], [503, 1]],
      `${spec.indicator}: admit exact focal facts before independent comparison 503; ` +
      `cohortPublication=${JSON.stringify({ content_version: initialCohort.content_version,
        reference_content_version: initialCohort.reference_content_version,
        pooled_content_version: initialCohort.scalar_facet?.content_version,
        pooled_reference_content_version: initialCohort.scalar_facet?.reference_content_version })}; ` +
      `trace=${JSON.stringify(trace.slice(start).map(({ status, items }) => ({ status,
        intents: items.map((item) => item.intent.kind), targets: items.map((item) => item.target),
        publications: (trace.at(-1)?.response?.results ?? []).map(({ data }) => ({
          target: data.target, content_version: data.content_version,
          reference_content_version: data.reference_content_version,
          pooled_content_version: data.scalar_facet?.content_version,
          pooled_reference_content_version: data.scalar_facet?.reference_content_version,
        })) })))}`)
    assert.equal(staged[0].items[0].target.id, focalB.territoire)
    assert.equal(staged[1].items[0].intent.kind, 'selected_comparison')
    const factsAtComparisonFailure = factReads.filter((item) => item.resource === spec.indicator).length
    const valueBeforeCompareRetry = await seriesFocalNumbers(page, spec, focalB)
    await page.getByRole('button', { name: 'Réessayer la comparaison' }).click()
    await page.locator('[data-testid="series-comparison-error"]').waitFor({ state: 'detached', timeout: 20000 })
    assert.deepEqual([trace.at(-1).status, trace.at(-1).items.length,
      trace.at(-1).items[0].intent.kind], [200, 1, 'selected_comparison'])
    assert.equal(factReads.filter((item) => item.resource === spec.indicator).length, factsAtComparisonFailure,
      `${spec.indicator}: comparison-only retry cannot reread already admitted facts`)
    assert.deepEqual(await seriesFocalNumbers(page, spec, focalB), valueBeforeCompareRetry,
      `${spec.indicator}: comparison failure/retry cannot substitute the previous focal`)

    const recoveredTraceLength = trace.length
    for (const id of [focalA.territoire, focalB.territoire]) {
      await page.evaluate((territoire) => {
        const url = new URL(location.href)
        url.searchParams.set('territoire', territoire)
        history.pushState({}, '', url)
        dispatchEvent(new PopStateEvent('popstate'))
      }, id)
      await waitPageData(page, spec)
    }
    assert.equal(trace.length, recoveredTraceLength,
      `${spec.indicator}: same-key warm revisits deduplicate admitted facts and comparison`)
    outcomes.push({ indicator: spec.indicator, coldCompound503: trace.slice(start, start + 2)
      .map(({ status, items }) => ({ status, items: items.length })),
    warmNewFocalFacts503: { status: miss.status, item: miss.items[0] },
    comparison503AndRetry: trace.slice(start + 4, start + 7).map(({ status, items }) =>
      ({ status, intent: items[0]?.intent.kind, items: items.length })),
    cohortReads: cohortBefore, cohortRetained: true, revisitsDeduplicated: true })
  }
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('; ')}`)
  const statusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), head,
    'HEAD must remain unchanged during the browser proof')
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim(), branch,
    'Branch must remain unchanged during the browser proof')
  assert.equal(statusAfter, statusBefore, 'Source cleanliness must remain unchanged during the browser proof')
  const report = { issue: '#857', branch, head, cleanBeforeAndAfter: true,
    proxy: 'http://127.0.0.1:9', lifecycle: outcomes,
    requestTrace: trace, pageErrors }
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' })
  console.log(JSON.stringify({ ...report, evidencePath }, null, 2))
} finally {
  if (browser) await browser.close()
  await server.close()
}

function fixturesResponseCohort(batch, resource) {
  assert(batch && batch.status === 200, `${resource}: initial cohort response must be successfully admitted`)
  const response = batch.response
  const cohort = response?.results?.map((result) => result.data)
    .find((data) => data.resource === resource && data.target?.kind === 'territory_cohort')
  assert(cohort, `${resource}: successful compound response includes cohort facts`)
  return cohort
}

function waitPageData(page, spec) {
  return spec.page.family === 'trajectory'
    ? page.locator('figure[data-renderer="trajectory"]').waitFor({ state: 'visible', timeout: 20000 })
    : page.locator('.comparison-table-scroll tbody tr').first().waitFor({ state: 'visible', timeout: 20000 })
}

async function assertCohortFactsVisible(page, spec, cohort, focal, format) {
  const group = cohort.series?.find((candidate) => candidate.territory.id === focal.territoire &&
    candidate.territory.type === focal.type)
  assert(group, `${spec.indicator}: admitted cohort contains actual factual rows for the newly selected territory`)
  if (spec.page.family === 'trajectory') {
    await page.locator('figure[data-renderer="trajectory"]').waitFor({ state: 'visible', timeout: 20000 })
        const rendered = await page.locator('.trajectoire-territoire-point').evaluateAll((points) =>
          points.filter((point) => point.getAttribute('data-value') !== null).map((point) =>
            [point.getAttribute('data-detail'), Number(point.getAttribute('data-value'))]))
        const expected = group.points.filter((point) => point.status === 'measured')
          .map((point) => [point.axis, point.value])
        assert.deepEqual(rendered, expected,
          `${spec.indicator}: new focal renders its own native cohort values, not the old focal values; ` +
          `series=${JSON.stringify(await page.locator('.trajectoire-territoire-point').count())}; ` +
          `focal=${JSON.stringify(await page.locator('figure[data-renderer="trajectory"]').innerText())}`)
    return
  }
  const expectedPoint = group.points.find((point) => point.axis === cohort.descriptor.comparison_point &&
    point.status === 'measured')
  assert(expectedPoint, `${spec.indicator}: selected cohort point is measured in this fixture`)
  const row = page.locator('.comparison-table-scroll tbody tr').filter({ hasText: focal.nom })
  await row.waitFor({ state: 'visible', timeout: 20000 })
  assert((await row.innerText()).includes(format({ value: expectedPoint.value, unit: spec.resource.unit })),
    `${spec.indicator}: selected table row renders the actual new-focal cohort value`)
}

async function seriesFocalNumbers(page, spec, focal) {
  if (spec.page.family === 'trajectory') return page.locator('.trajectoire-territoire-point')
    .evaluateAll((points) => points.filter((point) => point.getAttribute('data-value') !== null).map((point) =>
      [point.getAttribute('data-detail'), Number(point.getAttribute('data-value'))]))
  return page.locator('.comparison-table-scroll tbody tr').filter({ hasText: focal.nom }).innerText()
}
