import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { installApiRoutes, makeApiHandlers } from './overflow-api-routes.mjs'

// Real-browser, populated contract check for Cahier mobile overflow and the
// shared y-axis rail regression in issue #841 and W3 labels in issue #829.
// #868 : the fiche bootstraps from the territory reference and reads the active
// theme through the semantic API (GET /api/resources + POST /api/resources/read-batch)
// — both intercepted here with the same fixture builders/contracts used by the app
// tests; any other API traffic fails closed (HTTP 599), so nothing reaches Vite's
// public API proxy. The retired per-theme facts routes are likewise fail-closed.
// #900 : the committed read-model artifacts are retired — the static plain-Cahier
// content check is built from the suite's current native fixtures
// (src/payload/fixtures.ts), never from a published model file.
// Run: npm run verify:mobile-cahier-overflow. If Playwright has no cached
// browser, run `npx playwright-core install chromium`; alternatively set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE to an installed Chromium executable.
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
  return relativeLuminanceFromChannels(rgbChannels(color))
}

function relativeLuminanceFromChannels(channels) {
  const [red, green, blue] = channels.map((channel) => {
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

function contrastRatioFromChannels(foreground, background) {
  const ink = relativeLuminanceFromChannels(foreground)
  const fill = relativeLuminanceFromChannels(background)
  return (Math.max(ink, fill) + 0.05) / (Math.min(ink, fill) + 0.05)
}

function compositeChannels(color, backdrop, opacity) {
  const foregroundChannels = rgbChannels(color)
  const backdropChannels = rgbChannels(backdrop)
  return foregroundChannels.map((channel, index) =>
    channel * opacity + backdropChannels[index] * (1 - opacity))
}

async function verifyCartographicMapChipContrast(page) {
  const readRenderedLabels = () => page.evaluate(() => {
    const parseAlpha = (color) => {
      const values = color.match(/[\d.]+/gu)?.map(Number) ?? []
      if (color.startsWith('color(srgb')) return color.includes('/') ? values[3] ?? 1 : 1
      return color.startsWith('rgba') ? values[3] ?? 1 : 1
    }
    const backdropFor = (panel) => {
      for (let ancestor = panel.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const background = getComputedStyle(ancestor).backgroundColor
        if (parseAlpha(background) >= 0.999) return background
      }
      return 'rgb(255, 255, 255)'
    }

    return [...document.querySelectorAll('.map-breakout--c .map-panel')].map((panel) => {
      const mode = ['car', 'walk', 'bike'].find((key) => panel.classList.contains(`map-panel--${key}`))
      const label = panel.querySelector('.map-panel-label')
      const viewport = panel.querySelector('.map-viewport')
      if (!mode || !label || !viewport) throw new Error('Cartographic map panel is missing its mode, label, or viewport')
      let effectiveOpacity = 1
      const dimmedAncestors = []
      for (let ancestor = label; ancestor; ancestor = ancestor.parentElement) {
        const opacity = Number.parseFloat(getComputedStyle(ancestor).opacity)
        effectiveOpacity *= opacity
        if (opacity < 0.999) {
          dimmedAncestors.push({
            tagName: ancestor.tagName,
            classes: typeof ancestor.className === 'string' ? ancestor.className : '',
            opacity,
          })
        }
      }
      const style = getComputedStyle(label)
      return {
        mode,
        active: panel.classList.contains('map-panel--active'),
        panelDimmed: panel.classList.contains('map-panel--dimmed'),
        viewportOpacity: Number.parseFloat(getComputedStyle(viewport).opacity),
        foreground: style.color,
        fill: style.backgroundColor,
        backdrop: backdropFor(panel),
        effectiveOpacity,
        dimmedAncestors,
      }
    })
  })

  const measure = async (activatedBy, activeMode) => {
    await page.waitForTimeout(200)
    const rawLabels = await readRenderedLabels()
    const labels = rawLabels.map((label) => {
      const effectiveForeground = compositeChannels(label.foreground, label.backdrop, label.effectiveOpacity)
      const effectiveFill = compositeChannels(label.fill, label.backdrop, label.effectiveOpacity)
      return {
        ...label,
        effectiveForeground,
        effectiveFill,
        effectiveContrast: contrastRatioFromChannels(effectiveForeground, effectiveFill),
      }
    })
    assert.deepEqual(labels.map(({ mode }) => mode).sort(), ['bike', 'car', 'walk'],
      `${activatedBy} must measure all three cartographic map-title chips`)
    assert.equal(labels.filter(({ active }) => active).length, 1,
      `${activatedBy} must make exactly one cartographic map panel active`)
    for (const label of labels) {
      assert.equal(label.active, label.mode === activeMode,
        `${activatedBy} must activate ${activeMode}, got ${JSON.stringify(label)}`)
      assert(label.effectiveContrast >= 4.5,
        `${activatedBy} must preserve effective 4.5:1 contrast for the ${label.mode} map chip after ancestor compositing: ${JSON.stringify(label)}`)
      assert.equal(label.effectiveOpacity, 1,
        `${activatedBy} must leave the ${label.mode} label fully opaque after ancestor compositing: ${JSON.stringify(label)}`)
      assert.deepEqual(label.dimmedAncestors, [],
        `${activatedBy} must not dim the ${label.mode} label through an opacity ancestor: ${JSON.stringify(label)}`)
      if (label.mode === activeMode) {
        assert.equal(label.panelDimmed, false, `${activatedBy} active ${label.mode} panel must not be marked dimmed`)
        assert.equal(label.viewportOpacity, 1, `${activatedBy} active ${label.mode} map visual must remain fully opaque`)
      } else {
        assert.equal(label.panelDimmed, true, `${activatedBy} inactive ${label.mode} panel must remain de-emphasized`)
        assert(Math.abs(label.viewportOpacity - 0.46) < 0.01,
          `${activatedBy} inactive ${label.mode} map visual must retain its dimmed opacity: ${JSON.stringify(label)}`)
      }
    }
    return { activeMode, labels }
  }

  await page.locator('.map-breakout--c .map-panel--car').hover()
  await page.waitForFunction(() =>
    document.querySelector('.map-breakout--c .map-panel--car')?.classList.contains('map-panel--active'))
  const pointerHover = await measure('pointer hover', 'car')

  const keyboardTarget = page.locator('.map-breakout--c .map-panel--walk .map-viewport')
  await page.keyboard.press('Tab')
  await keyboardTarget.focus()
  assert.equal(await keyboardTarget.evaluate((button) =>
    document.activeElement === button && button.matches(':focus-visible')), true,
  'Keyboard navigation must visibly focus the walking map button')
  const keyboardPanelState = await page.evaluate(() =>
    [...document.querySelectorAll('.map-breakout--c .map-panel')].map((panel) => panel.className))
  assert(keyboardPanelState.some((classes) => classes.includes('map-panel--walk') && classes.includes('map-panel--active')),
    `Keyboard focus must activate the walking map panel: ${JSON.stringify(keyboardPanelState)}`)
  const keyboardFocus = await measure('keyboard focus', 'walk')

  return { pointerHover, keyboardFocus }
}

async function verifyWaffleLegendInteraction(page) {
  const action = page.locator('.cahier-figure-legend-action--chip').first()
  const readActionState = () => action.evaluate((button) => {
    const style = getComputedStyle(button)
    const icon = button.querySelector('svg')
    return {
      foreground: style.color,
      fill: style.backgroundColor,
      icon: icon ? getComputedStyle(icon).color : null,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      borderColor: style.borderColor,
      transform: style.transform,
      focusVisible: button.matches(':focus-visible'),
    }
  })
  const expectContrast = (state, name) => {
    assert(contrastRatio(state.foreground, state.fill) >= 4.5,
      `Waffle ${name} foreground must retain 4.5:1 contrast: ${JSON.stringify(state)}`)
    if (state.icon) assert(contrastRatio(state.icon, state.fill) >= 4.5,
      `Waffle ${name} icon must retain 4.5:1 contrast: ${JSON.stringify(state)}`)
  }

  const normal = await readActionState()
  expectContrast(normal, 'resting')
  await action.hover()
  const hover = await readActionState()
  assert.equal(hover.fill, normal.fill, 'Waffle hover must preserve the contrast-safe chip fill')
  assert.equal(hover.foreground, normal.foreground, 'Waffle hover must preserve the contrast-safe chip ink')
  assert.equal(hover.outlineStyle, 'solid', 'Waffle chip hover must add a visible outline')
  assert.equal(hover.outlineWidth, '2px', 'Waffle chip hover must use the visible 2px affordance')
  assert.equal(hover.outlineColor, hover.foreground, 'Waffle chip hover outline must use its contrast-safe ink')
  assert.notDeepEqual(
    [hover.outlineStyle, hover.outlineWidth, hover.outlineColor],
    [normal.outlineStyle, normal.outlineWidth, normal.outlineColor],
    'Waffle chip hover must look visibly different from its resting state',
  )
  expectContrast(hover, 'hover')

  const actionBox = await action.boundingBox()
  assert(actionBox, 'Waffle legend action must have a hit target for its active-state check')
  await page.mouse.move(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2)
  await page.mouse.down()
  const active = await readActionState()
  assert.equal(active.fill, normal.fill, 'Waffle active state must preserve the contrast-safe chip fill')
  assert.equal(active.foreground, normal.foreground, 'Waffle active state must preserve the contrast-safe chip ink')
  assert.equal(active.borderColor, active.foreground, 'Waffle active state must add a contrast-safe border')
  assert.notEqual(active.transform, 'none', 'Waffle chip active state must visibly compress the chip')
  expectContrast(active, 'active')
  await page.mouse.up()

  const openedDialog = page.locator('dialog[open]')
  await openedDialog.waitFor({ state: 'visible' })
  assert.equal(await openedDialog.getAttribute('aria-modal'), 'true',
    'Activating a Waffle legend chip must preserve modal dialog semantics')
  await page.keyboard.press('Escape')
  await openedDialog.waitFor({ state: 'hidden' })

  await page.locator('.aedar-waffle-tile').last().focus()
  await page.keyboard.press('Tab')
  assert.equal(await action.evaluate((button) => button.matches(':focus-visible')), true,
    'Keyboard navigation must give the Waffle legend chip visible focus')
  const focused = await readActionState()
  assert.equal(focused.outlineStyle, 'solid', 'Waffle chip focus must retain a visible outline')
  assert.equal(focused.outlineWidth, '2px', 'Waffle chip focus ring must remain 2px wide')
  assert.notEqual(focused.outlineColor, 'rgba(0, 0, 0, 0)',
    'Waffle chip focus ring must use a visible color')
  expectContrast(focused, 'focused')

  const keyboardTile = page.locator('.aedar-waffle-tile').last()
  await page.keyboard.press('Shift+Tab')
  const focusedTile = await keyboardTile.evaluate((button) => {
    const style = getComputedStyle(button)
    const { width, height } = button.getBoundingClientRect()
    return {
      active: document.activeElement === button,
      focusVisible: button.matches(':focus-visible'),
      width,
      height,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      name: button.getAttribute('aria-label')?.trim() ?? '',
    }
  })
  assert.equal(focusedTile.active, true, 'Keyboard reverse navigation must return focus to the Waffle tile')
  assert.equal(focusedTile.focusVisible, true, 'The focused Waffle tile must expose keyboard-visible focus')
  assert.equal(focusedTile.outlineStyle, 'solid', 'Waffle tile focus must retain a visible outline')
  assert.equal(focusedTile.outlineWidth, '2px', 'Waffle tile focus outline must remain 2px wide')
  assert.notEqual(focusedTile.outlineColor, 'rgba(0, 0, 0, 0)',
    'Waffle tile focus outline must use a visible color')
  assert.equal(focusedTile.width, 14, 'The focused mobile Waffle tile hit box must stay exactly 14px wide')
  assert.equal(focusedTile.height, 14, 'The focused mobile Waffle tile hit box must stay exactly 14px high')
  assert(focusedTile.name.length > 0, 'The focused Waffle tile must retain its accessible name')
  await page.keyboard.press('Enter')
  const tileDialog = page.locator('dialog[open]')
  await tileDialog.waitFor({ state: 'visible' })
  assert.equal(await tileDialog.getAttribute('aria-modal'), 'true',
    'Keyboard activation of a Waffle tile must open the accessible modal detail')
  await page.keyboard.press('Escape')
  await tileDialog.waitFor({ state: 'hidden' })

  return {
    normal,
    hover,
    active,
    focused,
    focusedTile,
    dialogOpened: true,
    dialogDismissedWithEscape: true,
    tileKeyboardActivation: true,
  }
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
  const {
    territoiresFixture,
    indicateursMobiliteFixture,
    histoiresMobiliteFixture,
    vintagesFixture,
    metadonneesThemesFixtures,
  } = await server.ssrLoadModule('/src/payload/fixtures.ts')
  const { territoryFactsFor } = await server.ssrLoadModule('/src/fiche/content/territoryFacts.ts')
  const { resolveMobiliteThemeContent } = await server.ssrLoadModule('/src/fiche/content/themeContent.ts')
  const { cahierPaginationFor } = await server.ssrLoadModule('/src/fiche/prototype/cahierPagination.ts')
  // #868 : les faits du thème actif passent par /api/resources/read-batch (contrat sémantique),
  // servis ici par les fixtures natives du suite (semanticApiFixtures).
  const { nativeBatchResponse, nativeReadFixture, nativeCatalogueResponse, nativePublicationFamily } =
    await server.ssrLoadModule('/src/__tests__/helpers/semanticApiFixtures.ts')
  const cataloguePayload = await (await nativeCatalogueResponse()).json()
  const catalogueResources = cataloguePayload.resources
  const resourceKind = (resourceId) =>
    catalogueResources.find((resource) => resource.resource_id === resourceId)?.resource_kind ?? null
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
  // #900 : plus d'artefact commité — le contrôle de mise en page « plain Cahier »
  // s'appuie sur les fixtures natives courantes (payload/fixtures.ts), exactement
  // comme les specs navigateur ; le contrôle d'overflow indépendant est conservé.
  const plainPayload = {
    territoires: territoiresFixture,
    indicateurs: indicateursMobiliteFixture,
    histoires: histoiresMobiliteFixture,
    runReport: null,
    vintages: vintagesFixture,
    programmes: null,
    themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
  }
  const plainFacts = territoryFactsFor(plainPayload, '22001')
  assert(plainFacts, 'Native fixture payload must resolve Mobilité facts for the plain Cahier check')
  const plainContent = resolveMobiliteThemeContent(plainFacts, plainPayload.themeMetadata?.mobilite)
  const plainPagination = cahierPaginationFor(plainPayload, plainContent, true)
  // Le scénario navigateur 35238 démarre avec le référentiel d’identités conservé,
  // distinct des fixtures plain ci-dessus. Aucun modèle numérique retiré requis.
  const territoryReference = JSON.parse(await readFile(
    resolve(repoRoot, 'public/data/territoires.json'), 'utf8',
  ))
  // Fixture read-batch pour les lectures non-AEDAR (thème Mobilité) : contrat sémantique,
  // jamais l'ancienne route theme-facts retirée.
  // #974 — the page-2 review captures use the same coherent live network
  // capture as the production page-2 spec, so the segmented cycling bar and its
  // four-entry legend are drawn from a real partition rather than a synthetic one.
  const liveNetworksModule = await server.ssrLoadModule(
    '/src/__tests__/fixtures/rennes-network-live.json')
  const liveNetworks = liveNetworksModule.default ?? liveNetworksModule
  const liveNetworkCapture = {
    reseaux_par_habitant: liveNetworks.reseauxParHabitant,
    reseaux: liveNetworks.reseaux,
    offre_cyclable: liveNetworks.offreCyclable,
  }
  function themeBatchResponse(request) {
    return nativeBatchResponse(request.items, (item, resource) => {
      const data = nativeReadFixture(item, resource, { syntheticProfileComparisons: true })
      if (item.intent?.kind === 'facts' && item.resource === 'offre_tc') {
        // Exercise the high-coverage fill-aware label legibility at both widths.
        data.value = 0.9957355031616097
        data.status = 'measured'
      }
      const capture = liveNetworkCapture[item.resource]
      if (item.intent?.kind === 'facts' && capture && Array.isArray(data.observations)) {
        for (const observation of data.observations) {
          const value = capture[observation.detail]
          if (typeof value === 'number') observation.value = value
        }
      }
      return data
    })
  }
  const fixtureAttribution = 'Synthetic browser fixture; not published AEDAR facts'
  const aedarAggregateDeclaration = catalogueResources
    .find((resource) => resource.resource_id === 'aedar_territorial_aggregate')
  assert(aedarAggregateDeclaration?.measure_facets, 'AEDAR aggregate declaration must publish measure facets')
  const aedarSummaryDeclaration = catalogueResources
    .find((resource) => resource.resource_id === 'aedar_territory_summary')
  assert(aedarSummaryDeclaration?.measure_facets, 'AEDAR summary declaration must publish measure facets')
  const aedarMeasureKeys = Object.keys(aedarSummaryDeclaration.measure_facets)
  const aedarContentVersion = 'fixture-955-aedar-v2'
  const aedarReferenceVersion = 'fixture-823-territories-v1'
  const aedarSummaryVersion = 'fixture-955-aedar-summary-v1'
  await mkdir(evidenceDir, { recursive: true })

  function aedarSummaryReading(measure) {
    return {
      measure,
      value: 0.5,
      status: 'available',
      n_typequ: 235,
      n_addresses: 100,
      n_observed: 100,
      coverage_status: 'covered',
      statistic: 'direct',
      source_id: aedarContract.source_id,
      vintage_id: '2026-v1',
      source_url: 'https://example.test/aedar-fixture',
      licence: 'Licence Ouverte 2.0',
      attribution: fixtureAttribution,
      reference_date: '2026-01-01',
      publication_date: '2026-10-22',
    }
  }

  function aedarAggregateComparison(item) {
    const selected = item.intent.kind === 'selected_comparison'
    const members = selected
      ? item.intent.members.map((member) => ({ type: member.type, id: member.id }))
      : null
    const rows = item.coordinates.measure.map((measure) => ({
      typequ: null,
      measure,
      comparison_context: selected ? 'selected_comparison' : item.intent.context,
      statistic: selected ? 'pooled' : 'direct',
      group_value: 0.5,
      group_n_addresses: 100,
      group_n_observed: 100,
      group_coverage_status: 'covered',
      direction: aedarAggregateDeclaration.measure_facets[measure].direction,
      source_id: aedarContract.source_id,
      vintage_id: '2026-v1',
      reference_date: '2026-01-01',
      publication_date: '2026-10-22',
      rank: null,
      rank_size: null,
      rank_ties: null,
    }))
    return {
      resource: item.resource,
      target: item.target,
      content_version: aedarContentVersion,
      aedar_content_version: aedarContentVersion,
      reference_content_version: aedarReferenceVersion,
      summary_content_version: aedarSummaryVersion,
      ...(selected
        ? {
          comparisons: rows,
          scope: { kind: 'explicit_selection', member_count: members.length },
          selection: members,
        }
        : { comparison: rows[0] }),
    }
  }

  function aedarBatchResponse(request) {
    if (!Array.isArray(request.items)) {
      return { contract: 'semantic-read-batch-v2', results: [] }
    }
    return {
      contract: 'semantic-read-batch-v2',
      results: request.items.map((item) => {
        if (item.resource === 'aedar_territory_summary') {
          return {
            id: item.id,
            data: {
              resource: item.resource,
              target: item.target,
              territory: { territory_type: item.target.type, territory_id: item.target.id },
              summary_content_version: aedarSummaryVersion,
              aedar_content_version: aedarContentVersion,
              reference_content_version: aedarReferenceVersion,
              readings: aedarMeasureKeys.map(aedarSummaryReading),
            },
          }
        }
        if (item.resource === 'aedar_territorial_aggregate' &&
            Array.isArray(item.coordinates?.measure) && !Array.isArray(item.coordinates?.typequ)) {
          return { id: item.id, data: aedarAggregateComparison(item) }
        }
        return {
          id: item.id,
          data: {
            resource: item.resource,
            target: item.target,
            territory: { territory_type: item.target.type, territory_id: item.target.id },
            content_version: aedarContentVersion,
            reference_content_version: aedarReferenceVersion,
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
        }
      }),
    }
  }

  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const reports = []
  for (const width of [320, 360, 390, 601, 760, 761, 1440, 1800]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 })
    const readCalls = { retiredThemeFactsRoutes: 0, themeBatches: 0, aedarBatches: 0,
      aedarSummaryBatches: 0, aedarSummaryTargets: [], aedarComparisonBatches: 0, aedarItems: [] }
    page.on('pageerror', (error) => console.error(`[browser pageerror ${width}px]`, error))
    // #868 : câblage RÉEL partagé avec le contrôle sans navigateur — installApiRoutes
    // enregistre la table DANS L'ORDRE (catch-all fail-closed 599 en premier,
    // Playwright dernier-enregistré-gagne) via makeApiHandlers. verify-overflow-api-routes.mjs
    // pilote ces mêmes handlers installés sur un faux page.
    await installApiRoutes(page, makeApiHandlers({
      catalogue: () => nativeCatalogueResponse(),
      resourceKind,
      themeBatch: themeBatchResponse,
      aedarBatch: aedarBatchResponse,
      readCalls,
    }))
    await page.goto(`${baseUrl}territoire/commune/35238?theme=mobilite`, { waitUntil: 'networkidle' })
    try {
      await page.locator('#section-aedar-car-overview').waitFor({ state: 'visible', timeout: 10000 })
    } catch (error) {
      console.error(`[browser body ${width}px]`, (await page.locator('body').innerText()).slice(0, 2000))
      throw error
    }
    await page.locator('#section-aedar-equipment-explorer').waitFor({ state: 'visible' })

    // #860 : chemin Mobilité de production, pas un montage du contrôle isolé.
    const trigger = page.locator('.page-heading .bouton-comparaison__declencheur').first()
    assert(await trigger.isVisible(), `Comparaison absent du Cahier de production à ${width}px`)
    const heading = await trigger.evaluate((button) => {
      const root = button.closest('.bouton-comparaison')
      const heading = button.closest('.page-heading')
      const theme = heading.querySelector('.page-heading-theme')
      const title = heading.querySelector('.page-heading-context-title')
      const context = heading.querySelector('.page-heading-context')
      const style = getComputedStyle(button)
      const separation = theme.getBoundingClientRect().left - button.getBoundingClientRect().right
      const titleBox = title.getBoundingClientRect()
      const comparisonBox = button.getBoundingClientRect()
      const builderBox = heading.querySelector('.page-heading-builder-trigger').getBoundingClientRect()
      const withButton = heading.getBoundingClientRect().height
      root.style.display = 'none'
      const withoutButton = heading.getBoundingClientRect().height
      root.style.removeProperty('display')
      const builderStyle = getComputedStyle(heading.querySelector('.page-heading-builder-trigger'))
      return { withButton, withoutButton, separation, border: style.borderLeftWidth, radius: style.borderRadius,
        builderBorder: builderStyle.borderLeftWidth, titleAlign: getComputedStyle(title).textAlign,
        titleRight: titleBox.right, contextRight: context.getBoundingClientRect().right,
        centerDelta: Math.max(Math.abs((titleBox.top + titleBox.bottom) / 2 - (comparisonBox.top + comparisonBox.bottom) / 2),
          Math.abs((titleBox.top + titleBox.bottom) / 2 - (builderBox.top + builderBox.bottom) / 2)) }
    })
    assert(heading.withButton <= heading.withoutButton + 1,
      `Les contrôles agrandissent le heading à ${width}px : ${JSON.stringify(heading)}`)
    assert(heading.separation >= 12 && heading.border === '0px' && heading.radius === '0px' &&
      heading.builderBorder === '0px' && heading.titleAlign === 'right' && Math.abs(heading.titleRight - heading.contextRight) < 1,
      `Contrôles sans cadre, séparés du titre aligné à droite à ${width}px : ${JSON.stringify(heading)}`)
    assert(heading.centerDelta < 3, `Contrôles et titre doivent partager leur centre vertical à ${width}px : ${JSON.stringify(heading)}`)
    await trigger.click()
    const menuBounds = await page.locator('.bouton-comparaison__menu').evaluate((element) => {
      const { left, right } = element.getBoundingClientRect()
      return { left, right, viewport: innerWidth }
    })
    assert(menuBounds.left >= 0 && menuBounds.right <= menuBounds.viewport,
      `Menu hors du viewport à ${width}px : ${JSON.stringify(menuBounds)}`)
    // Fixture de géométrie : une portée longue et un mot insécable doivent se
    // composer, pas être masqués. Une boîte de span peut tenir même si son texte
    // déborde (héritage nowrap du heading, régression de la première passe).
    await page.locator('.bouton-comparaison__option-scope').first().evaluate((element) => {
      element.textContent = `communes d’une communauté de communes au nom particulièrement long ${'Territoire'.repeat(8)}`
    })
    const options = page.locator('.bouton-comparaison__menu [role="menuitemradio"]')
    for (const option of await options.all()) {
      await option.hover()
      const geometry = await option.evaluate((element) => {
        const panel = element.closest('.bouton-comparaison__menu')
        const menu = panel.getBoundingClientRect()
        const style = getComputedStyle(panel)
        const contained = [element, ...element.querySelectorAll('span')].every((node) => {
          const rect = node.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(node)
          const textRects = [...range.getClientRects()]
          return !rect.width || ([rect, ...textRects].every((box) =>
            box.left >= menu.left + 1 && box.right <= menu.right - 1
            && box.top >= menu.top + 1 && box.bottom <= menu.bottom - 1)
            && node.scrollWidth <= node.clientWidth + 1)
        })
        const range = document.createRange()
        range.selectNodeContents(panel)
        const rects = [...range.getClientRects()].filter((rect) => rect.width)
        return {
          panel: { width: menu.width, left: menu.left, right: menu.right, height: menu.height,
            clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth,
            clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight,
            padding: style.padding, border: style.borderWidth, whiteSpace: style.whiteSpace },
          contents: { left: Math.min(...rects.map((rect) => rect.left)),
            right: Math.max(...rects.map((rect) => rect.right)) },
          contained: contained && panel.scrollWidth <= panel.clientWidth && panel.scrollHeight <= panel.clientHeight,
        }
      })
      assert(geometry.contained, `Contenu hors du panneau à ${width}px : ${JSON.stringify(geometry)}`)
      if (width === 390 || width === 1440) console.log(`Panneau ${width}px : ${JSON.stringify(geometry)}`)
    }
    await trigger.press('Escape')
    const marks = await page.locator('#section-aedar-car-overview .cahier-comparison-value').evaluateAll((elements) =>
      elements.map((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        text: element.textContent.trim(),
        overflow: element.scrollWidth > element.clientWidth + 1,
      })))
    assert.equal(marks.length, 2, 'Les deux scalaires AEDAR doivent porter leur référence')
    for (const mark of marks) {
      assert(mark.width >= 80 && mark.height < 160 && !mark.overflow,
        `Marque de pair réduite à une colonne de caractères à ${width}px : ${JSON.stringify(mark)}`)
    }
    console.log(`Comparaison ${width}px: ${JSON.stringify({ heading, marks })}`)

    const w3Visual = await page.evaluate(() => {
      const waffle = document.querySelector('.aedar-waffle')
      const grid = waffle?.querySelector('.aedar-waffle-grid')
      const tiles = [...(grid?.querySelectorAll('.aedar-waffle-tile') ?? [])]
      const legend = [...(waffle?.querySelectorAll('.cahier-figure-legend-action') ?? [])]
      const box = (element) => {
        const { x, y, right, bottom, width, height } = element.getBoundingClientRect()
        return { x, y, right, bottom, width, height, center: x + width / 2 }
      }
      const gridBox = grid ? box(grid) : null
      const waffleBox = waffle ? box(waffle) : null
      const tileBoxes = tiles.map(box)
      const tileSemantics = tiles.map((tile) => ({
        tagName: tile.tagName,
        name: tile.getAttribute('aria-label')?.trim() ?? '',
      }))
      const tileVisuals = tiles.map((tile) => {
        const style = getComputedStyle(tile)
        const paint = getComputedStyle(tile, '::before')
        const target = box(tile)
        return {
          width: target.width,
          height: target.height,
          fill: style.backgroundColor,
          pseudoContent: paint.content,
        }
      })
      const gridStyle = grid ? getComputedStyle(grid) : null
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
            const panelBounds = box(parent)
            const icon = label.querySelector('svg')
            const text = label.querySelector('span')
            const iconBounds = icon ? box(icon) : null
            const textBounds = text ? box(text) : null
            const probe = document.createElement('span')
            probe.style.color = 'var(--mode-ring)'
            probe.style.font = 'var(--text-overline)'
            probe.style.letterSpacing = 'var(--text-overline-tracking)'
            probe.style.textTransform = 'uppercase'
            probe.style.background = 'transparent'
            probe.style.padding = '0'
            probe.style.margin = '0 0 6px'
            probe.style.minHeight = '28px'
            probe.style.gap = '6px'
            probe.style.borderRadius = '0'
            parent.append(probe)
            const modeFill = getComputedStyle(probe).color
            const reference = getComputedStyle(probe)
            const originalMapTitle = {
              fontFamily: reference.fontFamily,
              fontSize: reference.fontSize,
              fontWeight: reference.fontWeight,
              lineHeight: reference.lineHeight,
              letterSpacing: reference.letterSpacing,
              textTransform: reference.textTransform,
              backgroundColor: reference.backgroundColor,
              backgroundImage: reference.backgroundImage,
              padding: [reference.paddingTop, reference.paddingRight, reference.paddingBottom, reference.paddingLeft],
              margin: [reference.marginTop, reference.marginRight, reference.marginBottom, reference.marginLeft],
              minHeight: reference.minHeight,
              gap: reference.gap,
              borderRadius: reference.borderRadius,
            }
            probe.remove()
            const style = getComputedStyle(label)
            const { x, right, width, height } = label.getBoundingClientRect()
            return {
              text: label.textContent.trim(),
              fill: style.backgroundColor,
              foreground: style.color,
              justifyContent: style.justifyContent,
              textAlign: style.textAlign,
              center: x + width / 2,
              panelCenter: panelBounds.center,
              contentCenter: iconBounds && textBounds
                ? (Math.min(iconBounds.x, textBounds.x) + Math.max(iconBounds.right, textBounds.right)) / 2
                : null,
              modeFill,
              textTransform: style.textTransform,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              fontFamily: style.fontFamily,
              letterSpacing: style.letterSpacing,
              lineHeight: style.lineHeight,
              originalMapTitle,
              padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
              minHeight: style.minHeight,
              margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
              gap: style.gap,
              backgroundImage: style.backgroundImage,
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
          gridCenter: gridBox?.center ?? 0,
          waffleWidth: waffleBox?.width ?? 0,
          waffleCenter: waffleBox?.center ?? 0,
          gridClientWidth: grid?.clientWidth ?? 0,
          gridScrollWidth: grid?.scrollWidth ?? 0,
          gridTemplateRows: gridStyle?.gridTemplateRows ?? '',
          gridTemplateColumns: gridStyle?.gridTemplateColumns ?? '',
          gridAutoFlow: gridStyle?.gridAutoFlow ?? '',
          gridGap: gridStyle?.gap ?? '',
          classes: grid?.className ?? '',
          tileBoxes,
          tileSemantics,
          tileVisuals,
          tileBucketOrder: tiles.map((tile) => tile.getAttribute('data-bucket')),
          tileFillsByBucket: Object.fromEntries(tiles.map((tile) => [
            tile.getAttribute('data-bucket'), getComputedStyle(tile).backgroundColor,
          ])),
          legend: legend.map((button) => {
            const style = getComputedStyle(button)
            let desktopBaseline = null
            if (innerWidth > 760 && button.parentElement) {
              const probe = button.cloneNode(true)
              probe.classList.remove('cahier-figure-legend-action--chip')
              probe.removeAttribute('style')
              probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden'
              button.parentElement.append(probe)
              const reference = getComputedStyle(probe)
              desktopBaseline = {
                style: {
                  backgroundColor: reference.backgroundColor,
                  color: reference.color,
                  fontFamily: reference.fontFamily,
                  fontSize: reference.fontSize,
                  fontWeight: reference.fontWeight,
                  lineHeight: reference.lineHeight,
                  letterSpacing: reference.letterSpacing,
                  textTransform: reference.textTransform,
                  borderColor: reference.borderColor,
                  borderWidth: reference.borderWidth,
                  borderStyle: reference.borderStyle,
                  borderRadius: reference.borderRadius,
                  padding: [reference.paddingTop, reference.paddingRight, reference.paddingBottom, reference.paddingLeft],
                  minHeight: reference.minHeight,
                },
                iconColor: probe.querySelector('svg') ? getComputedStyle(probe.querySelector('svg')).color : null,
              }
              probe.remove()
            }
            return {
              key: button.getAttribute('data-legend-key'),
              label: button.querySelector('.cahier-figure-legend-label')?.textContent.trim() ?? '',
              fill: style.backgroundColor,
              foreground: style.color,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              letterSpacing: style.letterSpacing,
              textTransform: style.textTransform,
              borderColor: style.borderColor,
              borderWidth: style.borderWidth,
              borderStyle: style.borderStyle,
              borderRadius: style.borderRadius,
              padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
              minHeight: style.minHeight,
              desktopBaseline,
              iconColor: button.querySelector('svg') ? getComputedStyle(button.querySelector('svg')).color : null,
              iconCount: button.querySelectorAll('svg').length,
              height: box(button).height,
            }
          }),
          note: waffle.querySelector('.aedar-waffle-legend-note')?.textContent.trim() ?? null,
          text: waffle.innerText,
        },
        labelSurfaces,
      }
    })
    assert.equal(w3Visual.waffle.tileCount, 235,
      `W3 must exercise the full production AEDAR category universe at ${width}px`)
    assert(w3Visual.waffle.tileSemantics.every(({ tagName, name }) =>
      tagName === 'BUTTON' && name.length > 0),
    `All real AEDAR category tiles must remain native buttons with accessible names at ${width}px`)
    assert.deepEqual(w3Visual.labelSurfaces.map(({ surface, count }) => ({ surface, count: count > 0 })), [
      { surface: 'CahierBlankMapSlots', count: true },
      { surface: 'AedarDiversityLossMapsCahier', count: true },
      { surface: 'CartographicBreakoutPrototype', count: true },
    ], `W3 browser fixture must render each real map-title surface at ${width}px: ${JSON.stringify(w3Visual.labelSurfaces)}`)
    assert.equal(w3Visual.waffle.gridScrollWidth, w3Visual.waffle.gridClientWidth,
      `Waffle layout must not create an internal horizontal scroller at ${width}px`)
    assert.equal(w3Visual.waffle.legend.length, 6,
      `All six AEDAR buckets must retain a Waffle legend action at ${width}px`)
    const legendKeys = w3Visual.waffle.legend.map(({ key }) => key)
    assert(legendKeys.every((key) => typeof key === 'string') && new Set(legendKeys).size === 6,
      `Waffle legend actions must keep a distinct key for every AEDAR bucket at ${width}px`)
    assert.equal(w3Visual.waffle.legend.every(({ iconCount }) => iconCount === 1), true,
      `All Waffle bucket actions must keep their existing icon at ${width}px`)
    if (width <= 760) {
      assert(w3Visual.waffle.tileBoxes.every(({ width: tileWidth, height: tileHeight }) =>
        Math.abs(tileWidth - 14) < 0.1 && Math.abs(tileHeight - 14) < 0.1),
      `Every mobile Waffle button hit box must be exactly 14×14 CSS px at ${width}px: ${JSON.stringify(w3Visual.waffle.tileBoxes.slice(0, 4))}`)
      assert(w3Visual.waffle.tileVisuals.every(({ width: tileWidth, height: tileHeight, fill, pseudoContent }) =>
        Math.abs(tileWidth - 14) < 0.1 && Math.abs(tileHeight - 14) < 0.1 && pseudoContent === 'none' &&
        fill !== 'rgba(0, 0, 0, 0)'),
      `Mobile Waffle buttons themselves must paint at 14×14px without a larger hit-area wrapper at ${width}px: ${JSON.stringify(w3Visual.waffle.tileVisuals.slice(0, 4))}`)
      const columns = new Set(w3Visual.waffle.tileBoxes.map(({ x }) => Math.round(x * 10) / 10)).size
      const rows = new Set(w3Visual.waffle.tileBoxes.map(({ y }) => Math.round(y * 10) / 10)).size
      const rowCounts = new Map()
      const columnCounts = new Map()
      for (const { x, y } of w3Visual.waffle.tileBoxes) {
        const row = Math.round(y * 10) / 10
        const column = Math.round(x * 10) / 10
        rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1)
        columnCounts.set(column, (columnCounts.get(column) ?? 0) + 1)
      }
      assert.equal(columns, 11,
        `Mobile Waffle must use eleven columns without horizontal overflow at ${width}px, got ${columns}`)
      assert.equal(rows, 22,
        `Mobile Waffle must use 22 rows at ${width}px, got ${rows}`)
      assert([...rowCounts.values()].slice(0, -1).every((count) => count === 11),
        `The first 21 mobile rows must contain eleven actual category buttons at ${width}px`)
      assert.equal([...rowCounts.values()].at(-1), 4,
        `The final mobile row must contain the four remaining real category buttons at ${width}px`)
      const columnsWithTwentyTwoTiles = [...columnCounts.values()].filter((count) => count === 22).length
      const columnsWithTwentyOneTiles = [...columnCounts.values()].filter((count) => count === 21).length
      assert.equal(columnsWithTwentyTwoTiles, 4,
        `Four mobile columns must contain 22 actual category buttons at ${width}px`)
      assert.equal(columnsWithTwentyOneTiles, 7,
        `Seven mobile columns must contain 21 actual category buttons at ${width}px`)
      assert(Math.abs(w3Visual.waffle.gridCenter - w3Visual.waffle.waffleCenter) <= 1,
        `Mobile Waffle grid must be centered in the available figure width at ${width}px`)
      assert(w3Visual.waffle.gridWidth <= w3Visual.waffle.waffleWidth,
        `Mobile Waffle grid must fit inside its figure at ${width}px`)
      assert(Math.abs(w3Visual.waffle.gridWidth - 174) < 0.1,
        `Eleven 14px columns and ten 2px gaps must form a 174px mobile grid at ${width}px, got ${w3Visual.waffle.gridWidth}`)
      assert(Math.abs(w3Visual.waffle.gridHeight - 350) < 0.1,
        `Twenty-two 14px rows and twenty-one 2px gaps must form a 350px mobile grid at ${width}px, got ${w3Visual.waffle.gridHeight}`)
      for (let index = 1; index < w3Visual.waffle.tileBoxes.length; index += 1) {
        const previous = w3Visual.waffle.tileBoxes[index - 1]
        const current = w3Visual.waffle.tileBoxes[index]
        assert(current.y > previous.y || (current.y === previous.y && current.x > previous.x),
          `Mobile category buttons must preserve row-major category order at ${width}px`)
      }
      for (const chip of w3Visual.waffle.legend) {
        const tileFill = w3Visual.waffle.tileFillsByBucket[chip.key]
        if (tileFill) assert.equal(chip.fill, tileFill,
          `Mobile Waffle ${chip.key} chip must match its unchanged bucket tile fill at ${width}px`)
        assert.notEqual(chip.fill, 'rgba(0, 0, 0, 0)',
          `Mobile Waffle bucket ${chip.label} must render as a filled chip at ${width}px`)
        assert(contrastRatio(chip.foreground, chip.fill) >= 4.5,
          `Mobile Waffle bucket ${chip.label} must have 4.5:1 computed contrast at ${width}px: ${JSON.stringify(chip)}`)
        assert(contrastRatio(chip.iconColor, chip.fill) >= 4.5,
          `Mobile Waffle bucket ${chip.label} icon must have 4.5:1 contrast at ${width}px: ${JSON.stringify(chip)}`)
        assert(chip.height >= 36 - 0.5,
          `Mobile Waffle legend action ${chip.label} must retain its 36px target at ${width}px`)
      }
    } else {
      assert(w3Visual.waffle.classes.includes('aedar-waffle-grid--five-rows'),
        `Desktop Waffle must retain the original five-row layout class at ${width}px`)
      const columns = new Set(w3Visual.waffle.tileBoxes.map(({ x }) => Math.round(x * 10) / 10)).size
      const rows = new Set(w3Visual.waffle.tileBoxes.map(({ y }) => Math.round(y * 10) / 10)).size
      assert.equal(rows, 5, `Desktop Waffle must retain its original five rows at ${width}px`)
      assert.equal(columns, 47, `Desktop Waffle must retain its original 47 columns at ${width}px`)
      assert.equal(w3Visual.waffle.gridAutoFlow, 'column',
        `Desktop Waffle must retain the original column-major order at ${width}px`)
      assert.equal(w3Visual.waffle.gridGap, '2px',
        `Desktop Waffle must retain the original 2px tile gap at ${width}px`)
      assert(Math.abs(w3Visual.waffle.gridWidth - Math.min(w3Visual.waffle.waffleWidth, 1000)) < 1,
        `Desktop Waffle must retain its original 1000px width cap at ${width}px: ${JSON.stringify(w3Visual.waffle)}`)
      for (const chip of w3Visual.waffle.legend) {
        const style = {
          backgroundColor: chip.fill,
          color: chip.foreground,
          fontFamily: chip.fontFamily,
          fontSize: chip.fontSize,
          fontWeight: chip.fontWeight,
          lineHeight: chip.lineHeight,
          letterSpacing: chip.letterSpacing,
          textTransform: chip.textTransform,
          borderColor: chip.borderColor,
          borderWidth: chip.borderWidth,
          borderStyle: chip.borderStyle,
          borderRadius: chip.borderRadius,
          padding: chip.padding,
          minHeight: chip.minHeight,
        }
        assert.deepEqual(style, chip.desktopBaseline.style,
          `Desktop Waffle ${chip.label} legend label must match the original unfilled action at ${width}px`)
        assert.equal(chip.iconColor, chip.desktopBaseline.iconColor,
          `Desktop Waffle ${chip.label} icon must retain its original bucket color at ${width}px`)
        assert.equal(chip.fill, 'rgba(0, 0, 0, 0)',
          `Desktop Waffle ${chip.label} label must not be a filled chip at ${width}px`)
      }
    }
    assert.equal(w3Visual.waffle.note, null,
      `Waffle color-limitation note must be absent at ${width}px`)
    assert(!w3Visual.waffle.text.includes('Les teintes proches ne distinguent pas toutes les catégories.'),
      `Waffle must not replace the removed note with its limitation copy at ${width}px`)
    assert(w3Visual.waffle.tileBucketOrder.every((bucket, index, buckets) =>
      index === 0 || bucket === buckets[index - 1] || !buckets.slice(0, index).includes(bucket)),
    `Waffle tiles must remain grouped in their existing bucket order at ${width}px`)
    for (const { surface, labels } of w3Visual.labelSurfaces) {
      for (const label of labels) {
        assert.equal(label.iconCount, 1, `${surface} must preserve each map mode icon at ${width}px`)
        assert.equal(label.iconColor, label.foreground,
          `${surface} map mode icon must use its label's computed foreground at ${width}px`)
        assert(label.x >= -0.5 && label.right <= width + 0.5,
          `${surface} chip must stay inside the viewport at ${width}px: ${JSON.stringify(label)}`)
        if (width <= 760) {
          assert(Math.abs(label.center - label.panelCenter) <= 1,
            `${surface} mobile map chip must be centered in its panel at ${width}px: ${JSON.stringify(label)}`)
          assert.equal(label.justifyContent, 'center',
            `${surface} mobile map label content must be centered inside the chip at ${width}px`)
          assert.equal(label.textAlign, 'center',
            `${surface} mobile map label text must be centered at ${width}px`)
          assert(Math.abs(label.contentCenter - label.center) <= 2,
            `${surface} mobile map icon/text group must be centered in the chip at ${width}px: ${JSON.stringify(label)}`)
          assert(Number.parseFloat(label.fontSize) >= 12,
            `${surface} mobile map title must use a semantic type role at or above 12px at ${width}px: ${JSON.stringify(label)}`)
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
          for (const property of [
            'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform',
            'fill', 'backgroundImage', 'padding', 'margin', 'minHeight', 'gap', 'borderRadius',
          ]) {
            const actual = property === 'fill' ? label.fill : label[property]
            const expected = property === 'fill' ? label.originalMapTitle.backgroundColor : label.originalMapTitle[property]
            assert.deepEqual(actual, expected,
              `${surface} desktop map title ${property} must match the original --text-overline probe at ${width}px: ${JSON.stringify(label)}`)
          }
        }
      }
    }
    if (width === 320) {
      const mapLabelSelectors = [
        ['CahierBlankMapSlots', '.blank-map-slots .map-panel-label'],
        ['AedarDiversityLossMapsCahier', '.aedar-diversity-loss-map-label'],
        ['CartographicBreakoutPrototype', '.map-breakout .map-panel-label'],
      ]
      for (const [surface, selector] of mapLabelSelectors) {
        await page.locator(selector).first().scrollIntoViewIfNeeded()
        await page.screenshot({ path: resolve(evidenceDir, `issue829-map-chip-${surface}-320.png`), fullPage: false })
      }
      await page.locator('.aedar-waffle-grid').screenshot({
        path: resolve(evidenceDir, 'issue829-waffle-mobile-grid-320.png'),
      })
    }
    const cartographicMapChipInteraction = width === 320
      ? await verifyCartographicMapChipContrast(page)
      : null
    const waffleLegendInteraction = width === 320 ? await verifyWaffleLegendInteraction(page) : null
    const tileColumns = new Set(w3Visual.waffle.tileBoxes.map(({ x }) => Math.round(x * 10) / 10)).size
    const tileRows = new Set(w3Visual.waffle.tileBoxes.map(({ y }) => Math.round(y * 10) / 10)).size
    const finalRowY = Math.max(...w3Visual.waffle.tileBoxes.map(({ y }) => y))
    const w3Summary = {
      waffle: {
        tileCount: w3Visual.waffle.tileCount,
        gridWidth: w3Visual.waffle.gridWidth,
        gridHeight: w3Visual.waffle.gridHeight,
        columns: tileColumns,
        rows: tileRows,
        finalRowTileCount: w3Visual.waffle.tileBoxes.filter(({ y }) => Math.abs(y - finalRowY) < 0.5).length,
        minimumHitTarget: {
          width: Math.min(...w3Visual.waffle.tileBoxes.map(({ width: tileWidth }) => tileWidth)),
          height: Math.min(...w3Visual.waffle.tileBoxes.map(({ height: tileHeight }) => tileHeight)),
        },
        minimumVisualTile: {
          width: Math.min(...w3Visual.waffle.tileVisuals.map(({ width: tileWidth }) => tileWidth)),
          height: Math.min(...w3Visual.waffle.tileVisuals.map(({ height: tileHeight }) => tileHeight)),
        },
        legend: w3Visual.waffle.legend.map((chip) => ({
          key: chip.key,
          label: chip.label,
          fill: chip.fill,
          foreground: chip.foreground,
          contrast: width <= 760 ? Number(contrastRatio(chip.foreground, chip.fill).toFixed(2)) : null,
        })),
      },
      mapLabels: w3Visual.labelSurfaces.map(({ surface, labels }) => ({
        surface,
        labels: labels.map((label) => ({
          text: label.text,
          centeredInPanel: width <= 760 ? Math.abs(label.center - label.panelCenter) <= 1 : null,
          fill: width <= 760 ? label.fill : null,
          foreground: width <= 760 ? label.foreground : null,
          contrast: width <= 760 ? Number(contrastRatio(label.foreground, label.fill).toFixed(2)) : null,
          iconCount: label.iconCount,
        })),
      })),
    }

    let accessRampLongYAxisFigure = null
    if ([320, 360, 390].includes(width)) {
      accessRampLongYAxisFigure = await page.evaluate(async ({ baseUrl, railContract }) => {
        const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
        const root = document.createElement('div')
        root.id = 'access-ramp-time-long-y-axis-browser-fixture'
        root.style.cssText = `position:fixed;top:0;left:0;width:${innerWidth}px;visibility:hidden;pointer-events:none;z-index:-1`
        document.body.append(root)
        // #627 - only the retained AEDAR time ramp mounts here; the legacy
        // building-quantile ramp variant retired with the accessibility surface.
        const app = await fixture.mountAccessRampLongYAxisFigure(root)
        try {
          await document.fonts.ready
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          const frame = root.querySelector('.access-ramp-cahier')
          const plot = root.querySelector('.access-ramp-plot')
          const svg = root.querySelector('.access-ramp-svg')
          const axis = root.querySelector('.access-ramp-axis')
          const mark = root.querySelector('.access-ramp-time-line.access-ramp-line--territory')
          const hitbox = root.querySelector('.access-ramp-cut-hitbox')
          const labels = [...root.querySelectorAll('.cahier-figure-tick-label--y')]
          const title = root.querySelector('.cahier-figure-axis-title--y')
          if (!frame || !plot || !svg || !axis || !mark || !hitbox || labels.length === 0 || !title) {
            throw new Error('Access-ramp time long-y-label fixture did not mount completely')
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
          const markX = Number(mark.getAttribute('d').match(/^M\s*([\d.]+)/u)?.[1])
          const hitboxRail = Number.parseFloat(hitbox.style.left) * viewBoxWidth / 100
          hitbox.click()
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const tooltip = root.querySelector('.access-ramp-tooltip')
          const tooltipAnchor = tooltip?.style.getPropertyValue('--cahier-figure-tooltip-anchor-x') ?? ''
          const { titleRect, labelRects, overlaps } = fixture.auditYAxisTitleTickOverlap(title, labels)
          return {
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
      }, { baseUrl, railContract })
      const report = accessRampLongYAxisFigure
      assert(report.labels.some((label) => label.replace(/\D/gu, '') === '12881') &&
        report.labels.some((label) => label.replace(/\D/gu, '') === '6440'),
      `Access-ramp time fixture must include Rennes-equivalent long ticks at ${width}px: ${JSON.stringify(report)}`)
      assert.deepEqual(report.overlaps, [],
        `Access-ramp time y-axis title must not intersect any y-tick label at ${width}px: ${JSON.stringify(report)}`)
      assert(report.railWidth >= report.requiredRailWidth - 1,
        `Access-ramp time frame must reserve measured label width and title lane at ${width}px: ${JSON.stringify(report)}`)
      assert.equal(report.viewBoxWidth, 640, 'Access-ramp time must preserve its original 640px geometry')
      assert.equal(report.viewBoxHeight, 300, 'Access-ramp time must use its custom 300px geometry')
      assert(Math.abs(report.frameRightWidth - 68) < 0.1 &&
        Math.abs(report.frameTopWidth - 22) < 0.1 &&
        Math.abs(report.frameBottomWidth - 62) < 0.1 &&
        report.railWidth >= 64,
      `Access-ramp time must preserve its original top/right/bottom margins and only widen the left rail: ${JSON.stringify(report)}`)
      assert(Math.abs(report.axisLeft - report.railWidth) < 0.5 &&
        Math.abs(report.labelRailWidth - report.railWidth) < 0.5,
      `Access-ramp time SVG axis, HTML labels and frame must share one measured left rail at ${width}px: ${JSON.stringify(report)}`)
      assert(Math.abs(report.markX - report.railWidth) < 0.5 &&
        Math.abs(report.hitboxRail - report.railWidth) < 0.5 && report.tooltipAnchor.length > 0,
      `Access-ramp time marks, hitboxes and tooltip must consume the measured geometry at ${width}px: ${JSON.stringify(report)}`)
      assert(Math.abs(report.axisRight - (report.viewBoxWidth - report.frameRightWidth)) < 0.5 &&
        report.axisRight - report.axisLeft < report.viewBoxWidth - report.frameRightWidth - 1,
      `Access-ramp time plot must give horizontal width to its measured y-axis rail at ${width}px: ${JSON.stringify(report)}`)
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
        // #627 - the bivariate-distribution grid retired with the accessibility
        // surface; the Mobilité raccordement curve is the retained figure with
        // HTML y ticks and the active comparison mean (#955).
        const figures = [
          {
            family: 'raccordement-curve',
            mount: fixture.mountCahierMobiliteRaccordementCurve,
            frameSelector: '.cahier-figure-frame',
            plotSelector: '.mobilite-raccordement-curve__plot',
            svgSelector: '.mobilite-raccordement-curve__svg',
            // #1006 — the compact grammar draws its own grid and baseline; the
            // plotted curve is one path, so the first command is the mark rail.
            axisSelector: '.mobilite-raccordement-curve__axis',
            labelRail: (label, width) => label.getAttribute('x') === null
              ? Number.parseFloat(label.style.left) * width / 100
              : Number(label.getAttribute('x')),
            markX: (mark) => Number(/^M([0-9.]+),/u.exec(mark.getAttribute('d') ?? '')?.[1]),
            markSelector: '.mobilite-raccordement-curve__territory',
            tooltipSelector: '.mobilite-raccordement-curve__tooltip',
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
              expectedTooltipAnchor = `${((hitboxRail + hitboxWidth / 2) / viewBoxWidth) * 100}%`
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
              ...(definition.family === 'raccordement-curve' ? {
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
              hitboxAnchor: definition.hitboxAnchor ?? 'start',
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
        if (report.family === 'raccordement-curve') {
          assert.notEqual(report.labelRails.html, null,
            `Raccordement-curve fixture must render HTML y-tick labels at ${width}px: ${JSON.stringify(report)}`)
          for (const [representation, labelRail] of Object.entries(report.labelRails)) {
            if (labelRail === null) continue
            assert(Math.abs(labelRail - report.axisLeft) < 0.5 &&
              Math.abs(labelRail - report.frameRail) < 0.5,
            `${report.family} first ${representation} y-tick label must share the frame and SVG axis rail at ${width}px: ${JSON.stringify(report)}`)
          }
        }
        if (report.hitboxRail !== null) {
          const hitboxEdge = report.hitboxAnchor === 'center'
            ? report.hitboxRail + report.hitboxWidth / 2
            : report.hitboxRail
          assert(Math.abs(hitboxEdge - report.axisLeft) < 0.5 && report.hitboxWidth > 0,
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

    assert.equal(readCalls.retiredThemeFactsRoutes, 0,
      `Retired theme-facts route hit at ${width}px (${readCalls.retiredThemeFactsRoutes}); the browser must never call it anymore.`)
    assert.ok(readCalls.themeBatches >= 1,
      `Expected at least one semantic read-batch for the active theme facts at ${width}px; got ${readCalls.themeBatches}.`)
    const chunk = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
      values.slice(index * size, (index + 1) * size))
    const coreProjections = chunk(AEDAR_CORE_MEASURE_KEYS, 32)
    const detailProjections = chunk(AEDAR_EXPLORER_DETAIL_MEASURE_KEYS, 32)
    // The focal commune reads its core and explorer detail aggregates; the
    // EPCI reference is read through its independent summary contract, not a
    // second aggregate projection.
    const communeCible = territoryReference.find((t) => t.territoire === '35238')
    const epciReference = communeCible?.epci
      ? territoryReference.find((t) => t.type === 'epci' && t.territoire === communeCible.epci)
      : null
    const expectedAedarBatches = coreProjections.length + detailProjections.length
    assert.equal(readCalls.aedarBatches, expectedAedarBatches,
      `Expected ${expectedAedarBatches} semantic read-batch POSTs for the focal core/detail field projections at ${width}px; got ${readCalls.aedarBatches}.`)
    assert.equal(readCalls.aedarSummaryBatches, epciReference ? 2 : 1,
      `Expected the focal and EPCI-reference AEDAR summaries to route to their declared fixture at ${width}px; got ${readCalls.aedarSummaryBatches}.`)
    if (epciReference) {
      assert(readCalls.aedarSummaryTargets.some((item) =>
        item.target?.type === 'epci' && item.target?.id === epciReference.territoire),
      `Expected the EPCI reference summary target at ${width}px; got ${JSON.stringify(readCalls.aedarSummaryTargets)}.`)
    }
    assert.ok(readCalls.aedarComparisonBatches >= 1,
      `Expected the aggregate AEDAR comparison to route to its declared fixture at ${width}px; got ${readCalls.aedarComparisonBatches}.`)
    const expectedTypequPartitions = chunk(AEDAR_TYPEQU_REGISTRY.map(({ code }) => code), 100)
    const expectedAedarItems = coreProjections.length * expectedTypequPartitions.length + detailProjections.length
    assert.equal(readCalls.aedarItems.length, expectedAedarItems,
      `Expected ${expectedAedarItems} AEDAR resource items across the focal core universe and explorer projections at ${width}px; got ${readCalls.aedarItems.length}.`)
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
      const focal = items.filter((item) => item.target.type === 'commune')
      assert.equal(focal.length, projection.partitions.length, `Focal AEDAR items at ${width}px`)
      for (const [index, item] of focal.entries()) {
        assert.equal(item.id, `semantic-${index}-aedar_territorial_aggregate`,
          `Unexpected AEDAR item id at ${width}px, projection index ${index}`)
        assert.equal(item.resource, 'aedar_territorial_aggregate', `Unexpected AEDAR resource at ${width}px, item ${index}`)
        assert.deepEqual(item.target, { kind: 'territory', type: 'commune', id: '35238' },
          `Unexpected focal AEDAR target at ${width}px, item ${index}`)
        assert.deepEqual(item.typequ, projection.partitions[index],
          `AEDAR TYPEQU range mismatch at ${width}px, item ${index}; fixture must cover the registered codes in producer order.`)
      }
    }

    if (width === 390 || width === 1440) {
      // #986 — a chapter is read only when it is requested: visit the page-3
      // chapter before asserting its layout (the same navigation a reader makes).
      await page.goto(`${baseUrl}territoire/commune/35238?theme=mobilite#figure-offre-transports-commun`,
        { waitUntil: 'networkidle' })
      const gauge = page.locator('[data-section="couverture-du-territoire"]')
      const curve = page.locator('[data-section="visiter-la-bretagne"]')
      await gauge.waitFor({ state: 'visible', timeout: 10000 })
      assert(await gauge.isVisible() && await curve.isVisible(),
        `Mobilité page 3 sections must render at ${width}px`)

      await gauge.scrollIntoViewIfNeeded()
      const gaugeGeometry = await gauge.evaluate((section) => {
        // #1006 — two named rows: the territory's published share and the
        // header group's, each with its quiet remainder. The visible value sits
        // in the row head, above its track.
        const fill = section.querySelector('[data-row="territory"] [data-segment="share"]')
        const rail = section.querySelector('[data-row="territory"] .mobilite-share-track__track')
        const value = section.querySelector('[data-row="territory"] .mobilite-share-track__value')
        const reference = section.querySelector('[data-row="comparison"] [data-segment="share"]')
        const referenceValue = section.querySelector('[data-row="comparison"] .mobilite-share-track__value')
        const box = (node) => node?.getBoundingClientRect() ?? null
        const railBox = box(rail)
        const insideRail = (target) => target && railBox
          ? target.left >= railBox.left - 1 && target.right <= railBox.right + 1
          : true
        const valueBox = box(value)
        const fillBox = box(fill)
        const fillStyle = fill ? getComputedStyle(fill) : null
        const valueStyle = value ? getComputedStyle(value) : null
        const paper = getComputedStyle(document.querySelector('.cahier-page')).backgroundColor
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })
        const rgb = (color) => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
          return { red, green, blue, alpha }
        }
        return {
          visibleFill: Boolean(fill && Number.parseFloat(fill.style.width) > 0),
          valueText: value?.textContent?.trim() ?? '',
          referenceText: referenceValue?.textContent?.trim() ?? '',
          hasReference: Boolean(reference && referenceValue),
          valueWithinRail: insideRail(box(value)),
          referenceWithinRail: insideRail(box(referenceValue)),
          valueRgb: valueStyle ? rgb(valueStyle.color) : null,
          fillRgb: fillStyle ? rgb(fillStyle.backgroundColor) : null,
          paperRgb: rgb(paper),
          valueOverFill: Boolean(valueBox && fillBox &&
            valueBox.left < fillBox.right && valueBox.right > fillBox.left &&
            valueBox.top < fillBox.bottom && valueBox.bottom > fillBox.top),
          horizontalOverflow: section.scrollWidth > section.clientWidth + 1,
        }
      })
      assert(gaugeGeometry.visibleFill, `Share-track fill must render at ${width}px: ${JSON.stringify(gaugeGeometry)}`)
      assert(gaugeGeometry.valueText.includes('%') && gaugeGeometry.hasReference &&
        gaugeGeometry.referenceText.includes('%'),
      `Share-track value and reference tick must carry their percentages at ${width}px: ${JSON.stringify(gaugeGeometry)}`)
      assert(gaugeGeometry.valueWithinRail && gaugeGeometry.referenceWithinRail && !gaugeGeometry.horizontalOverflow,
        `Share-track labels must stay inside the 0–100 % track at ${width}px: ${JSON.stringify(gaugeGeometry)}`)
      const gaugeBackground = gaugeGeometry.valueOverFill ? gaugeGeometry.fillRgb : gaugeGeometry.paperRgb
      const gaugeContrast = contrastRatioFromChannels(
        [gaugeGeometry.valueRgb.red, gaugeGeometry.valueRgb.green, gaugeGeometry.valueRgb.blue],
        [gaugeBackground.red, gaugeBackground.green, gaugeBackground.blue],
      )
      assert(gaugeContrast >= 4.5,
        `Share-track value must retain 4.5:1 contrast on its actual background at ${width}px: ${JSON.stringify({ ...gaugeGeometry, gaugeContrast })}`)
      await gauge.screenshot({ path: resolve(evidenceDir, `issue955-couverture-${width}.png`) })

      await curve.scrollIntoViewIfNeeded()
      const curveGeometry = await curve.evaluate((section) => {
        const svg = section.querySelector('.mobilite-raccordement-curve__svg')
        const yLabels = [...section.querySelectorAll('.cahier-figure-tick-label--y')]
          .map((label) => label.textContent?.trim() ?? '')
        const xLabels = [...section.querySelectorAll('.cahier-figure-tick-label--x')]
          .map((label) => label.textContent?.trim() ?? '')
        const xLabelBoxes = [...section.querySelectorAll('.cahier-figure-tick-label--x')]
          .map((label) => label.getBoundingClientRect())
          .sort((left, right) => left.left - right.left)
        const xLabelsOverlap = xLabelBoxes.some((box, index) =>
          index > 0 && box.left < xLabelBoxes[index - 1].right + 1)
        const hitSurface = section.querySelector('.mobilite-raccordement-curve__hit-surface')
        const hitSurfaceBox = hitSurface?.getBoundingClientRect() ?? null
        const svgBox = svg?.getBoundingClientRect() ?? null
        const yBoxes = [...section.querySelectorAll('.cahier-figure-tick-label--y')]
          .map((label) => label.getBoundingClientRect())
        const clipped = svgBox ? yBoxes.some((label) => label.top < svgBox.top - 1 || label.bottom > svgBox.bottom + 1) : true
        return {
          yLabels, xLabels, clipped, xLabelsOverlap,
          hitSurface: hitSurfaceBox ? { width: hitSurfaceBox.width, height: hitSurfaceBox.height } : null,
          horizontalOverflow: section.scrollWidth > section.clientWidth + 1,
          territory: Boolean(section.querySelector('.mobilite-raccordement-curve__territory')),
          comparison: Boolean(section.querySelector('.mobilite-raccordement-curve__comparison')),
          marker: section.querySelector('.mobilite-raccordement-curve__marker')?.getAttribute('data-detail') ?? null,
        }
      })
      assert(curveGeometry.territory && curveGeometry.comparison,
        `Raccordement curve must render territory and active group mean at ${width}px: ${JSON.stringify(curveGeometry)}`)
      assert(curveGeometry.yLabels.includes('0 %') && curveGeometry.yLabels.includes('100 %') && !curveGeometry.clipped,
        `Raccordement 0–100 % y-axis must not clip at ${width}px: ${JSON.stringify(curveGeometry)}`)
      assert(curveGeometry.xLabels.includes('1 h 30') && curveGeometry.marker === 't0090' && !curveGeometry.horizontalOverflow,
        `Raccordement metadata grid and marker must render at ${width}px: ${JSON.stringify(curveGeometry)}`)
      assert(!curveGeometry.xLabelsOverlap,
        `Raccordement visible x labels must not overlap at ${width}px: ${JSON.stringify(curveGeometry)}`)
      assert(curveGeometry.hitSurface && curveGeometry.hitSurface.width >= 24 && curveGeometry.hitSurface.height >= 24,
        `Raccordement touch surface must retain a usable target at ${width}px: ${JSON.stringify(curveGeometry)}`)
      await curve.locator('.mobilite-raccordement-curve__hit-surface').focus()
      const tooltip = curve.locator('.mobilite-raccordement-curve__tooltip')
      await tooltip.waitFor({ state: 'visible' })
      const tooltipBox = await tooltip.boundingBox()
      const viewport = page.viewportSize()
      assert(tooltipBox && viewport && tooltipBox.y >= 0 &&
        tooltipBox.y + tooltipBox.height <= viewport.height + 1,
      `Raccordement tooltip must stay in the viewport at ${width}px: ${JSON.stringify({ tooltipBox, viewport })}`)
      const clampProof = await curve.evaluate((section) => {
        const tooltip = section.querySelector('.mobilite-raccordement-curve__tooltip')
        const marker = section.querySelector('.mobilite-raccordement-curve__marker line')
        const svg = section.querySelector('.mobilite-raccordement-curve__svg')
        const plot = section.querySelector('.mobilite-raccordement-curve__plot')
        const firstLabel = section.querySelector('.cahier-figure-tick-label--x')
        const anchor = Number.parseFloat(tooltip.style.getPropertyValue('--cahier-figure-tooltip-anchor-x')) / 100
        const viewBoxWidth = svg.viewBox.baseVal.width
        const plotWidth = plot.getBoundingClientRect().width
        const tooltipWidth = tooltip.getBoundingClientRect().width
        const half = tooltipWidth / 2 / plotWidth
        const markerX = Number(marker.getAttribute('x1'))
        const expectedMarker = Math.max(half, Math.min(1 - half, markerX / viewBoxWidth))
        const firstX = Number.parseFloat(firstLabel.style.left) / 100
        const expectedFirst = Math.max(half, Math.min(1 - half, firstX))
        const plotBox = plot.getBoundingClientRect()
        const tooltipRect = tooltip.getBoundingClientRect()
        return { anchor, expectedMarker, expectedFirst, half, markerX, viewBoxWidth, plotWidth,
          tooltipWidth, plotBox: { left: plotBox.left, right: plotBox.right },
          tooltipRect: { left: tooltipRect.left, right: tooltipRect.right } }
      })
      assert(Math.abs(clampProof.anchor - clampProof.expectedMarker) < 0.001,
        `Raccordement tooltip must use the exact clamp-aware marker anchor at ${width}px: ${JSON.stringify(clampProof)}`)
      assert(clampProof.tooltipRect.left >= clampProof.plotBox.left - 1 &&
        clampProof.tooltipRect.right <= clampProof.plotBox.right + 1,
      `Raccordement tooltip must stay inside its plot at ${width}px: ${JSON.stringify(clampProof)}`)

      const surfaceBox = await curve.locator('.mobilite-raccordement-curve__hit-surface').boundingBox()
      const svgBox = await curve.locator('.mobilite-raccordement-curve__svg').boundingBox()
      assert(surfaceBox && svgBox, `Raccordement interaction geometry missing at ${width}px`)
      await page.mouse.click(surfaceBox.x + 2, surfaceBox.y + surfaceBox.height / 2)
      await tooltip.waitFor({ state: 'visible' })
      const boundaryProof = await curve.evaluate((section) => {
        const tooltip = section.querySelector('.mobilite-raccordement-curve__tooltip')
        const anchor = Number.parseFloat(tooltip.style.getPropertyValue('--cahier-figure-tooltip-anchor-x')) / 100
        return { anchor, title: tooltip.querySelector('strong')?.textContent?.trim() ?? '' }
      })
      assert(Math.abs(boundaryProof.anchor - clampProof.expectedFirst) < 0.001,
        `Raccordement boundary tap must clamp to the first declared tick at ${width}px: ${JSON.stringify({ boundaryProof, clampProof })}`)

      await curve.locator('.mobilite-raccordement-curve__hit-surface').press('Escape')
      await curve.locator('.mobilite-raccordement-curve__hit-surface').evaluate((element) => element.blur())
      await curve.locator('.mobilite-raccordement-curve__hit-surface').focus()
      await tooltip.waitFor({ state: 'visible' })
      await curve.screenshot({ path: resolve(evidenceDir, `issue955-visiter-tooltip-${width}.png`) })
    }

    // Disable the inherited clipping while measuring; otherwise scrollWidth can
    // falsely pass even when an oversized Cahier child sticks out of the page.
    // #986 — the page-3 block above navigated to its own chapter; the shared
    // overflow/AEDAR metrics describe the page-1 landing, so return to it.
    await page.goto(`${baseUrl}territoire/commune/35238?theme=mobilite`, { waitUntil: 'networkidle' })
    await page.locator('#section-aedar-car-overview').waitFor({ state: 'visible', timeout: 10000 })

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
        pendingChapterShells: [...cahier.querySelectorAll('.cahier-section-state[role="status"]')]
          .filter((el) => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 })
          .filter((el) => el.innerText.trim() === 'Chargement des données…')
          .map((el) => ({ text: el.innerText.slice(0, 120), className: el.className })),
        errorOrLoadingShells: [...cahier.querySelectorAll('[role="alert"], [role="status"]:not(.aedar-equipment-explorer-selected), .aedar-state')]
          .filter((el) => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 })
          // #1008 — an off-screen chapter at rest is pending, not a loading or
          // error failure of the populated AEDAR chapter. Only this exact
          // pending placeholder is exempted; alerts, AEDAR loading and any
          // other status shell still fail the gate.
          .filter((el) => !(el.classList.contains('cahier-section-state') &&
            el.getAttribute('role') === 'status' && el.innerText.trim() === 'Chargement des données…'))
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

    // #861 : après les assertions d'acquisition du défaut ci-dessus, pour ne
    // pas confondre leurs compteurs avec les lectures de cette nouvelle sélection.
    const builderTrigger = page.locator('.page-heading [aria-label="Construire un groupe de comparaison"]').first()
    await builderTrigger.click()
    const searchMember = page.locator('dialog[open] .membres-comparaison input[type="search"]')
    await searchMember.waitFor({ state: 'visible' })
    assert.equal(await searchMember.getAttribute('aria-label'), 'Rechercher un territoire')
    await searchMember.fill('22002')
    const addMember = page.locator('dialog[open] .membres-comparaison__colonne--dehors button[aria-label^="Ajouter"]').first()
    await addMember.click()
    await page.locator('dialog[open] .membres-comparaison__colonne--dedans li').filter({ hasText: 'Andel' }).waitFor()
    await searchMember.fill('')
    const builder = await page.locator('dialog[open].cahier-dialog').evaluate((element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const targets = [...element.querySelectorAll('.membres-comparaison button, input')]
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, position: style.position,
        viewportHeight: innerHeight, overflow: element.scrollWidth > element.clientWidth,
        modal: element.getAttribute('aria-modal'),
        searchFirst: Boolean(element.querySelector('input[type="search"]')?.compareDocumentPosition(element.querySelector('.membres-comparaison__colonnes')) & Node.DOCUMENT_POSITION_FOLLOWING),
        hasMemberColumns: element.querySelectorAll('.membres-comparaison__colonne').length === 2,
        columnScroll: [...element.querySelectorAll('.membres-comparaison__colonne ul')].map((scroller) => ({ client: scroller.clientHeight, scroll: scroller.scrollHeight, max: getComputedStyle(scroller.parentElement).maxHeight })),
        targets: targets.map((target) => target.getBoundingClientRect().height) }
    })
    assert(!builder.overflow && builder.left >= 0 && builder.right <= width && builder.top >= 0 && builder.bottom <= builder.viewportHeight,
      `Constructeur hors du viewport à ${width}px : ${JSON.stringify(builder)}`)
    assert.equal(builder.modal, 'true', 'Le constructeur doit être un dialogue modal')
    assert(builder.hasMemberColumns && builder.searchFirst,
      'La recherche doit précéder les deux colonnes indépendantes dans le modal')
    assert(builder.columnScroll.every((column) => column.scroll > column.client && column.max !== 'none'),
      `Les deux listes doivent défiler indépendamment dans une hauteur bornée : ${JSON.stringify(builder.columnScroll)}`)
    assert(builder.targets.every((height) => height >= 44), `Cibles constructeur <44px : ${JSON.stringify(builder)}`)
    assert.equal(builder.position, 'fixed', 'Le constructeur doit utiliser la couche modale native')
    if (width === 390 || width === 1440) await page.screenshot({ path: resolve(evidenceDir, `issue861-constructeur-${width}.png`), fullPage: false })
    await page.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click()
    assert.equal(await page.locator('.constructeur-comparaison dialog[open]').count(), 0,
      'Le modal singleton doit être fermé après un seul clic')

    // #976 — a custom member selection carries no producer scope label, so the
    // theme comparison deliberately clears its references. Restore a
    // producer-scoped preset so the coherent fixture serves references and the
    // compared wash is really drawn before the colour proof and captures. This
    // does not hide a production failure: the fixture is synthetic and the
    // live comparison load is a separate, documented dependency.
    await builderTrigger.click()
    await page.locator('dialog[open] .constructeur-comparaison__preset').first().click()
    await page.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click()
    await page.locator('[data-column="ravitaillement"] rect[data-comparison="charging"]')
      .waitFor({ state: 'attached' })
    await page.locator('[data-column="ravitaillement"] rect[data-comparison="fuel-stations"]')
      .waitFor({ state: 'attached' })

    // #974 — review captures of the corrected page-2 surfaces at the two
    // review widths, taken from the real production route (all units render).
    // Each element is centred first so the sticky header never paints over it.
    if (width === 390 || width === 1440) {
      const captureSurface = async (locator, name) => {
        // Park the pointer first: a hover tooltip from the previous interaction
        // must never sit over the captured surface.
        await page.mouse.move(0, 0)
        await locator.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(150)
        const box = await locator.boundingBox()
        if (!box) throw new Error(`Capture target ${name} has no box`)
        const pad = 8
        const x = Math.max(0, box.x - pad)
        const y = Math.max(0, box.y - pad)
        await page.screenshot({
          path: resolve(evidenceDir, name),
          clip: {
            x,
            y,
            width: Math.min(width - x, box.width + pad * 2),
            height: Math.min(844 - y, box.height + pad * 2),
          },
        })
      }
      await captureSurface(page.locator('.mobilite-section--reseaux .mobilite-section-figure'),
        `issue974-page2-legend-${width}.png`)
      if (width === 1440) {
        await captureSurface(page.locator('.mobilite-section--stationnement-ravitaillement'),
          'issue974-page2-ratios-1440.png')
      } else {
        await captureSurface(page.locator('[data-column="stationnement"] .mobilite-ratio-scalar'),
          'issue974-page2-ratio-parking-390.png')
        await captureSurface(page.locator('[data-column="ravitaillement"] .mobilite-ratio-scalar'),
          'issue974-page2-ratio-refuelling-390.png')
      }
      // #976 — the owner's two review surfaces: the recalibrated captions and
      // the charging category's distinct ink, captured from the real route.
      await captureSurface(page.locator('[data-column="stationnement"] .mobilite-ratio-scalar'),
        `issue976-page2-ratio-parking-${width}.png`)
      await captureSurface(page.locator('[data-column="ravitaillement"] .mobilite-ratio-scalar'),
        `issue976-page2-ratio-refuelling-${width}.png`)
      await captureSurface(page.locator('[data-column="ravitaillement"] .mobilite-section-figure'),
        `issue976-page2-refuelling-figure-${width}.png`)
      // #988 — the legend cleanup review surfaces: the network legend and the
      // parking figure, where only the comparison key remains.
      await captureSurface(page.locator('.mobilite-section--reseaux .mobilite-section-figure'),
        `issue988-page2-network-legend-${width}.png`)
      await captureSurface(page.locator('[data-column="stationnement"] .mobilite-section-figure'),
        `issue988-page2-parking-figure-${width}.png`)
    }

    // #976 — the page-2 ratio captions must wear the exact AEDAR scalar caption
    // role, not a lookalike: compare the real computed typography with the AEDAR
    // car-overview scalar caption on the same route. The charging bar and its
    // tooltip marker must share the app brand ink, while the fuel-station
    // category keeps the theme ink it already had.
    if (width === 390 || width === 1440) {
      const captionIdentity = await page.evaluate(() => {
        const styleOf = (element) => {
          const style = getComputedStyle(element)
          return {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
            textTransform: style.textTransform,
          }
        }
        const aedarCaption = document.querySelector(
          '#section-aedar-car-overview .aedar-car-overview-scalars .cahier-figure-scalar-label')
        const ratioCaptions = [...document.querySelectorAll('.mobilite-ratio-scalar .cahier-figure-scalar-label')]
        const column = document.querySelector(
          '.mobilite-section--stationnement-ravitaillement [data-column="ravitaillement"]')
        const legendLabels = (scope) => [...(scope?.querySelectorAll('.cahier-figure-legend-label') ?? [])]
          .map((label) => label.textContent.trim())
        const fillOf = (element) => element ? getComputedStyle(element).fill : null
        const bar = column?.querySelector('rect[data-category="charging"]')
        const comparedBar = (category) => column?.querySelector(`rect[data-comparison="${category}"]`)
        const probeColor = (value) => {
          const host = column ?? document.body
          const probe = document.createElement('span')
          probe.style.color = value
          host.append(probe)
          const resolved = getComputedStyle(probe).color
          probe.remove()
          return resolved
        }
        return {
          aedar: aedarCaption ? { ...styleOf(aedarCaption), text: aedarCaption.textContent } : null,
          ratios: ratioCaptions.map((caption) => ({ ...styleOf(caption), text: caption.textContent })),
          brand: probeColor('var(--brand-500)'),
          car: probeColor('var(--cahier-mode-car)'),
          chargingBar: fillOf(bar),
          fuelBar: fillOf(column?.querySelector('rect[data-category="fuel-stations"]')),
          chargingCompared: fillOf(comparedBar('charging')),
          fuelCompared: fillOf(comparedBar('fuel-stations')),
          reseauxLegend: legendLabels(document.querySelector('.mobilite-section--reseaux')),
          stationnementLegend: legendLabels(document.querySelector(
            '.mobilite-section--stationnement-ravitaillement [data-column="stationnement"]')),
          ravitaillementLegend: legendLabels(column),
          aria: column?.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? null,
        }
      })
      assert(captionIdentity.aedar, `AEDAR scalar caption must render at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert.equal(captionIdentity.ratios.length, 2,
        `Both page-2 ratio captions must render at ${width}px: ${JSON.stringify(captionIdentity)}`)
      for (const caption of captionIdentity.ratios) {
        assert.equal(caption.textTransform, 'uppercase',
          `Page-2 ratio caption must render uppercase at ${width}px: ${JSON.stringify(caption)}`)
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform']) {
          assert.equal(caption[property], captionIdentity.aedar[property],
            `Page-2 ratio caption ${property} must match the AEDAR scalar caption at ${width}px: ${JSON.stringify({ caption, aedar: captionIdentity.aedar })}`)
        }
      }
      assert.equal(captionIdentity.chargingBar, captionIdentity.brand,
        `Charging bar must use the app brand ink at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert.equal(captionIdentity.fuelBar, captionIdentity.car,
        `Fuel-station bar must use the existing car ink at ${width}px: ${JSON.stringify(captionIdentity)}`)
      // #988 — the x axis names every category, so the page-2 legends keep only
      // the drawn cycling segment series and the comparison reference. The
      // category inks above stay on the drawn bars, never in a repeated key.
      assert.deepEqual(captionIdentity.reseauxLegend,
        ['Réseau cyclable protégé', 'Réseau cyclable partagé', 'Groupe comparé'],
        `The network legend must keep only the two cycling segments and the comparison at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert.deepEqual(captionIdentity.stationnementLegend, ['Groupe comparé'],
        `The parking legend must keep only the comparison key at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert.deepEqual(captionIdentity.ravitaillementLegend, ['Groupe comparé'],
        `The refuelling legend must keep only the comparison key at ${width}px: ${JSON.stringify(captionIdentity)}`)
      const renderedFills = [
        captionIdentity.chargingBar, captionIdentity.fuelBar,
        captionIdentity.chargingCompared, captionIdentity.fuelCompared,
      ]
      assert(renderedFills.every(Boolean),
        `Both focal and compared fills must be drawn at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert.equal(new Set(renderedFills).size, 4,
        `The two focal fills and their compared washes must be four distinct rendered RGBA values at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert.notEqual(captionIdentity.chargingCompared, captionIdentity.chargingBar,
        `The charging compared wash must differ from its focal fill at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert.notEqual(captionIdentity.fuelCompared, captionIdentity.fuelBar,
        `The fuel-station compared wash must differ from its focal fill at ${width}px: ${JSON.stringify(captionIdentity)}`)
      assert(captionIdentity.aria?.includes('Bornes de recharge') && captionIdentity.aria?.includes('Stations-service'),
        `The factual category names must stay in the accessible reading at ${width}px: ${JSON.stringify(captionIdentity)}`)

      const hitbox = (index) => page.locator(
        '.mobilite-section--stationnement-ravitaillement [data-column="ravitaillement"] .mobilite-comparison-bars__hitbox').nth(index)
      const markerInk = async (index) => {
        await hitbox(index).focus()
        const ink = await page.evaluate(() => {
          const marker = document.querySelector(
            '.mobilite-section--stationnement-ravitaillement [data-column="ravitaillement"] .mobilite-comparison-bars__tooltip .cahier-figure-tooltip-marker')
          return marker ? getComputedStyle(marker).backgroundColor : null
        })
        await hitbox(index).press('Escape')
        return ink
      }
      assert.equal(await markerInk(0), captionIdentity.brand,
        `Charging tooltip marker must use the app brand ink at ${width}px`)
      assert.equal(await markerInk(1), captionIdentity.car,
        `Fuel-station tooltip marker must use the existing car ink at ${width}px`)
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

    // #974 — the page-2 paired ratios now carry the AEDAR scalar anatomy. Their
    // operator line, value, caption and reference must stay inside the paper
    // and on one line at every width, never widening the section.
    await page.evaluate(() => {
      const app = document.querySelector('#app')
      if (app && getComputedStyle(app).display !== 'none') app.style.display = 'none'
      const root = document.createElement('div')
      root.id = 'mobilite-ratio-layout-fixture'
      root.style.marginInline = 'var(--grid-margin-mobile)'
      document.body.append(root)
    })
    await page.evaluate(async ({ baseUrl, content, pagination }) => {
      const fixture = await import(new URL('src/__tests__/helpers/mobileCahierBrowserFixture.ts', baseUrl).href)
      const root = document.querySelector('#mobilite-ratio-layout-fixture')
      if (!root) throw new Error('Mobilité ratio fixture root was not mounted')
      await fixture.mountPlainCahier(root, content, pagination)
    }, { baseUrl, content: plainContent, pagination: plainPagination })
    const ratioScalars = await page.evaluate(() => {
      const host = document.querySelector('#mobilite-ratio-layout-fixture')
      if (!host) throw new Error('Mobilité ratio fixture root disappeared')
      const bounds = (element) => {
        const { left, right, top, bottom, width } = element.getBoundingClientRect()
        return { left, right, top, bottom, width }
      }
      const hostBounds = bounds(host)
      return {
        scalars: [...host.querySelectorAll('.mobilite-ratio-scalar')].map((scalar) => {
          const scalarBounds = bounds(scalar)
          const parts = [...scalar.querySelectorAll('[data-ratio-part]')].map(bounds)
          const value = scalar.querySelector('.cahier-figure-scalar-value')
          const label = scalar.querySelector('.cahier-figure-scalar-label')
          const reference = scalar.querySelector('.cahier-figure-scalar-reference')
          return {
            column: scalar.closest('[data-column]')?.getAttribute('data-column') ?? null,
            partKeys: [...scalar.querySelectorAll('[data-ratio-part]')]
              .map((part) => part.getAttribute('data-ratio-part')),
            partsOnOneLine: parts.every((part) => Math.abs(part.top - parts[0].top) <= 1),
            partsInside: parts.every((part) =>
              part.left >= scalarBounds.left - 1 && part.right <= scalarBounds.right + 1),
            valueInside: !value || (bounds(value).left >= scalarBounds.left - 1 &&
              bounds(value).right <= scalarBounds.right + 1),
            labelInside: !label || (bounds(label).left >= hostBounds.left - 1 &&
              bounds(label).right <= hostBounds.right + 1),
            referenceInside: !reference || (bounds(reference).left >= hostBounds.left - 1 &&
              bounds(reference).right <= hostBounds.right + 1),
            scrollOverflow: scalar.scrollWidth > scalar.clientWidth + 1,
          }
        }),
      }
    })
    assert.equal(ratioScalars.scalars.length, 2,
      `Both page-2 ratio scalars must render at ${width}px: ${JSON.stringify(ratioScalars)}`)
    assert.deepEqual(ratioScalars.scalars.map((scalar) => scalar.partKeys),
      [['bike', 'divide', 'car'], ['charging', 'divide', 'fuel']],
      `The ratio operator anatomy must keep its reading order at ${width}px: ${JSON.stringify(ratioScalars)}`)
    for (const scalar of ratioScalars.scalars) {
      assert(scalar.partsOnOneLine && scalar.partsInside &&
        scalar.valueInside && scalar.labelInside && scalar.referenceInside && !scalar.scrollOverflow,
      `Page-2 ratio scalar ${scalar.column} must stay inside the paper at ${width}px: ${JSON.stringify(scalar)}`)
    }

    reports.push({
      width,
      ...metrics,      w3: w3Summary,
      cartographicMapChipInteraction,
      waffleLegendInteraction,
      mobileIndexInteraction,
      accessRampLongYAxisFigure,
      sandboxGroupedBarFigure,
      otherCartesianFigureRails,
      plainMarginLayout,
      oversizedMutationDetected,
      readCalls: {
        retiredThemeFactsRoutes: readCalls.retiredThemeFactsRoutes,
        themeBatches: readCalls.themeBatches,
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
    fixture: 'checked-in Rennes reference/artifact for offline content + synthetic contract-valid semantic read-batch scenario (theme facts via /api/resources/read-batch since #868; not published facts)',
    evidenceDir,
    reports,
  }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
