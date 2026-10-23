import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Real-browser, populated contract check for Cahier mobile overflow and the
// shared y-axis rail regression in issue #841 and W3 labels in issue #829.
// The static territory read model is checked-in production data; post-#627 and AEDAR semantic reads are
// intercepted with the same builders/contracts used by the app tests.
// Run: npm run verify:mobile-cahier-overflow. If Playwright has no cached
// browser, run `npx playwright-core install chromium`; alternatively set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE to an installed Chromium executable.
process.env.VITE_THEME_ACQUISITION_API = '1'
const appRoot = process.cwd()
const repoRoot = resolve(appRoot, '..')
const evidenceDir = resolve(process.env.CAHIER_EVIDENCE_DIR ?? join(tmpdir(), 'lusk-mobile-cahier-evidence'))
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

function rgbChannels(color) {
  let channels = color.match(/[\d.]+/gu)?.slice(0, 3).map(Number)
  assert(channels?.length === 3, `Expected a computed RGB color, got ${color}`)
  if (/^color\(srgb /u.test(color)) channels = channels.map((channel) => channel * 255)
  return channels
}

function relativeLuminance(color) {
  const [red, green, blue] = rgbChannels(color).map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground, background) {
  const ink = relativeLuminance(foreground)
  const fill = relativeLuminance(background)
  return (Math.max(ink, fill) + 0.05) / (Math.min(ink, fill) + 0.05)
}

const server = await createServer({
  configFile: resolve(appRoot, 'vite.config.ts'),
  // Let Vite select an available ephemeral port; the owner's live server may
  // already be using its usual development port.
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
let browser

try {
  await server.listen()
  const baseUrl = server.resolvedUrls.local[0]
  const { CAHIER_FIGURE_RAIL: railContract } =
    await server.ssrLoadModule('/src/fiche/cahierFigureGrammaire.ts')
  const { payloadDepuisModeleTerritoire, validerModeleTerritoire } =
    await server.ssrLoadModule('/src/payload/territoryReadModel.ts')
  const { territoryFactsFor } = await server.ssrLoadModule('/src/fiche/content/territoryFacts.ts')
  const { resolveMobiliteThemeContent } = await server.ssrLoadModule('/src/fiche/content/themeContent.ts')
  const { cahierPaginationFor } = await server.ssrLoadModule('/src/fiche/prototype/cahierPagination.ts')
  const { reponseThemeMobiliteApi } = await server.ssrLoadModule('/src/__tests__/helpers/mobiliteThemeApiStub.ts')
  const { AEDAR_CORE_MEASURE_KEYS, AEDAR_EXPLORER_DETAIL_MEASURE_KEYS } =
    await server.ssrLoadModule('/src/fiche/content/aedarTimeRampFacts.ts')
  const { AEDAR_EQUIPMENT_EXPLORER_INITIAL_TYPEQU } =
    await server.ssrLoadModule('/src/fiche/content/aedarAccessSection.ts')
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
  const plainPayload = payloadDepuisModeleTerritoire(model)
  const plainFacts = territoryFactsFor(plainPayload, '35238')
  assert(plainFacts, 'Published territory model must resolve Mobilité facts for the plain Cahier check')
  const plainContent = resolveMobiliteThemeContent(plainFacts, plainPayload.themeMetadata?.mobilite)
  const plainPagination = cahierPaginationFor(plainPayload, plainContent, true)
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
                const distribution = [minimum, ...Array.from({ length: 9 }, (_, index) => minimum + (index + 1) * 0.8), minimum + 8]
                assert(distribution.every((value, index) => index === 0 || distribution[index - 1] <= value))
                assert(distribution[0] <= projection[`count_${horizon}_${mode}_mean`] &&
                  projection[`count_${horizon}_${mode}_mean`] <= distribution.at(-1))
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
  for (const width of [320, 360, 390, 601, 760, 761, 1440, 1800]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 })
    const readCalls = { mobilityFacts: 0, aedarBatches: 0, aedarItems: [] }
    page.on('pageerror', (error) => console.error(`[browser pageerror ${width}px]`, error))
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
        fields: item.fields ?? [],
      })))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aedarBatchResponse(request)) })
    })
    await page.goto(`${baseUrl}territoire/commune/35238?theme=mobilite`, { waitUntil: 'networkidle' })
    try {
      await page.locator('#section-aedar-car-overview').waitFor({ state: 'visible', timeout: 10000 })
    } catch (error) {
      console.error(`[browser body ${width}px]`, (await page.locator('body').innerText()).slice(0, 2000))
      throw error
    }
    await page.locator('#section-aedar-equipment-explorer').waitFor({ state: 'visible' })

    const w3Visual = await page.evaluate(() => {
      const waffle = document.querySelector('.aedar-waffle')
      const grid = waffle?.querySelector('.aedar-waffle-grid')
      const tiles = [...(grid?.querySelectorAll('.aedar-waffle-tile') ?? [])]
      const legend = [...(waffle?.querySelectorAll('.cahier-figure-legend-action') ?? [])]
      const box = (element) => {
        const { x, y, right, bottom, width, height } = element.getBoundingClientRect()
        return { x, y, right, bottom, width, height }
      }
      const gridBox = grid ? box(grid) : null
      const tileBoxes = tiles.map(box)
      const labelSurfaces = [
        ['CahierBlankMapSlots', '.blank-map-slots .map-panel-label'],
        ['AedarDiversityLossMapsCahier', '.aedar-diversity-loss-map-label'],
        ['CartographicBreakoutPrototype', '.map-breakout .map-panel-label'],
      ].map(([surface, selector]) => {
        const labels = [...document.querySelectorAll(selector)]
        return {
          surface,
          count: labels.length,
          labels: labels.map((label) => {
            const parent = label.parentElement
            if (!parent) throw new Error(`${surface} label must have its map panel parent`)
            const probe = document.createElement('span')
            probe.style.color = 'var(--mode-ring)'
            probe.style.font = 'var(--text-caption)'
            probe.style.fontWeight = '600'
            probe.style.lineHeight = '1.3'
            probe.style.letterSpacing = 'var(--text-overline-tracking)'
            parent.append(probe)
            const modeFill = getComputedStyle(probe).color
            const originalMetadataFont = getComputedStyle(probe).fontFamily
            const originalMapTitleTracking = getComputedStyle(probe).letterSpacing
            const originalMapTitleLineHeight = getComputedStyle(probe).lineHeight
            probe.remove()
            const style = getComputedStyle(label)
            const { x, right, width, height } = label.getBoundingClientRect()
            return {
              text: label.textContent.trim(),
              fill: style.backgroundColor,
              foreground: style.color,
              modeFill,
              textTransform: style.textTransform,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              fontFamily: style.fontFamily,
              letterSpacing: style.letterSpacing,
              lineHeight: style.lineHeight,
              originalMetadataFont,
              originalMapTitleTracking,
              originalMapTitleLineHeight,
              padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
              minHeight: style.minHeight,
              marginBottom: style.marginBottom,
              borderRadius: style.borderRadius,
              iconColor: label.querySelector('svg') ? getComputedStyle(label.querySelector('svg')).color : null,
              width,
              height,
              x,
              right,
              iconCount: label.querySelectorAll('svg').length,
            }
          }),
        }
      })
      return {
        viewport: innerWidth,
        waffle: {
          tileCount: tiles.length,
          gridWidth: gridBox?.width ?? 0,
          gridHeight: gridBox?.height ?? 0,
          gridClientWidth: grid?.clientWidth ?? 0,
          gridScrollWidth: grid?.scrollWidth ?? 0,
          tileBoxes,
          tileBucketOrder: tiles.map((tile) => tile.getAttribute('data-bucket')),
          tileFillsByBucket: Object.fromEntries(tiles.map((tile) => [
            tile.getAttribute('data-bucket'), getComputedStyle(tile).backgroundColor,
          ])),
          legend: legend.map((button) => {
            const style = getComputedStyle(button)
            return {
              key: button.getAttribute('data-legend-key'),
              label: button.querySelector('.cahier-figure-legend-label')?.textContent.trim() ?? '',
              fill: style.backgroundColor,
              foreground: style.color,
              iconColor: button.querySelector('svg') ? getComputedStyle(button.querySelector('svg')).color : null,
              iconCount: button.querySelectorAll('svg').length,
              height: box(button).height,
            }
          }),
          note: waffle.querySelector('.aedar-waffle-legend-note')?.textContent.trim() ?? null,
        },
        labelSurfaces,
      }
    })
    assert.equal(w3Visual.waffle.tileCount, 235,
      `W3 must exercise the full production AEDAR category universe at ${width}px`)
    assert.deepEqual(w3Visual.labelSurfaces.map(({ surface, count }) => ({ surface, count: count > 0 })), [
      { surface: 'CahierBlankMapSlots', count: true },
      { surface: 'AedarDiversityLossMapsCahier', count: true },
      { surface: 'CartographicBreakoutPrototype', count: true },
    ], `W3 browser fixture must render each real map-title surface at ${width}px: ${JSON.stringify(w3Visual.labelSurfaces)}`)
    assert(w3Visual.waffle.tileBoxes.every(({ width: tileWidth, height: tileHeight }) =>
      tileWidth >= 24 - 0.5 && tileHeight >= 24 - 0.5),
    `Every Waffle tile must meet the 24×24px target floor at ${width}px: ${JSON.stringify(w3Visual.waffle.tileBoxes.slice(0, 4))}`)
    assert.equal(w3Visual.waffle.gridScrollWidth, w3Visual.waffle.gridClientWidth,
      `Waffle reflow must not create an internal horizontal scroller at ${width}px`)
    assert.equal(w3Visual.waffle.legend.length, 6,
      `All six AEDAR buckets must retain a Waffle legend action at ${width}px`)
    const legendKeys = w3Visual.waffle.legend.map(({ key }) => key)
    assert(legendKeys.every((key) => typeof key === 'string') && new Set(legendKeys).size === 6,
      `Waffle legend actions must keep a distinct key for every AEDAR bucket at ${width}px`)
    for (const chip of w3Visual.waffle.legend) {
      const tileFill = w3Visual.waffle.tileFillsByBucket[chip.key]
      if (tileFill) assert.equal(chip.fill, tileFill,
        `Waffle ${chip.key} chip must match its unchanged bucket tile fill at ${width}px`)
      assert.notEqual(chip.fill, 'rgba(0, 0, 0, 0)',
        `Waffle bucket ${chip.label} must render as a filled chip at ${width}px`)
      assert(contrastRatio(chip.foreground, chip.fill) >= 4.5,
        `Waffle bucket ${chip.label} must have 4.5:1 computed contrast at ${width}px: ${JSON.stringify(chip)}`)
      assert.equal(chip.iconCount, 1, `Waffle bucket ${chip.label} must keep its existing icon at ${width}px`)
      assert(contrastRatio(chip.iconColor, chip.fill) >= 4.5,
        `Waffle bucket ${chip.label} icon must remain visible against its filled chip at ${width}px: ${JSON.stringify(chip)}`)
      assert(chip.height >= 36 - 0.5,
        `Waffle legend action ${chip.label} must retain its 36px target at ${width}px`)
    }
    assert(w3Visual.waffle.note?.trim().length > 0,
      `Waffle legend must show its app-owned color limitation note beside its controls at ${width}px`)
    assert(w3Visual.waffle.tileBucketOrder.every((bucket, index, buckets) =>
      index === 0 || bucket === buckets[index - 1] || !buckets.slice(0, index).includes(bucket)),
    `Waffle tiles must remain grouped in their existing bucket order at ${width}px`)
    if (width === 320) {
      const columns = new Set(w3Visual.waffle.tileBoxes.map(({ x }) => Math.round(x * 10) / 10)).size
      const rows = new Set(w3Visual.waffle.tileBoxes.map(({ y }) => Math.round(y * 10) / 10)).size
      assert.equal(columns, 11,
        `320px Waffle should reflow to about 11 columns, got ${columns} (${w3Visual.waffle.gridWidth}px grid)`)
      assert.equal(rows, 22,
        `320px Waffle should reflow to about 22 rows, got ${rows}`)
    }
    const columnsForFiveRows = Math.ceil(w3Visual.waffle.tileCount / 5)
    const requiredWidthForFiveRows = columnsForFiveRows * 24 + (columnsForFiveRows - 1) * 2
    if (w3Visual.waffle.gridWidth >= requiredWidthForFiveRows) {
      const rows = new Set(w3Visual.waffle.tileBoxes.map(({ y }) => Math.round(y * 10) / 10)).size
      assert.equal(rows, 5,
        `Waffle should preserve the original five rows when the grid can fit 47 tiles at the 24px floor, got ${rows} at ${width}px`)
    }
    for (const { surface, labels } of w3Visual.labelSurfaces) {
      for (const label of labels) {
        assert(Number.parseFloat(label.fontSize) >= 12,
          `${surface} map title must use a semantic type role at or above 12px at ${width}px: ${JSON.stringify(label)}`)
        assert.equal(label.iconCount, 1, `${surface} must preserve each map mode icon at ${width}px`)
        assert.equal(label.iconColor, label.foreground,
          `${surface} map mode icon must use its label's computed foreground at ${width}px`)
        assert(label.x >= -0.5 && label.right <= width + 0.5,
          `${surface} chip must stay inside the viewport at ${width}px: ${JSON.stringify(label)}`)
        if (width <= 760) {
          assert.equal(label.fill, label.modeFill,
            `${surface} mobile chip must use its existing mode color at ${width}px: ${JSON.stringify(label)}`)
          assert.equal(label.textTransform, 'none',
            `${surface} mobile map labels must use natural case at ${width}px`)
          assert(contrastRatio(label.foreground, label.fill) >= 4.5,
            `${surface} map label must have 4.5:1 computed contrast at ${width}px: ${JSON.stringify(label)}`)
          assert(contrastRatio(label.iconColor, label.fill) >= 4.5,
            `${surface} map icon must have 4.5:1 computed contrast at ${width}px: ${JSON.stringify(label)}`)
        } else {
          assert.equal(label.foreground, label.modeFill,
            `${surface} desktop map title must retain its original mode color at ${width}px`)
          assert.equal(label.fill, 'rgba(0, 0, 0, 0)',
            `${surface} desktop map title must remain unfilled at ${width}px`)
          assert.equal(label.textTransform, 'uppercase',
            `${surface} desktop map title must retain uppercase styling at ${width}px`)
          assert.deepEqual(label.padding, ['0px', '0px', '0px', '0px'],
            `${surface} desktop map title must retain its original padding at ${width}px`)
          assert.equal(label.minHeight, '28px', `${surface} desktop map title must retain its original height at ${width}px`)
          assert.equal(label.marginBottom, '6px', `${surface} desktop map title must retain its original spacing at ${width}px`)
          assert.equal(label.fontWeight, '600', `${surface} desktop map title must retain its original weight at ${width}px`)
          assert.equal(label.fontFamily, label.originalMetadataFont,
            `${surface} desktop map title must retain its original metadata face at ${width}px`)
          assert.equal(label.letterSpacing, label.originalMapTitleTracking,
            `${surface} desktop map title must retain its original tracking at ${width}px`)
          assert.equal(label.lineHeight, label.originalMapTitleLineHeight,
            `${surface} desktop map title must retain its original line-height ratio at ${width}px`)
        }
      }
    }
    const tileColumns = new Set(w3Visual.waffle.tileBoxes.map(({ x }) => Math.round(x * 10) / 10)).size
    const tileRows = new Set(w3Visual.waffle.tileBoxes.map(({ y }) => Math.round(y * 10) / 10)).size
    const w3Summary = {
      waffle: {
        tileCount: w3Visual.waffle.tileCount,
        gridWidth: w3Visual.waffle.gridWidth,
        gridHeight: w3Visual.waffle.gridHeight,
        columns: tileColumns,
        rows: tileRows,
        minimumTile: {
          width: Math.min(...w3Visual.waffle.tileBoxes.map(({ width: tileWidth }) => tileWidth)),
          height: Math.min(...w3Visual.waffle.tileBoxes.map(({ height: tileHeight }) => tileHeight)),
        },
        legend: w3Visual.waffle.legend.map((chip) => ({
          key: chip.key,
          label: chip.label,
          fill: chip.fill,
          foreground: chip.foreground,
          contrast: Number(contrastRatio(chip.foreground, chip.fill).toFixed(2)),
        })),
      },
      mapLabels: w3Visual.labelSurfaces.map(({ surface, labels }) => ({
        surface,
        labels: labels.map((label) => ({
          text: label.text,
          fill: width <= 760 ? label.fill : null,
          foreground: width <= 760 ? label.foreground : null,
          contrast: width <= 760 ? Number(contrastRatio(label.foreground, label.fill).toFixed(2)) : null,
          iconCount: label.iconCount,
        })),
      })),
    }

    const longYAxisFigure = await page.evaluate(async ({ baseUrl, railContract }) => {
      const root = document.createElement('div')
      root.id = 'long-y-axis-browser-fixture'
      root.style.cssText = `position:fixed;top:0;left:0;width:${innerWidth}px;visibility:hidden;pointer-events:none;z-index:-1`
      document.body.append(root)
      const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
      const app = await fixture.mountLongYAxisFigure(root)
      try {
        await document.fonts.ready
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const frame = root.querySelector('.bpe-profile-visual')
        const plot = root.querySelector('.bpe-profile-chart')
        const svg = root.querySelector('.bpe-profile-chart-svg')
        const axis = root.querySelector('g.cahier-figure-axes > line.cahier-figure-axis:nth-of-type(2)')
        const horizontalAxis = root.querySelector('g.cahier-figure-axes > line.cahier-figure-axis:nth-of-type(1)')
        const firstBar = root.querySelector('.bpe-profile-bar--territory')
        const firstReferenceBar = root.querySelector('.bpe-profile-bar--reference')
        const labels = [...root.querySelectorAll('.cahier-figure-tick-label--y')]
        const title = root.querySelector('.cahier-figure-axis-title--y')
        if (!frame || !plot || !svg || !axis || !horizontalAxis || !firstBar || !firstReferenceBar || !labels.length || !title) {
          throw new Error('Long-y-label figure fixture did not mount completely')
        }
        const longestTick = labels.reduce((longest, label) => label.textContent.length > longest.length ? label.textContent : longest, '')
        const measuredLabelWidth = Math.max(...labels.map((label) => label.getBoundingClientRect().width))
        const frameWidth = frame.getBoundingClientRect().width
        const railPercent = Number.parseFloat(getComputedStyle(frame).getPropertyValue('--cahier-figure-grid-left'))
        const railWidth = railPercent * frameWidth / 100
        const frameRail = railPercent * svg.viewBox.baseVal.width / 100
        const axisLeft = Number(axis.getAttribute('x1'))
        const labelRail = Number.parseFloat(labels[0].style.left) * svg.viewBox.baseVal.width / 100
        const barX = Number(firstBar.getAttribute('x'))
        const { titleRect, labelRects, overlaps } = fixture.auditYAxisTitleTickOverlap(title, labels)
        const titleRight = titleRect.right
        const axisRight = Number(horizontalAxis.getAttribute('x2'))
        const profileCount = root.querySelectorAll('.bpe-profile-bars').length
        const barWidth = Number(firstBar.getAttribute('width'))
        const referenceBarWidth = Number(firstReferenceBar.getAttribute('width'))
        const referenceBarX = Number(firstReferenceBar.getAttribute('x'))
        const firstCategoryCenter = axisLeft + (axisRight - axisLeft) / (profileCount * 2)
        const pairedBarCenter = (barX + barWidth / 2 + referenceBarX + referenceBarWidth / 2) / 2
        const labelBandLeft = Math.min(...labels.map((label) => label.getBoundingClientRect().left))
        return {
          viewport: innerWidth,
          longestTick,
          measuredLabelWidth,
          railWidth,
          requiredRailWidth: railContract.titleLane + measuredLabelWidth + railContract.labelGap,
          frameRail,
          axisLeft,
          axisRight,
          labelRail,
          barX,
          barWidth,
          referenceBarX,
          referenceBarWidth,
          profileCount,
          firstCategoryCenter,
          pairedBarCenter,
          overlaps,
          labelBandLeft,
          titleRight,
        }
      } finally {
        app.unmount()
        root.remove()
      }
    }, { baseUrl, railContract })
    assert(longYAxisFigure.longestTick.replace(/\D/gu, '').length >= 4 && longYAxisFigure.measuredLabelWidth > 24,
      `Long y-axis fixture must contain a measured four-digit tick at ${width}px: ${JSON.stringify(longYAxisFigure)}`)
    assert(longYAxisFigure.railWidth >= longYAxisFigure.requiredRailWidth - 1,
      `Measured y-axis rail must reserve the label width and title lane at ${width}px: ${JSON.stringify(longYAxisFigure)}`)
    assert(longYAxisFigure.labelBandLeft >= longYAxisFigure.titleRight + 5,
      `Long tick-label band must stay outside the rotated title lane at ${width}px: ${JSON.stringify(longYAxisFigure)}`)
    if ([320, 360, 390].includes(width)) {
      assert.deepEqual(longYAxisFigure.overlaps, [],
        `BPE profile y-axis title must not intersect any tick label at ${width}px: ${JSON.stringify(longYAxisFigure)}`)
      assert(Math.abs(longYAxisFigure.frameRail - longYAxisFigure.axisLeft) < 0.5 &&
        Math.abs(longYAxisFigure.labelRail - longYAxisFigure.axisLeft) < 0.5,
      `BPE frame, SVG axis and HTML labels must share the measured rail at ${width}px: ${JSON.stringify(longYAxisFigure)}`)
      assert.equal(longYAxisFigure.profileCount, 4, 'Synthetic BPE fixture must render all four profile groups')
      assert(Math.abs(longYAxisFigure.pairedBarCenter - longYAxisFigure.firstCategoryCenter) < 0.5 &&
        longYAxisFigure.barX + longYAxisFigure.barWidth / 2 < longYAxisFigure.firstCategoryCenter &&
        longYAxisFigure.referenceBarX + longYAxisFigure.referenceBarWidth / 2 > longYAxisFigure.firstCategoryCenter,
      `BPE territory/reference bars must straddle the first category center derived from the SVG axis rails at ${width}px: ${JSON.stringify(longYAxisFigure)}`)
    }

    let accessRampLongYAxisFigure = null
    let accessRampRampYAxisFigure = null
    if ([320, 360, 390].includes(width)) {
      const accessRampFigures = await page.evaluate(async ({ baseUrl, railContract }) => {
        const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
        async function measure(variant) {
          const root = document.createElement('div')
          root.id = `access-ramp-${variant}-long-y-axis-browser-fixture`
          root.style.cssText = `position:fixed;top:0;left:0;width:${innerWidth}px;visibility:hidden;pointer-events:none;z-index:-1`
          document.body.append(root)
          const app = variant === 'time'
            ? await fixture.mountAccessRampLongYAxisFigure(root)
            : await fixture.mountAccessRampRampFigure(root)
          try {
            await document.fonts.ready
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            const frame = root.querySelector('.access-ramp-cahier')
            const plot = root.querySelector('.access-ramp-plot')
            const svg = root.querySelector('.access-ramp-svg')
            const axis = root.querySelector('.access-ramp-axis')
            const mark = variant === 'time'
              ? root.querySelector('.access-ramp-time-line.access-ramp-line--territory')
              : root.querySelector('.access-ramp-point')
            const hitbox = variant === 'time'
              ? root.querySelector('.access-ramp-cut-hitbox')
              : root.querySelector('.access-ramp-cut-hitbox')
            const labels = [...root.querySelectorAll('.cahier-figure-tick-label--y')]
            const title = root.querySelector('.cahier-figure-axis-title--y')
            if (!frame || !plot || !svg || !axis || !mark || !hitbox || labels.length === 0 || !title) {
              throw new Error(`Access-ramp ${variant} long-y-label fixture did not mount completely`)
            }
            const measuredLabelWidth = Math.max(...labels.map((label) => label.getBoundingClientRect().width))
            const viewBoxWidth = svg.viewBox.baseVal.width
            const viewBoxHeight = svg.viewBox.baseVal.height
            const renderedWidth = plot.getBoundingClientRect().width
            const railPercent = Number.parseFloat(getComputedStyle(frame).getPropertyValue('--cahier-figure-grid-left'))
            const railWidth = railPercent * viewBoxWidth / 100
            const axisLeft = Number(axis.getAttribute('x1'))
            const axisRight = Number(axis.getAttribute('x2'))
            const labelRailWidth = Number.parseFloat(labels[0].style.left) * viewBoxWidth / 100
            const frameStyle = getComputedStyle(frame)
            const frameRightPercent = Number.parseFloat(frameStyle.getPropertyValue('--cahier-figure-grid-right'))
            const frameRightWidth = frameRightPercent * viewBoxWidth / 100
            const frameTopWidth = Number.parseFloat(frameStyle.getPropertyValue('--cahier-figure-grid-top')) * viewBoxHeight / 100
            const frameBottomWidth = Number.parseFloat(frameStyle.getPropertyValue('--cahier-figure-grid-bottom')) * viewBoxHeight / 100
            const markX = variant === 'time'
              ? Number(mark.getAttribute('d').match(/^M\s*([\d.]+)/u)?.[1])
              : Number(mark.getAttribute('cx'))
            const hitboxRail = Number.parseFloat(hitbox.style.left) * viewBoxWidth / 100
            hitbox.click()
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            const tooltip = root.querySelector('.access-ramp-tooltip')
            const tooltipAnchor = tooltip?.style.getPropertyValue('--cahier-figure-tooltip-anchor-x') ?? ''
            const { titleRect, labelRects, overlaps } = fixture.auditYAxisTitleTickOverlap(title, labels)
            return {
              variant,
              viewport: innerWidth,
              labels: labelRects.map(({ text }) => text),
              measuredLabelWidth,
              renderedWidth,
              viewBoxWidth,
              viewBoxHeight,
              railWidth,
              requiredRailWidth: (railContract.titleLane + measuredLabelWidth + railContract.labelGap) * viewBoxWidth / renderedWidth,
              axisLeft,
              axisRight,
              markX,
              hitboxRail,
              tooltipAnchor,
              labelRailWidth,
              frameRightWidth,
              frameTopWidth,
              frameBottomWidth,
              titleRect,
              overlaps,
            }
          } finally {
            app.unmount()
            root.remove()
          }
        }
        return { time: await measure('time'), ramp: await measure('ramp') }
      }, { baseUrl, railContract })
      accessRampLongYAxisFigure = accessRampFigures.time
      accessRampRampYAxisFigure = accessRampFigures.ramp
      for (const [variant, report] of Object.entries(accessRampFigures)) {
        assert(report.labels.some((label) => label.replace(/\D/gu, '') === '12881') &&
          (variant !== 'time' || report.labels.some((label) => label.replace(/\D/gu, '') === '6440')),
        `Access-ramp ${variant} fixture must include Rennes-equivalent long ticks at ${width}px: ${JSON.stringify(report)}`)
        assert.deepEqual(report.overlaps, [],
          `Access-ramp ${variant} y-axis title must not intersect any y-tick label at ${width}px: ${JSON.stringify(report)}`)
        assert(report.railWidth >= report.requiredRailWidth - 1,
          `Access-ramp ${variant} frame must reserve measured label width and title lane at ${width}px: ${JSON.stringify(report)}`)
        assert.equal(report.viewBoxWidth, 640, `Access-ramp ${variant} must preserve its original 640px geometry`)
        assert.equal(report.viewBoxHeight, 300, `Access-ramp ${variant} must use its custom 300px geometry`)
        assert(Math.abs(report.frameRightWidth - 68) < 0.1 &&
          Math.abs(report.frameTopWidth - 22) < 0.1 &&
          Math.abs(report.frameBottomWidth - 62) < 0.1 &&
          report.railWidth >= 64,
        `Access-ramp ${variant} must preserve its original top/right/bottom margins and only widen the left rail: ${JSON.stringify(report)}`)
        assert(Math.abs(report.axisLeft - report.railWidth) < 0.5 &&
          Math.abs(report.labelRailWidth - report.railWidth) < 0.5,
        `Access-ramp ${variant} SVG axis, HTML labels and frame must share one measured left rail at ${width}px: ${JSON.stringify(report)}`)
        assert(Math.abs(report.markX - report.railWidth) < 0.5 &&
          Math.abs(report.hitboxRail - report.railWidth) < 0.5 && report.tooltipAnchor.length > 0,
        `Access-ramp ${variant} marks, hitboxes and tooltip must consume the measured geometry at ${width}px: ${JSON.stringify(report)}`)
        assert(Math.abs(report.axisRight - (report.viewBoxWidth - report.frameRightWidth)) < 0.5 &&
          report.axisRight - report.axisLeft < report.viewBoxWidth - report.frameRightWidth - 1,
        `Access-ramp ${variant} plot must give horizontal width to its measured y-axis rail at ${width}px: ${JSON.stringify(report)}`)
      }
    }

    let sandboxGroupedBarFigure = null
    if ([320, 360, 390].includes(width)) {
      sandboxGroupedBarFigure = await page.evaluate(async ({ baseUrl, railContract }) => {
        const root = document.createElement('div')
        root.id = 'sandbox-grouped-bar-browser-fixture'
        root.style.cssText = `position:fixed;top:0;left:0;width:${innerWidth}px;visibility:hidden;pointer-events:none;z-index:-1`
        document.body.append(root)
        const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
        const app = await fixture.mountSandboxGroupedBarFigure(root)
        try {
          await document.fonts.ready
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          const frame = root.querySelector('.cahier-grouped-vertical-bar-chart')
          const plot = root.querySelector('.cahier-grouped-vertical-bar-chart__plot')
          const svg = root.querySelector('.cahier-grouped-vertical-bar-chart__svg')
          const axis = root.querySelector('.cahier-grouped-vertical-bar-chart__axis')
          const bars = [...root.querySelectorAll('.cahier-grouped-vertical-bar-chart__bar')]
          const labels = [...root.querySelectorAll('.cahier-figure-tick-label--y')]
          const title = root.querySelector('.cahier-figure-axis-title--y')
          const hitbox = root.querySelector('.cahier-grouped-vertical-bar-chart__category-hitbox')
          if (!frame || !plot || !svg || !axis || bars.length === 0 || labels.length === 0 || !title || !hitbox) {
            throw new Error('Sandbox grouped-bar fixture did not mount completely')
          }
          const viewBoxWidth = svg.viewBox.baseVal.width
          const plotRect = plot.getBoundingClientRect()
          const measuredLabelWidth = Math.max(...labels.map((label) => label.getBoundingClientRect().width))
          const { labelRects, overlaps } = fixture.auditYAxisTitleTickOverlap(title, labels)
          const axisLeft = Number(axis.getAttribute('x1'))
          const axisRight = Number(axis.getAttribute('x2'))
          const railPercent = Number.parseFloat(getComputedStyle(frame).getPropertyValue('--cahier-figure-grid-left'))
          const frameRail = railPercent * viewBoxWidth / 100
          const htmlLabelRail = Number.parseFloat(labels[0].style.left) * viewBoxWidth / 100
          const bar = bars[0]
          const barX = Number(bar.getAttribute('x'))
          const barWidth = Number(bar.getAttribute('width'))
          const groupWidth = (axisRight - axisLeft) / 5
          const firstBarExpected = axisLeft + (groupWidth - barWidth) / 2
          const hitboxLeft = Number.parseFloat(hitbox.style.left) * viewBoxWidth / 100
          const hitboxWidth = Number.parseFloat(hitbox.style.width) * viewBoxWidth / 100
          hitbox.click()
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const tooltip = root.querySelector('.cahier-grouped-vertical-bar-chart__tooltip')
          const tooltipAnchor = tooltip?.style.getPropertyValue('--cahier-figure-tooltip-anchor-x') ?? ''
          return {
            viewport: innerWidth,
            titleText: title.textContent.trim(),
            labels: labelRects.map(({ text }) => text),
            measuredLabelWidth,
            renderedWidth: plotRect.width,
            viewBoxWidth,
            requiredRailWidth: (railContract.titleLane + measuredLabelWidth + railContract.labelGap) * viewBoxWidth / plotRect.width,
            frameRail,
            htmlLabelRail,
            axisLeft,
            axisRight,
            overlaps,
            barCount: bars.length,
            barX,
            firstBarExpected,
            hitboxLeft,
            hitboxWidth,
            expectedHitboxWidth: groupWidth,
            tooltipAnchor,
            expectedTooltipAnchor: `${((axisLeft + groupWidth / 2) / viewBoxWidth) * 100}%`,
          }
        } finally {
          app.unmount()
          root.remove()
        }
      }, { baseUrl, railContract })
      assert.equal(sandboxGroupedBarFigure.titleText, 'NOMBRE D’ÉTABLISSEMENTS',
        `Sandbox fixture must mount the real quantile y-axis title at ${width}px`)
      assert(sandboxGroupedBarFigure.labels.some((label) => label.replace(/\D/gu, '') === '0') &&
        sandboxGroupedBarFigure.labels.some((label) => label.replace(/\D/gu, '') === '6440') &&
        sandboxGroupedBarFigure.labels.some((label) => label.replace(/\D/gu, '') === '12881'),
      `Sandbox fixture must include Rennes-equivalent y ticks at ${width}px: ${JSON.stringify(sandboxGroupedBarFigure)}`)
      assert.deepEqual(sandboxGroupedBarFigure.overlaps, [],
        `Sandbox grouped-bar y-axis title must not intersect any tick label at ${width}px: ${JSON.stringify(sandboxGroupedBarFigure)}`)
      assert(sandboxGroupedBarFigure.frameRail >= sandboxGroupedBarFigure.requiredRailWidth - 1,
        `Sandbox frame must derive its rail from the rendered tick-label width at ${width}px: ${JSON.stringify(sandboxGroupedBarFigure)}`)
      assert(Math.abs(sandboxGroupedBarFigure.frameRail - sandboxGroupedBarFigure.axisLeft) < 0.5 &&
        Math.abs(sandboxGroupedBarFigure.htmlLabelRail - sandboxGroupedBarFigure.axisLeft) < 0.5,
      `Sandbox frame, SVG axis, and HTML labels must share one derived rail at ${width}px: ${JSON.stringify(sandboxGroupedBarFigure)}`)
      assert(Math.abs(sandboxGroupedBarFigure.barX - sandboxGroupedBarFigure.firstBarExpected) < 0.5,
        `Sandbox SVG bars must consume the same derived plot width as the axis at ${width}px: ${JSON.stringify(sandboxGroupedBarFigure)}`)
      assert(Math.abs(sandboxGroupedBarFigure.hitboxLeft - sandboxGroupedBarFigure.axisLeft) < 0.5 &&
        Math.abs(sandboxGroupedBarFigure.hitboxWidth - sandboxGroupedBarFigure.expectedHitboxWidth) < 0.5,
      `Sandbox category hitboxes must use the derived plot geometry at ${width}px: ${JSON.stringify(sandboxGroupedBarFigure)}`)
      assert(Math.abs(Number.parseFloat(sandboxGroupedBarFigure.tooltipAnchor) -
        Number.parseFloat(sandboxGroupedBarFigure.expectedTooltipAnchor)) < 0.001,
        `Sandbox tooltip must anchor to the derived category center at ${width}px: ${JSON.stringify(sandboxGroupedBarFigure)}`)
    }

    let otherCartesianFigureRails = null
    if ([320, 360, 390].includes(width)) {
      otherCartesianFigureRails = await page.evaluate(async ({ baseUrl, railContract }) => {
        const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
        const figures = [
          {
            family: 'bivariate-distribution',
            mount: fixture.mountBivariateDistributionFigure,
            frameSelector: '.bivariate-distribution-cahier',
            plotSelector: '.bivariate-distribution-plot',
            svgSelector: '.bivariate-distribution-svg',
            axisSelector: '.bivariate-grid-axis',
            labelRail: (label, width) => Number.parseFloat(label.style.left) * width / 100,
            markX: (mark) => Number(mark.getAttribute('points').split(' ')[0].split(',')[0]),
            markSelector: '.bivariate-cell-territory',
            hitboxSelector: '.bivariate-cell-hitbox',
            tooltipSelector: '.bivariate-distribution-tooltip',
          },
          {
            family: 'transport-offer-trajectory',
            mount: fixture.mountCahierOffreTransportsFigure,
            frameSelector: '.transit-plot',
            plotSelector: '.transit-plot',
            svgSelector: 'svg',
            axisSelector: '.cahier-figure-axes > line.cahier-figure-axis:nth-of-type(2)',
            labelRail: (label, width) => label.getAttribute('x') === null
              ? Number.parseFloat(label.style.left) * width / 100
              : Number(label.getAttribute('x')),
            markX: (mark) => Number(mark.getAttribute('cx')),
            markSelector: '.transit-point--territory',
          },
        ]
        const reports = []
        for (const definition of figures) {
          const root = document.createElement('div')
          root.style.cssText = `position:fixed;top:0;left:0;width:${innerWidth}px;visibility:hidden;pointer-events:none;z-index:-1`
          document.body.append(root)
          const app = await definition.mount(root)
          try {
            await document.fonts.ready
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            const frame = root.querySelector(definition.frameSelector)
            const plot = root.querySelector(definition.plotSelector)
            const svg = root.querySelector(definition.svgSelector)
            const axis = root.querySelector(definition.axisSelector)
            const marks = [...root.querySelectorAll(definition.markSelector)]
            const labels = [...root.querySelectorAll('.cahier-figure-tick-label--y, .cahier-figure-tick-label-svg--y')]
            const svgLabels = [...root.querySelectorAll('.cahier-figure-tick-label-svg--y')]
            const htmlLabels = [...root.querySelectorAll('.cahier-figure-tick-label--y')]
            const title = root.querySelector('.cahier-figure-axis-title--y')
            if (!frame || !plot || !svg || !axis || marks.length === 0 || labels.length === 0 || !title) {
              throw new Error(`${definition.family} fixture did not mount a populated titled y-axis`)
            }
            const viewBoxWidth = svg.viewBox.baseVal.width
            const plotWidth = plot.getBoundingClientRect().width
            const measuredLabelWidth = Math.max(...labels.map((label) => label.getBoundingClientRect().width))
            const { labelRects, overlaps } = fixture.auditYAxisTitleTickOverlap(title, labels)
            const axisLeft = Number(axis.getAttribute('x1'))
            const railPercent = Number.parseFloat(getComputedStyle(frame).getPropertyValue('--cahier-figure-grid-left'))
            const frameRail = railPercent * viewBoxWidth / 100
            const hitbox = definition.hitboxSelector ? root.querySelector(definition.hitboxSelector) : null
            let hitboxRail = null
            let hitboxWidth = null
            let tooltipAnchor = null
            let expectedTooltipAnchor = null
            if (hitbox) {
              hitboxRail = Number.parseFloat(hitbox.style.left) * viewBoxWidth / 100
              hitboxWidth = Number.parseFloat(hitbox.style.width) * viewBoxWidth / 100
              expectedTooltipAnchor = `${((axisLeft + hitboxWidth / 2) / viewBoxWidth) * 100}%`
              hitbox.click()
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const tooltip = root.querySelector(definition.tooltipSelector)
              tooltipAnchor = tooltip?.style.getPropertyValue('--cahier-figure-tooltip-anchor-x') ?? ''
            }
            reports.push({
              family: definition.family,
              labels: labelRects.map(({ text }) => text),
              measuredLabelWidth,
              plotWidth,
              viewBoxWidth,
              requiredRailWidth: (railContract.titleLane + measuredLabelWidth + railContract.labelGap) * viewBoxWidth / plotWidth,
              frameRail,
              axisLeft,
              labelRail: definition.labelRail(labels[0], viewBoxWidth),
              ...(definition.family === 'transport-offer-trajectory' ? {
                labelRails: {
                  svg: svgLabels.length ? Number(svgLabels[0].getAttribute('x')) : null,
                  html: htmlLabels.length
                    ? Number.parseFloat(htmlLabels[0].style.left) * viewBoxWidth / 100
                    : null,
                },
              } : {}),
              overlaps,
              markX: definition.markX(marks[0]),
              hitboxRail,
              hitboxWidth,
              tooltipAnchor,
              expectedTooltipAnchor,
            })
          } finally {
            app.unmount()
            root.remove()
          }
        }
        return reports
      }, { baseUrl, railContract })
      for (const report of otherCartesianFigureRails) {
        assert.deepEqual(report.overlaps, [],
          `${report.family} y-axis title must not intersect tick labels at ${width}px: ${JSON.stringify(report)}`)
        assert(report.frameRail >= report.requiredRailWidth - 1,
          `${report.family} frame must derive its rail from rendered tick labels at ${width}px: ${JSON.stringify(report)}`)
        assert(Math.abs(report.frameRail - report.axisLeft) < 0.5 &&
          Math.abs(report.labelRail - report.axisLeft) < 0.5 &&
          Math.abs(report.markX - report.axisLeft) < 0.5,
        `${report.family} frame, SVG axis, y labels, and plotted marks must share the derived rail at ${width}px: ${JSON.stringify(report)}`)
        if (report.family === 'transport-offer-trajectory') {
          assert.notEqual(report.labelRails.html, null,
            `Transport-offer fixture must render HTML y-tick labels at ${width}px: ${JSON.stringify(report)}`)
          for (const [representation, labelRail] of Object.entries(report.labelRails)) {
            if (labelRail === null) continue
            assert(Math.abs(labelRail - report.axisLeft) < 0.5 &&
              Math.abs(labelRail - report.frameRail) < 0.5,
            `${report.family} first ${representation} y-tick label must share the frame and SVG axis rail at ${width}px: ${JSON.stringify(report)}`)
          }
        }
        if (report.hitboxRail !== null) {
          assert(Math.abs(report.hitboxRail - report.axisLeft) < 0.5 && report.hitboxWidth > 0,
            `${report.family} hitboxes must share derived plot geometry at ${width}px: ${JSON.stringify(report)}`)
          assert(Math.abs(Number.parseFloat(report.tooltipAnchor) -
            Number.parseFloat(report.expectedTooltipAnchor)) < 0.001,
            `${report.family} tooltip must anchor to derived plotted geometry at ${width}px: ${JSON.stringify(report)}`)
        }
      }
    }

    let mobileIndexInteraction = null
    if (width <= 760) {
      const mobileIndex = page.locator('.mobile-index')
      const summary = mobileIndex.locator('summary')
      assert(await summary.isVisible(), `Mobile Cahier index must be visible at ${width}px`)
      assert.equal(await mobileIndex.evaluate((element) => element.open), false,
        `Mobile index should begin collapsed at ${width}px`)
      await summary.click()
      assert.equal(await mobileIndex.evaluate((element) => element.open), true,
        `Tapping the mobile index should open it at ${width}px`)
      assert(await mobileIndex.locator('nav').isVisible(), `Opened mobile index links should be visible at ${width}px`)
      await summary.click()
      assert.equal(await mobileIndex.evaluate((element) => element.open), false,
        `Tapping the mobile index again should close it at ${width}px`)
      mobileIndexInteraction = { control: 'Sommaire du cahier', opened: true, closedAgain: true }
    }

    assert.equal(readCalls.mobilityFacts, 1,
      `Expected exactly one theme-facts fixture request at ${width}px; got ${readCalls.mobilityFacts}. The theme-facts route may not have been requested or matched.`)
    const chunk = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
      values.slice(index * size, (index + 1) * size))
    const coreProjections = chunk(AEDAR_CORE_MEASURE_KEYS, 32)
    const detailProjections = chunk(AEDAR_EXPLORER_DETAIL_MEASURE_KEYS, 32)
    const expectedAedarBatches = coreProjections.length + detailProjections.length
    assert.equal(readCalls.aedarBatches, expectedAedarBatches,
      `Expected ${expectedAedarBatches} semantic read-batch POSTs for the current core/detail field projections at ${width}px; got ${readCalls.aedarBatches}.`)
    const expectedTypequPartitions = chunk(AEDAR_TYPEQU_REGISTRY.map(({ code }) => code), 100)
    const expectedAedarItems = coreProjections.length * expectedTypequPartitions.length + detailProjections.length
    assert.equal(readCalls.aedarItems.length, expectedAedarItems,
      `Expected ${expectedAedarItems} AEDAR resource items across the core universe and explorer projections at ${width}px; got ${readCalls.aedarItems.length}.`)
    const expectedProjections = [
      ...coreProjections.map((keys) => ({ fields: keys.map((key) => `measures.${key}`), partitions: expectedTypequPartitions })),
      ...detailProjections.map((keys) => ({
        fields: keys.map((key) => `measures.${key}`),
        partitions: [[AEDAR_EQUIPMENT_EXPLORER_INITIAL_TYPEQU]],
      })),
    ]
    for (const projection of expectedProjections) {
      const items = readCalls.aedarItems.filter((item) => JSON.stringify(item.fields) === JSON.stringify(projection.fields))
      assert.equal(items.length, projection.partitions.length,
        `Unexpected TYPEQU partition count for AEDAR projection at ${width}px: ${JSON.stringify(projection.fields)}`)
      for (const [index, item] of items.entries()) {
        assert.equal(item.id, `aedar-${index}`, `Unexpected AEDAR item id at ${width}px, projection index ${index}`)
        assert.equal(item.resource, 'aedar_territorial_aggregate', `Unexpected AEDAR resource at ${width}px, item ${index}`)
        assert.deepEqual(item.target, { kind: 'territory', type: 'commune', id: '35238' },
          `Unexpected AEDAR target at ${width}px, item ${index}`)
        assert.deepEqual(item.typequ, projection.partitions[index],
          `AEDAR TYPEQU range mismatch at ${width}px, item ${index}; fixture must cover the registered codes in producer order.`)
      }
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
      const explorerFigureRects = [...cahier.querySelectorAll(
        '.aedar-equipment-explorer-figures > .aedar-equipment-explorer-figure',
      )].map((figure) => {
        const { x, y, right, bottom, width, height } = figure.getBoundingClientRect()
        return { x, y, right, bottom, width, height }
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
        explorerFigureRects,
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
    assert.equal(metrics.explorerFigureRects.length, 2,
      `Expected both Bac à sable figures at ${width}px: ${JSON.stringify(metrics.explorerFigureRects)}`)
    const [volumeFigure, quantileFigure] = metrics.explorerFigureRects
    if (width <= 760) {
      assert(quantileFigure.y >= volumeFigure.bottom - 1,
        `Bac à sable volume and quantile figures should stack on mobile at ${width}px: ${JSON.stringify(metrics.explorerFigureRects)}`)
    } else {
      assert(Math.abs(quantileFigure.y - volumeFigure.y) <= 1 && quantileFigure.x >= volumeFigure.right - 1,
        `Bac à sable figures should remain side-by-side on desktop at ${width}px: ${JSON.stringify(metrics.explorerFigureRects)}`)
    }
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

    if ([320, 360, 390, 601, 760, 761, 1440, 1800].includes(width)) {
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

    let plainMarginLayout = null
    if (width === 601 || width === 760) {
      await page.evaluate(() => {
        const app = document.querySelector('#app')
        if (!app) throw new Error('Production app root must exist before mounting the plain Cahier fixture')
        app.style.display = 'none'
        const root = document.createElement('div')
        root.id = 'plain-cahier-layout-fixture'
        root.style.marginInline = 'var(--grid-margin-mobile)'
        document.body.append(root)
      })
      await page.evaluate(async ({ baseUrl, content, pagination }) => {
        const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
        const root = document.querySelector('#plain-cahier-layout-fixture')
        if (!root) throw new Error('Plain Cahier fixture root was not mounted')
        await fixture.mountPlainCahier(root, content, pagination)
      }, { baseUrl, content: plainContent, pagination: plainPagination })
      plainMarginLayout = await page.evaluate(() => {
        const fixture = document.querySelector('#plain-cahier-layout-fixture')
        const page = fixture?.querySelector('.cahier-page')
        const main = page?.querySelector('.page-main')
        const heading = page?.querySelector('.page-heading')
        const margin = page?.querySelector('.page-margin')
        if (!page || !main || !heading || !margin) throw new Error('Plain, non-indexed Cahier margin markup is incomplete')
        const bounds = (element) => {
          const { x, y, right, bottom, width, height } = element.getBoundingClientRect()
          return { x, y, right, bottom, width, height }
        }
        return {
          viewport: innerWidth,
          paper: bounds(page),
          heading: bounds(heading),
          pageMain: bounds(main),
          margin: bounds(margin),
          marginPosition: getComputedStyle(margin).position,
        }
      })
      assert.equal(plainMarginLayout.viewport, width)
      assert(plainMarginLayout.paper.x >= -1 && plainMarginLayout.paper.right <= width + 1,
        `Non-indexed plain Cahier paper should fit at ${width}px: ${JSON.stringify(plainMarginLayout)}`)
      assert.equal(plainMarginLayout.marginPosition, 'static',
        `Plain Cahier metadata should participate in flow at ${width}px: ${JSON.stringify(plainMarginLayout)}`)
      assert(plainMarginLayout.margin.y >= plainMarginLayout.pageMain.bottom - 1,
        `Plain Cahier margin must follow, not overlap, page content at ${width}px: ${JSON.stringify(plainMarginLayout)}`)
      assert(plainMarginLayout.margin.y >= plainMarginLayout.heading.bottom,
        `Plain Cahier margin must not collide with its heading at ${width}px: ${JSON.stringify(plainMarginLayout)}`)
    }

    reports.push({
      width,
      ...metrics,
      w3: w3Summary,
      mobileIndexInteraction,
      longYAxisFigure,
      accessRampLongYAxisFigure,
      accessRampRampYAxisFigure,
      sandboxGroupedBarFigure,
      otherCartesianFigureRails,
      plainMarginLayout,
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
