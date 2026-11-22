// #1093 â€” visual-gate evidence capture for the shared editorial page shell.
// Derived from scripts/verify-mobile-cahier-overflow.mjs: its Vite server,
// semantic-API fixture routing and deterministic MobilitÃ© content are reused
// verbatim so before and after receipts are comparable. It screenshots the
// production Mobilite cahier and /atelier at desktop and phone widths and prints
// computed-style receipts for the page ground, heading, rule and prose.
// Run from app/: EDITORIAL_EVIDENCE_DIR=<dir> node scripts/capture-editorial-shell.mjs

import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { execFileSync } from 'node:child_process'
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
// Optional review baseline: load only the historical shell, in memory. No
// checkout/reset, dependency links, live writes or second worktree are needed.
const receiptBaseline = process.env.CAHIER_RECEIPT_BASELINE_REF

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
  plugins: receiptBaseline ? [{
    name: 'cahier-extraction-review-baseline', enforce: 'pre',
    load(id) {
      if (id.replaceAll('\\', '/').endsWith('/src/fiche/prototype/VarianteCahierLibre.vue')) {
        return execFileSync('git', ['show', `${receiptBaseline}:app/src/fiche/prototype/VarianteCahierLibre.vue`],
          { cwd: repoRoot, encoding: 'utf8' })
      }
    },
  }] : [],
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
  const outDir = resolve(process.env.EDITORIAL_EVIDENCE_DIR ?? join(tmpdir(), 'editorial-shell-evidence'))
  await mkdir(outDir, { recursive: true })
  const widths = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ]
  for (const viewport of widths) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => console.error(`[pageerror ${viewport.name}]`, error))
    await installApiRoutes(page, makeApiHandlers({
      catalogue: () => nativeCatalogueResponse(),
      resourceKind,
      themeBatch: themeBatchResponse,
      aedarBatch: aedarBatchResponse,
      familyForResource: nativePublicationFamily,
      readCalls: { retiredThemeFactsRoutes: 0, themeBatches: 0, aedarBatches: 0,
        aedarSummaryBatches: 0, aedarSummaryTargets: [], aedarComparisonBatches: 0, aedarItems: [] },
    }))
    await page.goto(`${baseUrl}territoire/commune/35238?theme=mobilite`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await page.screenshot({ path: resolve(outDir, `cahier-${viewport.name}.png`), fullPage: true })
    const shell = await page.evaluate(() => {
      const pick = (selector, props) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const s = getComputedStyle(el)
        return Object.fromEntries(props.map((p) => [p, s[p]]))
      }
      return {
        paperVar: getComputedStyle(document.querySelector('.cahier')).getPropertyValue('--paper').trim(),
        page: pick('.cahier-page', ['backgroundColor', 'backgroundImage', 'borderBottomColor', 'paddingLeft']),
        heading: pick('.cahier-page .page-heading h2', ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'textAlign']),
        rule: pick('.cahier-page .page-heading', ['borderBottomWidth', 'borderBottomStyle', 'borderBottomColor']),
        prose: pick('.cahier-page .argument-copy', ['fontSize', 'textAlign', 'color']),
      }
    })
    console.log(`CAHIER ${viewport.name}: ${JSON.stringify(shell)}`)
    await page.close()

    const atelier = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 })
    await atelier.goto(`${baseUrl}atelier`, { waitUntil: 'networkidle' })
    await atelier.waitForTimeout(400)
    await atelier.screenshot({ path: resolve(outDir, `atelier-${viewport.name}.png`), fullPage: true })
    const atelierShell = await atelier.evaluate(() => {
      const pick = (selector, props) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const s = getComputedStyle(el)
        return Object.fromEntries(props.map((p) => [p, s[p]]))
      }
      return {
        paperVar: getComputedStyle(document.querySelector('.atelier')).getPropertyValue('--paper').trim(),
        page: pick('.atelier-page', ['backgroundColor', 'backgroundImage', 'borderBottomColor', 'paddingLeft']),
        heading: pick('.atelier-titre', ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'textAlign']),
        rule: pick('.atelier-entete', ['borderBottomWidth', 'borderBottomStyle', 'borderBottomColor']),
        prose: pick('.atelier-md', ['fontSize', 'textAlign', 'color']),
      }
    })
    console.log(`ATELIER ${viewport.name}: ${JSON.stringify(atelierShell)}`)

    // Prose receipt: add one reader paragraph through the UI and read the
    // rendered cahier prose style (the blank page has no prose to measure).
    await atelier.getByRole('button', { name: 'Ajouter un texte' }).click()
    await atelier.locator('textarea').fill('Un paragraphe de démonstration pour la recette de prose.')
    await atelier.getByRole('button', { name: 'Enregistrer le texte' }).click()
    const atelierProse = await atelier.evaluate(() => {
      const el = document.querySelector('.cahier-prose.argument-copy.atelier-md')
      if (!el) return null
      const s = getComputedStyle(el)
      return { fontSize: s.fontSize, textAlign: s.textAlign, color: s.color, width: s.width }
    })
    console.log(`ATELIER-PROSE ${viewport.name}: ${JSON.stringify(atelierProse)}`)
    await atelier.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
