import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Real-browser, populated contract check for issue #823. The static territory
// read model is checked-in production data; post-#627 and AEDAR semantic reads
// are intercepted with the same builders/contracts used by the app tests.
// Run: npm run verify:mobile-cahier-overflow. If Playwright has no cached
// browser, run `npx playwright-core install chromium`; alternatively set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE to an installed Chromium executable.
process.env.VITE_THEME_ACQUISITION_API = '1'
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
const evidenceDir = resolve(process.env.CAHIER_EVIDENCE_DIR ?? join(tmpdir(), 'lusk-mobile-cahier-evidence'))
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const server = await createServer({
  configFile: resolve(appRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
let browser

try {
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  const { validerModeleTerritoire } = await server.ssrLoadModule('/src/payload/territoryReadModel.ts')
  const { reponseThemeMobiliteApi } = await server.ssrLoadModule('/src/__tests__/helpers/mobiliteThemeApiStub.ts')
  const { AEDAR_TYPEQU_REGISTRY } = await server.ssrLoadModule('/src/fiche/content/aedarTypequRegistry.ts')
  const semanticContracts = JSON.parse(await readFile(
    resolve(repoRoot, 'pipeline/inst/extdata/semantic-resource-contracts.json'), 'utf8',
  ))
  const aedarContract = semanticContracts.resources.find(({ resource_id }) => resource_id === 'aedar_territorial_aggregate')
  assert(aedarContract?.source_id, 'AEDAR semantic resource contract must declare its source_id')
  const publishedModel = JSON.parse(await readFile(
    resolve(repoRoot, 'public/data/modeles-lecture/territoires/commune/35238.json'), 'utf8',
  ))
  const model = validerModeleTerritoire(publishedModel, 'territoires/commune/35238.json', {
    type: 'commune', territoire: '35238',
  })
  model.cohortTerritories = JSON.parse(await readFile(resolve(repoRoot, 'public/data/territoires.json'), 'utf8'))
  const mobilityFacts = reponseThemeMobiliteApi(model, 'commune', '35238', null)
  const fixtureAttribution = 'Synthetic browser fixture; not published AEDAR facts'
  await mkdir(evidenceDir, { recursive: true })

  function aedarBatchResponse(request) {
    return {
      contract: 'semantic-read-batch-v1',
      results: request.items.map((item) => ({
        id: item.id,
        data: {
          resource: item.resource,
          target: item.target,
          territory: { territory_type: item.target.type, territory_id: item.target.id },
          content_version: 'fixture-823-aedar-v1',
          reference_content_version: 'fixture-823-territories-v1',
          limit: 100,
          offset: 0,
          facts: item.coordinates.typequ.map((code, typeIndex) => {
            const equipment = AEDAR_TYPEQU_REGISTRY.find(({ code: candidate }) => candidate === code)
            assert(equipment, `TYPEQU ${code} absent du registre producteur`)
            const measures = {}
            for (const [horizonIndex, horizon] of [5, 10, 15, 20].entries()) {
              for (const [modeIndex, mode] of ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].entries()) {
                const minimum = 1 + horizonIndex + modeIndex / 10 + (typeIndex % 4) / 10
                measures[`count_${horizon}_${mode}_share`] = Math.min(0.95, 0.35 + horizonIndex * 0.12 + modeIndex * 0.03 + (typeIndex % 7) * 0.01)
                measures[`count_${horizon}_${mode}_min`] = minimum
                measures[`count_${horizon}_${mode}_max`] = minimum + 8
                for (let decile = 1; decile <= 9; decile += 1) {
                  measures[`count_${horizon}_${mode}_decile${decile}`] = minimum + decile * 0.8
                }
                measures[`count_${horizon}_${mode}_mean`] = minimum + 4
                const distribution = [minimum, ...Array.from({ length: 9 }, (_, index) => minimum + (index + 1) * 0.8), minimum + 8]
                assert(distribution.every((value, index) => index === 0 || distribution[index - 1] <= value))
                assert(distribution[0] <= measures[`count_${horizon}_${mode}_mean`] &&
                  measures[`count_${horizon}_${mode}_mean`] <= distribution.at(-1))
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
              attribution: fixtureAttribution,
              reference_date: '2026-01-01',
              publication_date: '2026-10-22',
            }
          }),
        },
      })),
    }
  }

  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const reports = []
  for (const width of [320, 360, 390, 760, 1440, 1800]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 })
    const readCalls = { mobilityFacts: 0, aedarBatches: 0, aedarItems: [] }
    await page.route('**/api/territories/commune/35238/themes/mobilite/facts', async (route) => {
      readCalls.mobilityFacts += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mobilityFacts) })
    })
    await page.route('**/api/territories/commune/35238/themes/mobilite/comparison', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mobilityFacts.comparison) })
    })
    await page.route('**/api/resources/read-batch', async (route) => {
      readCalls.aedarBatches += 1
      const request = route.request().postDataJSON()
      readCalls.aedarItems.push(...request.items.map((item) => ({
        id: item.id,
        resource: item.resource,
        target: item.target,
        typequ: item.coordinates.typequ,
      })))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aedarBatchResponse(request)) })
    })
    await page.goto(`${baseUrl}territoire/commune/35238?theme=mobilite`, { waitUntil: 'networkidle' })
    await page.locator('#section-aedar-car-overview').waitFor({ state: 'visible' })
    await page.locator('#section-aedar-equipment-explorer').waitFor({ state: 'visible' })

    assert.equal(readCalls.mobilityFacts, 1,
      `Expected exactly one theme-facts fixture request at ${width}px; got ${readCalls.mobilityFacts}. The theme-facts route may not have been requested or matched.`)
    const expectedAedarBatches = Math.ceil(AEDAR_TYPEQU_REGISTRY.length / 100)
    assert.equal(readCalls.aedarBatches, 1,
      `Expected exactly one semantic read-batch POST at ${width}px; got ${readCalls.aedarBatches}. The AEDAR fixture route may not have been requested or matched.`)
    assert.equal(readCalls.aedarItems.length, expectedAedarBatches,
      `Expected ${expectedAedarBatches} AEDAR resource items at ${width}px; got ${readCalls.aedarItems.length}.`)
    for (const [index, item] of readCalls.aedarItems.entries()) {
      const start = index * 100
      const expectedCodes = AEDAR_TYPEQU_REGISTRY.slice(start, start + 100).map(({ code }) => code)
      assert.equal(item.id, `aedar-${index}`, `Unexpected AEDAR item id at ${width}px, index ${index}`)
      assert.equal(item.resource, 'aedar_territorial_aggregate', `Unexpected AEDAR resource at ${width}px, item ${index}`)
      assert.deepEqual(item.target, { kind: 'territory', type: 'commune', id: '35238' },
        `Unexpected AEDAR target at ${width}px, item ${index}`)
      assert.deepEqual(item.typequ, expectedCodes,
        `AEDAR TYPEQU range mismatch at ${width}px, item ${index}; fixture must cover the registered codes in producer order.`)
    }

    // Disable the inherited clipping while measuring; otherwise scrollWidth can
    // falsely pass even when an oversized Cahier child sticks out of the page.
    const metrics = await page.evaluate(async () => {
      const html = document.documentElement
      const body = document.body
      for (const node of [html, body]) {
        node.style.setProperty('overflow-x', 'visible', 'important')
        node.style.setProperty('width', 'auto', 'important')
        node.style.setProperty('position', 'static', 'important')
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const cahier = document.querySelector('.cahier')
      const rect = (selector) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const box = el.getBoundingClientRect()
        return { x: box.x, right: box.right, width: box.width, center: box.x + box.width / 2 }
      }
      const paperStyle = getComputedStyle(document.querySelector('.cahier-page'))
      const figures = [...cahier.querySelectorAll('figure')].filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      const controls = [...cahier.querySelectorAll('button, input, select')].filter((el) => el.getBoundingClientRect().width > 0)
      const overflowing = [...cahier.querySelectorAll('*')].flatMap((el) => {
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' ||
            style.position === 'fixed' || rect.right <= innerWidth + 1) return []
        // Ignore only descendants intentionally clipped by their own local
        // viewport (e.g. the off-canvas map gallery's internal image strip).
        for (let parent = el.parentElement; parent && parent !== cahier; parent = parent.parentElement) {
          if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) return []
        }
        return [{ tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', right: rect.right }]
      })
      return {
        innerWidth,
        clientWidth: html.clientWidth,
        documentScrollWidth: html.scrollWidth,
        bodyScrollWidth: body.scrollWidth,
        cahierWidth: cahier.getBoundingClientRect().width,
        pageWidth: document.querySelector('.cahier-page').getBoundingClientRect().width,
        readerRect: rect('.cahier-reader'),
        pagesRect: rect('.cahier-pages'),
        paperRect: rect('.cahier-page'),
        indexRect: rect('.mobile-index'),
        contentRect: rect('.cahier-page .page-main'),
        pageHeadingParts: ['.page-heading-index', '.page-heading h2', '.page-heading-context'].map((selector) => ({
          selector,
          ...rect(`.cahier-page ${selector}`),
        })).filter(({ width }) => width > 0),
        paperContentInset: {
          left: parseFloat(paperStyle.paddingLeft),
          right: parseFloat(paperStyle.paddingRight),
          borderLeft: parseFloat(paperStyle.borderLeftWidth),
          borderRight: parseFloat(paperStyle.borderRightWidth),
          boxShadow: paperStyle.boxShadow,
        },
        productionAedarCahier: cahier.classList.contains('cahier--indexed-sections') &&
          document.querySelector('.aedar-equipment-explorer') !== null,
        productionClassComposition: {
          indexed: cahier.classList.contains('cahier--indexed-sections'),
          plainPresentation: cahier.classList.contains('cahier--sans-grille'),
        },
        figureCount: figures.length,
        controlCount: controls.length,
        populatedSections: ['aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer']
          .filter((key) => document.querySelector(`#section-${key}`)),
        hasExpectedReading: cahier.innerText.includes('Base permanente des équipements') &&
          cahier.innerText.includes('TYPES D’ÉQUIPEMENTS ACCESSIBLES'),
        hasFixtureProvenance: cahier.innerText.includes('Synthetic browser fixture; not published AEDAR facts'),
        errorOrLoadingShells: [...cahier.querySelectorAll('[role="alert"], [role="status"]:not(.aedar-equipment-explorer-selected), .aedar-state')]
          .filter((el) => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 })
          .map((el) => ({ role: el.getAttribute('role'), text: el.innerText.slice(0, 120), className: el.className })),
        overflowing,
      }
    })
    assert.equal(metrics.innerWidth, width)
    assert.equal(metrics.clientWidth, width)
    assert.equal(metrics.documentScrollWidth, width, `document overflow at ${width}px: ${JSON.stringify(metrics)}`)
    assert.equal(metrics.bodyScrollWidth, width, `body overflow at ${width}px`)
    assert(metrics.productionAedarCahier, `Expected the production AEDAR Cahier at ${width}px`)
    assert.deepEqual(metrics.productionClassComposition, { indexed: true, plainPresentation: true },
      `Production must retain presentation="plain" together with layoutVariant="indexed-sections" at ${width}px`)
    assert.deepEqual(metrics.populatedSections, ['aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer'])
    assert.deepEqual(metrics.errorOrLoadingShells, [], `Loading/error shells are not populated content at ${width}px`)
    assert(metrics.figureCount >= 7, `Expected real figures at ${width}px, got ${metrics.figureCount}`)
    assert(metrics.controlCount >= 10, `Expected interactive controls at ${width}px, got ${metrics.controlCount}`)
    assert(metrics.hasExpectedReading, `Expected populated figure reading at ${width}px`)
    assert(metrics.hasFixtureProvenance, `Expected fixture provenance at ${width}px`)
    assert.deepEqual(metrics.overflowing, [], `Visible Cahier descendants overflow at ${width}px`)

    if (width <= 760) {
      assert(Math.abs(metrics.readerRect.x) <= 1 && Math.abs(metrics.readerRect.width - width) <= 1,
        `Mobile Cahier reader must span the viewport at ${width}px: ${JSON.stringify(metrics.readerRect)}`)
      assert(Math.abs(metrics.paperRect.x) <= 1 && Math.abs(metrics.paperRect.width - width) <= 1,
        `Mobile paper must be edge-to-edge at ${width}px: ${JSON.stringify(metrics.paperRect)}`)
      assert(Math.abs(metrics.contentRect.x - metrics.paperRect.x - 16) <= 1,
        `Mobile content should start 16px inside the paper at ${width}px: ${JSON.stringify(metrics)}`)
      assert(Math.abs(metrics.paperRect.right - metrics.contentRect.right - 16) <= 1,
        `Mobile content should end 16px inside the paper at ${width}px: ${JSON.stringify(metrics)}`)
      assert(Math.abs(metrics.indexRect.x) <= 1 && Math.abs(metrics.indexRect.width - width) <= 1,
        `Mobile index should align with the viewport at ${width}px: ${JSON.stringify(metrics.indexRect)}`)
      assert.equal(metrics.paperContentInset.left, 16,
        `Mobile paper content inset should be 16px at ${width}px: ${JSON.stringify(metrics.paperContentInset)}`)
      assert.equal(metrics.paperContentInset.right, 16,
        `Mobile paper content inset should be 16px at ${width}px: ${JSON.stringify(metrics.paperContentInset)}`)
      assert.equal(metrics.paperContentInset.borderLeft, 0, `Mobile paper should have no framing border at ${width}px`)
      assert.equal(metrics.paperContentInset.borderRight, 0, `Mobile paper should have no framing border at ${width}px`)
      assert.equal(metrics.paperContentInset.boxShadow, 'none', `Mobile paper should have no outside sheet shadow at ${width}px`)
      for (let leftIndex = 0; leftIndex < metrics.pageHeadingParts.length; leftIndex += 1) {
        for (const rightPart of metrics.pageHeadingParts.slice(leftIndex + 1)) {
          const leftPart = metrics.pageHeadingParts[leftIndex]
          const overlaps = leftPart.x < rightPart.right - 1 && leftPart.right > rightPart.x + 1 &&
            leftPart.y < rightPart.bottom - 1 && leftPart.bottom > rightPart.y + 1
          assert(!overlaps,
            `Indexed mobile page heading metadata overlaps at ${width}px: ${JSON.stringify(metrics.pageHeadingParts)}`)
        }
      }
    } else {
      assert(metrics.paperRect.x > 0 && metrics.paperRect.right < width,
        `Desktop outer site ground should remain visible around the paper at ${width}px: ${JSON.stringify(metrics.paperRect)}`)
      assert(Math.abs(metrics.paperRect.center - metrics.pagesRect.center) <= 1,
        `Desktop paper should be centered in its sheet column at ${width}px: ${JSON.stringify(metrics)}`)
      if (width === 1440) assert(metrics.paperRect.width > 1000,
        `Paper was unnecessarily reduced when the available desktop column is narrower than 1200px: ${JSON.stringify(metrics.paperRect)}`)
      assert(Math.abs(metrics.paperRect.width - metrics.pagesRect.width) <= 1,
        `Desktop paper should retain the indexed baseline's full sheet-column width at ${width}px: ${JSON.stringify(metrics)}`)
      if (width === 1800) assert(metrics.paperRect.width > 1200,
        `Wide desktop paper must remain on the 560419f indexed baseline, not a mobile-PR width cap: ${JSON.stringify(metrics.paperRect)}`)
    }

    if ([320, 360, 390, 760, 1440, 1800].includes(width)) {
      await page.locator('#section-aedar-car-overview').scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(evidenceDir, `issue823-aedar-populated-${width}.png`), fullPage: false })
    }

    let oversizedMutationDetected = false
    if (width === 390) {
      // Prove the assertion is live: deliberately inject the reported-scale
      // oversized page, confirm red geometry, then remove the mutation.
      const red = await page.evaluate(() => {
        document.querySelector('.cahier-page').style.width = '510px'
        return { html: document.documentElement.scrollWidth, body: document.body.scrollWidth }
      })
      assert(red.html > width && red.body > width, `Oversize mutation did not trigger browser alarm: ${JSON.stringify(red)}`)
      oversizedMutationDetected = true
      await page.evaluate(() => document.querySelector('.cahier-page').style.removeProperty('width'))
      const restored = await page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth])
      assert.deepEqual(restored, [width, width], 'restoring the mutation should restore mobile geometry')
    }

    reports.push({
      width,
      ...metrics,
      oversizedMutationDetected,
      readCalls: {
        mobilityFacts: readCalls.mobilityFacts,
        aedarBatches: readCalls.aedarBatches,
        aedarItems: readCalls.aedarItems.map((item) => ({
          id: item.id,
          count: item.typequ.length,
          firstTypequ: item.typequ[0],
          lastTypequ: item.typequ.at(-1),
        })),
      },
    })
    await page.close()
  }
  console.log(JSON.stringify({
    fixture: 'checked-in Rennes read model + existing theme-facts fixture builder + synthetic contract-valid AEDAR scenario (not published facts)',
    evidenceDir,
    reports,
  }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
