import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchAedarAggregates } from '@/fiche/content/aedarApiClient'
import type { AedarSummaryFetchResult } from '@/fiche/content/aedarApiClient'
import { fetchAedarComparison } from '@/fiche/content/aedarComparisonClient'
import { AEDAR_EQUIPMENT_QUANTILE_STATISTICS } from '@/fiche/content/aedarTimeRampFacts'
import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import type { ControleComparaison } from '@/fiche/comparisonContext'
import type { ContentEvidence } from '@/fiche/content/themeContent'
import type { Payload } from '@/payload/types'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { CAHIER_SECTION_RENDERERS } from '@/fiche/prototype/cahierSectionRenderers'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import type { CahierFigureProjection } from '@/fiche/prototype/cahierExportAdapters'
import CahierGroupedVerticalBarChart from '@/fiche/prototype/CahierGroupedVerticalBarChart.vue'
import CahierMapPanel from '@/fiche/prototype/CahierMapPanel.vue'
import ProductionMobiliteAedar from '@/fiche/mobilite/ProductionMobiliteAedar.vue'
import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { territoiresFixture } from '@/payload/fixtures'
import { routes } from '@/router'
import { carInlineLegend } from './fixtures/aedar-car-inline-legend'
import {
  aedarReadyFixtures,
  cahierExportFixture,
  readyLossMetadata,
  regionMobiliteContent,
} from './helpers/cahierExportFixtures'

vi.mock('@/fiche/content/aedarApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/fiche/content/aedarApiClient')>()
  return { ...actual, fetchAedarAggregates: vi.fn() }
})

vi.mock('@/fiche/content/aedarComparisonClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/fiche/content/aedarComparisonClient')>()
  return { ...actual, fetchAedarComparison: vi.fn() }
})

const aedarSourceFields = {
  source_id: 'aedar_bretagne',
  vintage_id: 'test',
  source_url: 'https://example.test/aedar',
  licence: 'Licence Ouverte',
  attribution: 'AEDAR',
  reference_date: '2026-01-01',
  publication_date: '2026-09-30',
}

function aggregatesFor(
  typequ: string,
  overrides: {
    source_id?: string
    vintage_id?: string
    reference_date?: string | null
    publication_date?: string | null
    coverage_status?: string
    measures?: Record<string, number | null>
  } = {},
) {
  return {
    status: 'ready' as const,
    contentVersion: 'facts',
    referenceContentVersion: 'reference',
    provenance: { contentVersion: 'facts', sources: [aedarSourceFields] },
    facts: [{
      territory_id: '22001',
      territory_type: 'commune' as const,
      typequ,
      typequ_label: typequ === 'B202' ? 'Équipement bis' : 'Équipement test',
      identity: {},
      n_addresses: 100,
      n_observed: 100,
      coverage_status: 'covered',
      measures: { count_15_car_mean: 4, count_20_car_mean: 6 },
      ...aedarSourceFields,
      ...overrides,
    }],
  }
}

interface CahierExportSeam {
  captureSection(sectionKey: string): CahierExportCapture | null
  captureAll(): readonly CahierExportCapture[]
  captureSectionKeys(): readonly string[]
}

function seamOf(wrapper: VueWrapper): CahierExportSeam {
  return wrapper.vm as unknown as CahierExportSeam
}

/**
 * Fixture shaping: place a served comparison reference on every Mobilité bar
 * value so the real legend toggle exists (its visibility is the owner state we
 * capture). The reference is fixture data, never a browser-side statistic.
 */
function shapeBarReferences(
  content: ReturnType<typeof cahierExportFixture>['content'],
  mode: 'served' | 'none',
) {
  const withReference = <T extends { fact: { value: number | null } }>(value: T): T => ({
    ...value,
    fact: {
      ...value.fact,
      comparison: mode === 'served'
        ? {
          direction: 'plus-est-mieux' as const,
          scope: { kind: 'communes-bretagne' as const, label: 'communes bretonnes' },
          rank: null,
          reference: { kind: 'median' as const, value: value.fact.value ?? 1 },
        }
        : null,
    },
  })
  const figure = <T extends { categories: readonly any[] }>(bars: T): T => ({
    ...bars,
    categories: bars.categories.map((category: any) => ({
      ...category,
      value: withReference(category.value),
      segments: category.segments.map((segment: any) => ({ ...segment, value: withReference(segment.value) })),
    })),
  })
  const units = content.units.map((unit) => ({
    ...unit,
    sections: unit.sections.map((section: any) => {
      if (section.evidence?.kind === 'mobilite-networks') {
        return { ...section, evidence: { ...section.evidence, figure: figure(section.evidence.figure) } }
      }
      if (section.evidence?.kind === 'mobilite-stationnement-ravitaillement') {
        return {
          ...section,
          evidence: {
            ...section.evidence,
            columns: section.evidence.columns.map((column: any) => ({ ...column, bars: figure(column.bars) })),
          },
        }
      }
      return section
    }),
  }))
  return { ...content, units } as unknown as ReturnType<typeof cahierExportFixture>['content']
}

/**
 * Fixture shaping: served ratio references on the paired scalars, independent
 * of the bars' own reference availability/toggle.
 */
function withServedRatioReferences(content: ReturnType<typeof cahierExportFixture>['content']) {
  const reference = {
    direction: 'plus-est-mieux' as const,
    scope: { kind: 'communes-bretagne' as const, label: 'communes bretonnes' },
    rank: null,
    reference: { kind: 'median' as const, value: 5 },
  }
  const units = content.units.map((unit) => ({
    ...unit,
    sections: unit.sections.map((section: any) => {
      if (section.evidence?.kind !== 'mobilite-stationnement-ravitaillement') return section
      return {
        ...section,
        evidence: {
          ...section.evidence,
          columns: section.evidence.columns.map((column: any) => ({
            ...column,
            ratio: {
              ...column.ratio,
              value: {
                ...column.ratio.value,
                fact: { ...column.ratio.value.fact, comparison: reference },
              },
            },
          })),
        },
      }
    }),
  }))
  return { ...content, units } as unknown as ReturnType<typeof cahierExportFixture>['content']
}

function comparisonEvidenceFor(
  measures: readonly string[],
  values: Readonly<Record<string, number>>,
) {
  return {
    label: 'Moyenne ? groupe test',
    contentVersion: 'facts',
    referenceContentVersion: 'reference',
    summaryContentVersion: 'summary',
    aedarContentVersion: 'facts',
    cells: measures.map((measure) => ({
      typequ: 'B207',
      measure,
      group_value: values[measure] ?? null,
      group_coverage_status: 'covered',
      group_n_addresses: 100,
      group_n_observed: 100,
      statistic: 'pooled' as const,
      ...aedarSourceFields,
    })),
  }
}

function mockGroupValues(values: Readonly<Record<string, number>>) {
  vi.mocked(fetchAedarComparison).mockImplementation(async (_type, _id, options) => ({
    status: 'ready',
    evidence: comparisonEvidenceFor(options?.measures ?? [], values),
  }) as never)
}

async function mountCahier(options: {
  content: ReturnType<typeof cahierExportFixture>['content']
  control?: ControleComparaison | null
  props?: Record<string, unknown>
}): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const global: Record<string, unknown> = { plugins: [router] }
  if (options.control) {
    global.provide = { [CONTROLE_COMPARAISON_KEY as symbol]: ref(options.control) }
  }
  const wrapper = mount(VarianteCahierLibre, {
    props: {
      content: options.content,
      pagination: cahierPaginationFor({} as Payload, options.content, true),
      showAllUnits: true,
      presentation: 'plain',
      layoutVariant: 'indexed-sections',
      aedarAccessEnabled: true,
      aedarChapterActive: false,
      aedarStatus: 'ready',
      comparisonStatus: 'ready',
      nativeComparisonStatus: 'ready',
      retryNativeComparison: () => {},
      retryComparison: () => {},
      ...options.props,
    },
    global,
  })
  await flushPromises()
  return wrapper
}

async function render(extra: Record<string, unknown> = {}, options: {
  barReferences?: 'served' | 'none'
  lossMetadata?: ReturnType<typeof readyLossMetadata>
  aedarReference?: 'sparse-car'
  explorerComparison?: boolean
  curveReference?: 'null'
  ratioReferences?: boolean
} = {}) {
  const { content, control } = cahierExportFixture({
    lossMetadata: options.lossMetadata,
    aedarReference: options.aedarReference,
    explorerComparison: options.explorerComparison,
    curveReference: options.curveReference,
  })
  const barsShaped = shapeBarReferences(content, options.barReferences ?? 'served')
  const themed = options.ratioReferences ? withServedRatioReferences(barsShaped) : barsShaped
  const controlRef = ref<ControleComparaison>(control)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const wrapper = mount(VarianteCahierLibre, {
    props: {
      content: themed,
      pagination: cahierPaginationFor({} as Payload, content, true),
      showAllUnits: true,
      presentation: 'plain',
      layoutVariant: 'indexed-sections',
      aedarAccessEnabled: true,
      aedarChapterActive: false,
      aedarStatus: 'ready',
      comparisonStatus: 'ready',
      nativeComparisonStatus: 'ready',
      retryNativeComparison: () => {},
      retryComparison: () => {},
      ...extra,
    },
    global: {
      plugins: [router],
      provide: { [CONTROLE_COMPARAISON_KEY as symbol]: controlRef },
    },
  })
  await flushPromises()
  return { wrapper, controlRef, content }
}

function sectionKeys(content: ReturnType<typeof cahierExportFixture>['content']): string[] {
  return content.units.flatMap((unit) => unit.sections.map((section) => section.key))
}

function captureOf(wrapper: VueWrapper, sectionKey: string): CahierExportCapture {
  const capture = seamOf(wrapper).captureSection(sectionKey)
  if (!capture) throw new Error(`No capture for ${sectionKey}`)
  return capture
}

function toggleByText(wrapper: VueWrapper, scope: string, label: string) {
  const button = wrapper
    .findAll(`${scope} .cahier-figure-legend-toggle`)
    .find((candidate) => candidate.text().includes(label))
  if (!button) throw new Error(`Toggle "${label}" missing inside ${scope}`)
  return button
}

function mapPanels(wrapper: VueWrapper, sectionKey: string) {
  return wrapper.findAllComponents(CahierMapPanel)
    .filter((panel) => panel.element.closest(`[data-section="${sectionKey}"]`))
}

async function mountProductionShell(options: {
  libelleActif?: string | null
  referenceStatus?: 'unavailable' | 'loading' | 'ready' | 'error'
  referenceData?: AedarSummaryFetchResult | null
} = {}): Promise<VueWrapper> {
  const { content } = cahierExportFixture()
  const { summary, detail } = aedarReadyFixtures()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const control = ref<ControleComparaison>({
    focal: territoiresFixture[0]!,
    territoires: territoiresFixture,
    selection: { etat: 'defaut' },
    libelleActif: options.libelleActif ?? null,
    presetDefaut: 'epci',
    presets: [],
    choisir: () => {},
  })
  const wrapper = mount(ProductionMobiliteAedar, {
    props: {
      content,
      pagination: cahierPaginationFor({} as Payload, content, true),
      aedarData: detail,
      aedarStatus: 'ready',
      retryAedar: () => {},
      aedarSummaryData: { status: 'ready', summary },
      aedarSummaryStatus: 'ready',
      retryAedarSummary: () => {},
      aedarReferenceTerritoire: { type: 'epci', id: '200000001', nom: 'EPCI test' },
      aedarReferenceData: options.referenceData ?? null,
      aedarReferenceStatus: options.referenceStatus ?? 'unavailable',
      aedarActive: false,
      nativeComparisonStatus: 'ready',
    },
    global: {
      plugins: [router],
      provide: { [CONTROLE_COMPARAISON_KEY as symbol]: control },
    },
  })
  await flushPromises()
  return wrapper
}

async function emitMap(panel: ReturnType<typeof mapPanels>[number], event: 'loaded' | 'unavailable') {
  panel.vm.$emit(event)
  await flushPromises()
}

describe('Cahier export capture — mounted shared path (#1021)', () => {
  beforeEach(() => {
    vi.mocked(fetchAedarAggregates).mockReset()
    vi.mocked(fetchAedarAggregates).mockImplementation(async (_type, _id, options) =>
      aggregatesFor(String(options?.typequ?.[0] ?? 'B207')) as never)
    vi.mocked(fetchAedarComparison).mockReset()
    vi.mocked(fetchAedarComparison).mockResolvedValue({ status: 'error', message: 'Lecture du groupe impossible' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('captures every mounted section through the same public venue', async () => {
    const { wrapper, content } = await render()
    const seam = seamOf(wrapper)
    expect(typeof seam.captureSection).toBe('function')
    expect(seam.captureSectionKeys()).toEqual(sectionKeys(content))
    const all = seam.captureAll()
    expect(all).toHaveLength(9)
    const families = new Set(all.map((capture) => capture.figures[0]?.family))
    const registeredKinds = Object.keys(CAHIER_SECTION_RENDERERS) as ContentEvidence['kind'][]
    expect(all.map((capture) => capture.identity.evidenceKind).sort())
      .toEqual([...registeredKinds].sort())
    expect(families).toEqual(new Set([
      'aedar-car-overview', 'aedar-diversity-loss', 'aedar-ramps', 'aedar-equipment-profile',
      'aedar-equipment-explorer', 'mobilite-bars', 'mobilite-share', 'mobilite-curve',
    ]))
    // One call crosses AEDAR, the Mobilité bars and page 3.
    expect(captureOf(wrapper, 'aedar-access').figures[0]?.family).toBe('aedar-ramps')
    expect(captureOf(wrapper, 'reseaux').figures[0]?.family).toBe('mobilite-bars')
    expect(captureOf(wrapper, 'visiter-la-bretagne').figures[0]?.family).toBe('mobilite-curve')
    wrapper.unmount()
  })

  it('projects every mounted capture through the shared family adapters', async () => {
    const { wrapper } = await render({ aedarChapterActive: true })
    const captures = seamOf(wrapper).captureAll()
    const projections = captures.flatMap((capture) => {
      const projected = projeterRequeteExport(capture, capture.capabilities.selectedSeries)
      expect(projected.status).toBe('ready')
      if (projected.status !== 'ready') return []
      return projeterRequeteExportFigures(projected.request)
    })
    expect(projections).toHaveLength(10)
    expect(new Set(projections.map((projection) => projection.family))).toEqual(new Set([
      'aedar-car-overview', 'aedar-diversity-loss', 'aedar-ramps', 'aedar-equipment-profile',
      'aedar-equipment-explorer', 'mobilite-bars', 'mobilite-share', 'mobilite-curve',
    ]))
    for (const projection of projections) {
      expect(projection.title).toBeTruthy()
      expect(projection.accessibleLabel).toBeTruthy()
    }
    const byFamily = <T extends CahierFigureProjection['family']>(family: T) =>
      projections.filter((projection): projection is Extract<CahierFigureProjection, { family: T }> =>
        projection.family === family)

    const ramps = byFamily('aedar-ramps')[0]!
    expect(ramps.ramps).toHaveLength(2)
    expect(ramps.tables.map((table) => table.key)).toEqual(['diversity', 'volume'])
    expect(ramps.ramps[0]?.series.find((series) => series.key === 'car')?.points[0])
      .toMatchObject({ cutKey: 5, value: 5, display: '5' })

    const overview = byFamily('aedar-car-overview')[0]!
    expect(overview.scalars.map((scalar) => [scalar.key, scalar.value, scalar.display]))
      .toEqual([['meanDiversity', 5, '5'], ['meanVolume', 5, '5']])
    expect(overview.tables[0]?.rows).toHaveLength(2)
    expect(overview.maps.status).toBeTruthy()

    const diversity = byFamily('aedar-diversity-loss')[0]!
    expect(diversity.tables).toEqual([])
    expect(diversity.maps.items.length).toBeGreaterThan(0)

    const profile = byFamily('aedar-equipment-profile')[0]!
    expect(profile.tables[0]?.columns.map((column) => column.key))
      .toEqual(['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'])
    expect(profile.summary).toBeTruthy()

    // The paired section contributes one projection per terrain, and the
    // quantile table carries the declared min/deciles/max categories.
    const explorer = byFamily('aedar-equipment-explorer')[0]!
    expect(explorer.distribution.figure.categories.map((category) => category.key)).toEqual(
      AEDAR_EQUIPMENT_QUANTILE_STATISTICS.map((statistic) => statistic.key),
    )
    expect(explorer.distribution.figure.xAxisTitle).toBeTruthy()
    expect(typeof explorer.distribution.figure.formatValue).toBe('function')
    expect(typeof explorer.distribution.figure.formatAriaValue).toBe('function')
    expect(explorer.tables.find((table) => table.key === 'volume')?.rows).toHaveLength(4)

    const bars = byFamily('mobilite-bars')
    expect(bars).toHaveLength(3)
    expect(bars.every((projection) => (projection.tables[0]?.rows.length ?? 0) > 0)).toBe(true)

    const share = byFamily('mobilite-share')[0]!
    expect(share.tables[0]?.rows).toHaveLength(1)
    expect(share.display).toMatch(/\d/u)

    const curve = byFamily('mobilite-curve')[0]!
    expect(curve.points).toHaveLength(11)
    expect(curve.tables[0]?.rows).toHaveLength(11)
    expect(curve.marker?.detail).toBe('t0090')

    wrapper.unmount()
  })

  it('keeps the mounted ramp tooltip on the exported readings and drops a hidden reference', async () => {
    const { wrapper } = await render(
      { comparisonStatus: 'idle' },
      { aedarReference: 'sparse-car' },
    )
    const capture = captureOf(wrapper, 'aedar-access')
    const projected = projeterRequeteExport(capture, capture.capabilities.selectedSeries)
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'aedar-ramps') throw new Error('ramps expected')
    expect(projection.comparisonDisplayed).toBe(true)

    const firstRamp = wrapper.findAll('[data-section="aedar-access"] .aedar-ramp')[0]!
    const cut = firstRamp.findAll('.access-ramp-cut-hitbox')
      .find((button) => button.attributes('aria-label')?.includes('15 min'))
    if (!cut) throw new Error('15 min cut missing')
    await cut.trigger('focus')
    const rows = firstRamp.findAll('.cahier-figure-tooltip-row')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const label = row.get('dt').text()
      const value = row.get('dd').text()
      const point = projection.ramps[0]?.series.find((series) => series.label === label)
        ?.points.find((candidate) => candidate.cutKey === 15)
      expect(point?.display).toBe(value)
      const comparison = row.find('.cahier-figure-tooltip-comparison-value')
      if (comparison.exists()) expect(point?.referenceDisplay).toBe(comparison.text())
    }
    // The mounted accessible label and the projection are built from the same
    // owner readings: both keep every visible mode and its unit.
    const aria = firstRamp.get('.access-ramp-svg').attributes('aria-label')!
    for (const series of projection.ramps[0]!.series) {
      expect(aria).toContain(`${series.label} :`)
    }

    const referenceToggle = wrapper
      .findAll('[data-section="aedar-access"] .aedar-access-mode-selector .cahier-figure-legend-toggle')
      .find((button) => button.attributes('aria-label')?.startsWith('Groupe comparé'))
    if (!referenceToggle) throw new Error('comparison toggle missing')
    await referenceToggle.trigger('click')
    await flushPromises()
    const hiddenCapture = captureOf(wrapper, 'aedar-access')
    const hiddenProjected = projeterRequeteExport(hiddenCapture, hiddenCapture.capabilities.selectedSeries)
    expect(hiddenProjected.status).toBe('ready')
    if (hiddenProjected.status !== 'ready') { wrapper.unmount(); return }
    const hidden = projeterRequeteExportFigures(hiddenProjected.request)[0]!
    if (hidden.family !== 'aedar-ramps') throw new Error('ramps expected')
    expect(hidden.comparisonDisplayed).toBe(false)
    expect(hidden.comparisonLabel).toBeNull()
    expect(hidden.tables[0]?.columns.every((column) => column.kind === 'focal')).toBe(true)
    expect(hidden.ramps[0]?.series.every((series) =>
      series.points.every((point) => point.referenceValue === null && point.referenceRank === null))).toBe(true)
    await cut.trigger('focus')
    expect(firstRamp.find('.cahier-figure-tooltip-row-comparison').exists()).toBe(false)
    wrapper.unmount()
  })

  it('never captures a section whose evidence placeholder is the rendered body', async () => {
    const { wrapper } = await render({ aedarAccessEnabled: false })
    const seam = seamOf(wrapper)
    const keys = seam.captureSectionKeys()
    expect(keys).not.toContain('aedar-access')
    expect(keys).toContain('reseaux')
    expect(seam.captureSection('aedar-access')).toBeNull()
    wrapper.unmount()
  })

  it('captures the equipment, horizon and modes the reader really chose', async () => {
    const { wrapper } = await render()
    await wrapper.get('[data-section="aedar-equipment-profile"] .aedar-waffle-horizon button[aria-label="20 minutes"]')
      .trigger('click')
    toggleByText(wrapper, '[data-section="aedar-access"] .aedar-access-mode-selector', 'À pied').trigger('click')
    await flushPromises()

    const access = captureOf(wrapper, 'aedar-access')
    const ramps = access.figures[0]
    if (!ramps || ramps.family !== 'aedar-ramps') throw new Error('ramps expected')
    expect(access.aedar).toMatchObject({ horizonMinutes: 20 })
    expect(ramps.effective.modes).toContain('walk')

    const profile = captureOf(wrapper, 'aedar-equipment-profile').figures[0]
    if (!profile || profile.family !== 'aedar-equipment-profile') throw new Error('profile expected')
    expect(profile.effective.horizonMinutes).toBe(20)

    const explorer = captureOf(wrapper, 'aedar-equipment-explorer').figures[0]
    if (!explorer || explorer.family !== 'aedar-equipment-explorer') throw new Error('explorer expected')
    expect(explorer.effective.horizonMinutes).toBe(20)
    expect(explorer.effective.modes).toContain('walk')
    wrapper.unmount()
  })

  it('captures the real TYPEQU selection and its acquired detail', async () => {
    const { wrapper } = await render({ aedarChapterActive: true })
    await flushPromises()
    const before = captureOf(wrapper, 'aedar-equipment-explorer').figures[0]
    if (!before || before.family !== 'aedar-equipment-explorer') throw new Error('explorer expected')
    expect(before.effective).toMatchObject({ typequ: 'B207', detailStatus: 'ready' })
    expect(before.effective.selectedDetail?.measures).toMatchObject({ count_15_car_mean: 4 })

    await wrapper.get('[data-section="aedar-equipment-explorer"] .aedar-equipment-explorer-change').trigger('click')
    await flushPromises()
    const options = wrapper.findAll('[data-section="aedar-equipment-explorer"] .aedar-equipment-explorer-options button')
    const bis = options.find((option) => option.text().includes('B202'))
    if (!bis) throw new Error('Second Typequ missing')
    await bis.trigger('click')
    await flushPromises()

    const after = captureOf(wrapper, 'aedar-equipment-explorer').figures[0]
    if (!after || after.family !== 'aedar-equipment-explorer') throw new Error('explorer expected')
    expect(after.effective.typequ).toBe('B202')
    expect(after.effective.typequLabel).toBe('Équipement bis')
    expect(after.effective.selectedDetail?.typequ).toBe('B202')
    // The already-produced snapshot keeps the previous equipment.
    expect(before.effective.typequ).toBe('B207')
    expect(before.effective.selectedDetail?.typequ).toBe('B207')
    wrapper.unmount()
  })

  it('keeps the paired, networks and curve comparison layers independent', async () => {
    const { wrapper } = await render()
    toggleByText(wrapper, '[data-section="stationnement-ravitaillement"] [data-column="stationnement"]', 'Groupe comparé')
      .trigger('click')
    await flushPromises()

    const paired = captureOf(wrapper, 'stationnement-ravitaillement')
    const stationnement = paired.comparison.display.layers.find((entry) => entry.slot === 'stationnement')
    const ravitaillement = paired.comparison.display.layers.find((entry) => entry.slot === 'ravitaillement')
    expect(stationnement).toMatchObject({ toggle: false, referenceAvailable: true, displayed: false })
    expect(ravitaillement).toMatchObject({ toggle: true, referenceAvailable: true, displayed: true })
    expect(paired.comparison.display.state).toBe('displayed')
    expect(paired.comparison.display.reason).toBe('shown')

    toggleByText(wrapper, '[data-section="reseaux"] .mobilite-comparison-bars__legend', 'Groupe comparé').trigger('click')
    toggleByText(wrapper, '[data-section="visiter-la-bretagne"] .mobilite-raccordement-curve__legend', 'Groupe comparé')
      .trigger('click')
    await flushPromises()

    const networks = captureOf(wrapper, 'reseaux')
    expect(networks.comparison.display.layers[0]).toMatchObject({ toggle: false, displayed: false })
    expect(networks.comparison.display.reason).toBe('hidden-by-user')
    const curve = captureOf(wrapper, 'visiter-la-bretagne')
    expect(curve.comparison.display.layers[0]).toMatchObject({ toggle: false, displayed: false })
    expect(curve.comparison.display.reason).toBe('hidden-by-user')
    wrapper.unmount()
  })

  it('does not advertise a displayed comparison when no served reference exists', async () => {
    const { wrapper } = await render({}, { barReferences: 'none' })
    const networks = captureOf(wrapper, 'reseaux')
    expect(networks.comparison.status).toBe('ready')
    expect(networks.comparison.display.state).toBe('not-displayed')
    expect(networks.comparison.display.reason).toBe('no-served-reference')
    expect(networks.comparison.display.layers[0]).toMatchObject({
      toggle: true,
      referenceAvailable: false,
      displayed: false,
    })
    wrapper.unmount()
  })

  it('reports pending and unavailable comparison states without inventing proof', async () => {
    const loading = await render({ nativeComparisonStatus: 'loading' })
    const pendingCapture = captureOf(loading.wrapper, 'reseaux')
    expect(pendingCapture.comparison.status).toBe('loading')
    expect(pendingCapture.comparison.display.state).toBe('not-displayed')
    expect(pendingCapture.comparison.display.reason).toBe('loading')
    expect(pendingCapture.comparison.display.layers[0]?.displayed).toBe(false)
    loading.wrapper.unmount()

    const unavailable = await render({ nativeComparisonStatus: 'unavailable' })
    const unavailableCapture = captureOf(unavailable.wrapper, 'reseaux')
    expect(unavailableCapture.comparison.status).toBe('unavailable')
    expect(unavailableCapture.comparison.display.reason).toBe('unavailable')
    unavailable.wrapper.unmount()
  })

  it('captures the shared AEDAR reference visibility without touching it', async () => {
    const { wrapper } = await render()
    const before = captureOf(wrapper, 'aedar-access')
    expect(before.comparison.display.state).toBe('not-displayed')
    expect(before.comparison.display.reason).toBe('no-served-reference')
    const reference = wrapper
      .findAll('[data-section="aedar-access"] .aedar-access-mode-selector .cahier-figure-legend-toggle')
      .find((button) => button.attributes('aria-label')?.startsWith('Groupe comparé'))
    if (!reference) throw new Error('Reference toggle missing')
    await reference.trigger('click')
    await flushPromises()
    expect(captureOf(wrapper, 'aedar-access').comparison.display).toMatchObject({
      state: 'not-displayed',
      reason: 'hidden-by-user',
    })
    expect(captureOf(wrapper, 'aedar-equipment-explorer').comparison.display.reason).toBe('hidden-by-user')
    wrapper.unmount()
  })

  it('preserves an explorer comparison error and its loading state', async () => {
    const { wrapper } = await render({ aedarChapterActive: true }, { explorerComparison: true })
    await flushPromises()
    const error = captureOf(wrapper, 'aedar-equipment-explorer')
    expect(error.comparison.status).toBe('error')
    expect(error.comparison.display.state).toBe('not-displayed')
    expect(error.comparison.display.reason).toBe('error')
    wrapper.unmount()

    let resolveComparison: (value: unknown) => void = () => {}
    vi.mocked(fetchAedarComparison).mockReturnValue(new Promise((resolve) => {
      resolveComparison = resolve
    }) as never)
    const loading = await render({ aedarChapterActive: true }, { explorerComparison: true })
    const pending = captureOf(loading.wrapper, 'aedar-equipment-explorer')
    expect(pending.comparison.status).toBe('loading')
    expect(pending.comparison.display.reason).toBe('loading')
    resolveComparison({ status: 'error', message: 'fin' })
    await flushPromises()
    loading.wrapper.unmount()
  })

  it('keeps a direct-reference read failure distinct from a legitimate absence', async () => {
    const direct = await render({ aedarReferenceStatus: 'error', comparisonStatus: 'idle' })
    const capture = captureOf(direct.wrapper, 'aedar-access')
    expect(capture.comparison.status).toBe('idle')
    expect(capture.comparison.referenceStatus).toBe('error')
    expect(capture.comparison.display.state).toBe('not-displayed')
    expect(capture.comparison.display.reason).toBe('error')
    direct.wrapper.unmount()

    const wrapper = await mountProductionShell({ referenceStatus: 'error' })
    expect(wrapper.text()).toContain('Groupe comparé indisponible')
    const shell = wrapper.getComponent(VarianteCahierLibre)
    expect(shell.props('aedarReferenceStatus')).toBe('error')
    wrapper.unmount()
  })

  it('reports a ready direct reference and matches the displayed overview scalars', async () => {
    const { summary } = aedarReadyFixtures()
    const production = await mountProductionShell({
      referenceStatus: 'ready',
      referenceData: { status: 'ready', summary },
    })
    const productionShell = production.getComponent(VarianteCahierLibre)
    expect(productionShell.props('comparisonStatus')).toBe('idle')
    expect(productionShell.props('aedarReferenceStatus')).toBe('ready')
    expect(production.find('[data-section="aedar-car-overview"] .cahier-comparison-value').exists()).toBe(true)
    production.unmount()

    // The same shared state captured from the shell: comparison idle, reference
    // ready, and the overview scalar reference is actually drawn.
    const { wrapper } = await render({ comparisonStatus: 'idle' }, { aedarReference: 'sparse-car' })
    expect(wrapper.find('[data-section="aedar-car-overview"] .cahier-comparison-value').exists()).toBe(true)
    const overview = captureOf(wrapper, 'aedar-car-overview')
    expect(overview.comparison.status).toBe('idle')
    expect(overview.comparison.referenceStatus).toBe('unobserved')
    expect(overview.comparison.display.state).toBe('displayed')
    expect(overview.comparison.display.reason).toBe('shown')
    expect(overview.comparison.display.layers[0]).toMatchObject({
      referenceAvailable: true,
      visibleReferenceAvailable: true,
      displayed: true,
    })
    wrapper.unmount()
  })

  it('keeps overview pending, error, empty and ineligible states honest', async () => {
    const error = await render({ aedarReferenceStatus: 'error', comparisonStatus: 'idle' })
    const errorCapture = captureOf(error.wrapper, 'aedar-car-overview')
    expect(errorCapture.comparison.referenceStatus).toBe('error')
    expect(errorCapture.comparison.display.reason).toBe('error')
    expect(error.wrapper.find('[data-section="aedar-car-overview"] .cahier-comparison-value').exists()).toBe(false)
    error.wrapper.unmount()

    const loading = await render({ aedarReferenceStatus: 'loading', comparisonStatus: 'idle' })
    expect(captureOf(loading.wrapper, 'aedar-car-overview').comparison.display.reason).toBe('loading')
    loading.wrapper.unmount()

    const emptyFixture = cahierExportFixture({
      selection: { etat: 'vide' },
      aedarReference: 'sparse-car',
    })
    const empty = await mountCahier({
      content: emptyFixture.content,
      control: emptyFixture.control,
      props: { comparisonStatus: 'idle' },
    })
    const emptyCapture = captureOf(empty, 'aedar-car-overview')
    expect(emptyCapture.comparison.selection.state).toBe('vide')
    expect(emptyCapture.comparison.display.state).toBe('not-displayed')
    expect(emptyCapture.comparison.display.reason).toBe('empty-selection')
    empty.unmount()

    const profileFixture = await render()
    expect(captureOf(profileFixture.wrapper, 'aedar-equipment-profile').comparison.referenceStatus).toBeNull()
    profileFixture.wrapper.unmount()
  })

  it('keeps explorer rendered references and captured display in parity', async () => {
    const cases: readonly {
      label: string
      overrides: Parameters<typeof aggregatesFor>[1]
      displayed: boolean
    }[] = [
      { label: 'valid direct reference', overrides: {}, displayed: true },
      { label: 'source id mismatch', overrides: { source_id: 'other' }, displayed: false },
      { label: 'vintage mismatch', overrides: { vintage_id: 'other' }, displayed: false },
      { label: 'reference date mismatch', overrides: { reference_date: '2026-02-01' }, displayed: false },
      { label: 'publication date mismatch', overrides: { publication_date: '2026-10-01' }, displayed: false },
      { label: 'uncovered reference', overrides: { coverage_status: 'uncovered' }, displayed: false },
      { label: 'null reference measures', overrides: { measures: {} }, displayed: false },
    ]
    for (const scenario of cases) {
      vi.mocked(fetchAedarAggregates).mockImplementation(async (_type, _id, options) =>
        aggregatesFor(String(options?.typequ?.[0] ?? 'B207'), scenario.overrides) as never)
      const { wrapper } = await render({ aedarChapterActive: true }, { aedarReference: 'sparse-car' })
      await flushPromises()
      const rendered = wrapper.findAll(
        '[data-section="aedar-equipment-explorer"] .access-ramp-line--comparison',
      ).length > 0
      const explorer = captureOf(wrapper, 'aedar-equipment-explorer')
      expect({ scenario: scenario.label, rendered }).toEqual({
        scenario: scenario.label,
        rendered: scenario.displayed,
      })
      expect({ scenario: scenario.label, captured: explorer.comparison.display.state }).toEqual({
        scenario: scenario.label,
        captured: scenario.displayed ? 'displayed' : 'not-displayed',
      })
      expect(explorer.comparison.display.layers[0]).toMatchObject({
        referenceAvailable: scenario.displayed,
        visibleReferenceAvailable: scenario.displayed,
        displayed: scenario.displayed,
      })
      wrapper.unmount()
    }
  })

  it('matches a ready group reference rendered and captured for the explorer', async () => {
    vi.mocked(fetchAedarComparison).mockResolvedValue({
      status: 'ready',
      evidence: {
        label: 'Moyenne — groupe test',
        contentVersion: 'facts',
        referenceContentVersion: 'reference',
        summaryContentVersion: 'summary',
        aedarContentVersion: 'facts',
        cells: [{
          typequ: 'B207',
          measure: 'count_15_car_mean',
          group_value: 4,
          group_coverage_status: 'covered',
          group_n_addresses: 100,
          group_n_observed: 100,
          statistic: 'pooled',
          ...aedarSourceFields,
        }],
      },
    })
    const { wrapper } = await render({ aedarChapterActive: true }, { explorerComparison: true })
    await flushPromises()
    const rendered = wrapper.findAll(
      '[data-section="aedar-equipment-explorer"] .access-ramp-line--comparison',
    ).length > 0
    expect(rendered).toBe(true)
    const explorer = captureOf(wrapper, 'aedar-equipment-explorer')
    expect(explorer.comparison.display.state).toBe('displayed')
    expect(explorer.comparison.display.layers[0]).toMatchObject({
      referenceAvailable: true,
      visibleReferenceAvailable: true,
      displayed: true,
    })
    wrapper.unmount()
  })

  it('does not report a displayed reference when the selected modes hide it', async () => {
    const { wrapper } = await render({ aedarChapterActive: true }, { aedarReference: 'sparse-car' })
    await flushPromises()
    const before = captureOf(wrapper, 'aedar-access')
    expect(before.comparison.display.state).toBe('displayed')
    expect(before.comparison.display.layers[0]).toMatchObject({
      referenceAvailable: true,
      visibleReferenceAvailable: true,
      displayed: true,
    })
    expect(captureOf(wrapper, 'aedar-equipment-explorer').comparison.display.state).toBe('displayed')
    const projected = projeterRequeteExport(before, ['car'])
    if (projected.status !== 'ready') throw new Error('projection expected')
    const projectedSnapshot = JSON.stringify(projected.request)
    const beforeSnapshot = JSON.stringify(before)

    toggleByText(wrapper, '[data-section="aedar-access"] .aedar-access-mode-selector', 'Voiture').trigger('click')
    await flushPromises()
    const hidden = captureOf(wrapper, 'aedar-access')
    expect(hidden.comparison.display.state).toBe('not-displayed')
    expect(hidden.comparison.display.reason).toBe('hidden-by-selection')
    expect(hidden.comparison.display.layers[0]).toMatchObject({
      referenceAvailable: true,
      visibleReferenceAvailable: false,
      displayed: false,
    })
    const explorerHidden = captureOf(wrapper, 'aedar-equipment-explorer')
    expect(explorerHidden.comparison.display.state).toBe('not-displayed')
    expect(explorerHidden.comparison.display.reason).toBe('hidden-by-selection')
    expect(JSON.stringify(projected.request)).toBe(projectedSnapshot)
    expect(JSON.stringify(before)).toBe(beforeSnapshot)

    toggleByText(wrapper, '[data-section="aedar-access"] .aedar-access-mode-selector', 'Voiture').trigger('click')
    await flushPromises()
    expect(captureOf(wrapper, 'aedar-access').comparison.display.state).toBe('displayed')
    expect(captureOf(wrapper, 'aedar-equipment-explorer').comparison.display.state).toBe('displayed')
    wrapper.unmount()
  })

  it('matches an empty served curve reference rendered and captured', async () => {
    const valid = await render()
    const validCurve = captureOf(valid.wrapper, 'visiter-la-bretagne')
    expect(validCurve.comparison.display.state).toBe('displayed')
    expect(valid.wrapper.find(
      '[data-section="visiter-la-bretagne"] .mobilite-raccordement-curve__comparison',
    ).exists()).toBe(true)
    valid.wrapper.unmount()

    const { wrapper } = await render({}, { curveReference: 'null' })
    const empty = captureOf(wrapper, 'visiter-la-bretagne')
    expect(wrapper.find(
      '[data-section="visiter-la-bretagne"] .mobilite-raccordement-curve__comparison',
    ).exists()).toBe(false)
    expect(empty.comparison.display.state).toBe('not-displayed')
    expect(empty.comparison.display.reason).toBe('no-served-reference')
    expect(empty.comparison.display.layers[0]).toMatchObject({
      referenceAvailable: false,
      visibleReferenceAvailable: false,
      displayed: false,
    })
    wrapper.unmount()
  })

  it('keeps explorer ramp and distribution reference evidence in parity', async () => {
    const scenarios: readonly {
      label: string
      values: Readonly<Record<string, number>>
      ramp: boolean
      distribution: boolean
      displayed: boolean
    }[] = [
      {
        label: 'mean only',
        values: { count_15_car_mean: 4 },
        ramp: true,
        distribution: false,
        displayed: true,
      },
      {
        label: 'distribution only',
        values: { count_15_car_decile5: 3 },
        ramp: false,
        distribution: true,
        displayed: true,
      },
      {
        label: 'both surfaces',
        values: { count_15_car_mean: 4, count_15_car_decile5: 3 },
        ramp: true,
        distribution: true,
        displayed: true,
      },
      {
        label: 'neither surface',
        values: {},
        ramp: false,
        distribution: false,
        displayed: false,
      },
    ]
    for (const scenario of scenarios) {
      mockGroupValues(scenario.values)
      const { wrapper } = await render({ aedarChapterActive: true }, { explorerComparison: true })
      await flushPromises()
      const rampRendered = wrapper.findAll(
        '[data-section="aedar-equipment-explorer"] .access-ramp-line--comparison',
      ).length > 0
      const distributionRendered = wrapper.findAll(
        '[data-section="aedar-equipment-explorer"] .cahier-grouped-vertical-bar-chart__bar[fill*="45%"]',
      ).length > 0
      const explorer = captureOf(wrapper, 'aedar-equipment-explorer')
      expect({ scenario: scenario.label, ramp: rampRendered, distribution: distributionRendered }).toEqual({
        scenario: scenario.label,
        ramp: scenario.ramp,
        distribution: scenario.distribution,
      })
      expect({ scenario: scenario.label, captured: explorer.comparison.display.state }).toEqual({
        scenario: scenario.label,
        captured: scenario.displayed ? 'displayed' : 'not-displayed',
      })
      wrapper.unmount()
    }
  })

  it('honours the distribution reference horizon, selected modes and toggle', async () => {
    mockGroupValues({ count_15_car_decile5: 3 })
    const { wrapper } = await render({ aedarChapterActive: true }, { explorerComparison: true })
    await flushPromises()
    const distributionBars = () => wrapper.findAll(
      '[data-section="aedar-equipment-explorer"] .cahier-grouped-vertical-bar-chart__bar[fill*="45%"]',
    ).length
    expect(distributionBars()).toBeGreaterThan(0)
    expect(captureOf(wrapper, 'aedar-equipment-explorer').comparison.display.state).toBe('displayed')
    const projected = projeterRequeteExport(captureOf(wrapper, 'aedar-equipment-explorer'), ['car'])
    if (projected.status !== 'ready') throw new Error('projection expected')
    const snapshot = JSON.stringify(projected.request)

    await wrapper
      .get('[data-section="aedar-equipment-profile"] .aedar-waffle-horizon button[aria-label="20 minutes"]')
      .trigger('click')
    await flushPromises()
    expect(distributionBars()).toBe(0)
    const offHorizon = captureOf(wrapper, 'aedar-equipment-explorer')
    expect(offHorizon.comparison.display.state).toBe('not-displayed')
    expect(offHorizon.comparison.display.reason).toBe('no-served-reference')
    expect(JSON.stringify(projected.request)).toBe(snapshot)

    await wrapper
      .get('[data-section="aedar-equipment-profile"] .aedar-waffle-horizon button[aria-label="15 minutes"]')
      .trigger('click')
    await flushPromises()
    expect(distributionBars()).toBeGreaterThan(0)

    toggleByText(wrapper, '[data-section="aedar-access"] .aedar-access-mode-selector', 'Voiture').trigger('click')
    await flushPromises()
    expect(distributionBars()).toBe(0)
    const hiddenMode = captureOf(wrapper, 'aedar-equipment-explorer')
    expect(hiddenMode.comparison.display.state).toBe('not-displayed')
    expect(hiddenMode.comparison.display.reason).toBe('hidden-by-selection')

    toggleByText(wrapper, '[data-section="aedar-access"] .aedar-access-mode-selector', 'Voiture').trigger('click')
    await flushPromises()
    const reference = wrapper
      .findAll('[data-section="aedar-equipment-explorer"] .cahier-figure-legend-toggle')
      .find((button) => button.attributes('aria-label')?.startsWith('Groupe comparé'))
    if (!reference) throw new Error('Explorer comparison toggle missing')
    await reference.trigger('click')
    await flushPromises()
    expect(distributionBars()).toBe(0)
    expect(captureOf(wrapper, 'aedar-equipment-explorer').comparison.display.reason).toBe('hidden-by-user')
    wrapper.unmount()
  })

  it('keeps a ratio-only served reference displayed when the bars layer is hidden', async () => {
    const ratioOnly = await render({}, { barReferences: 'none', ratioReferences: true })
    const ratioOnlyValues = () => ratioOnly.wrapper.findAll(
      '[data-section="stationnement-ravitaillement"] .mobilite-ratio-scalar .cahier-comparison-value',
    ).length
    expect(ratioOnlyValues()).toBeGreaterThan(0)
    const pair = captureOf(ratioOnly.wrapper, 'stationnement-ravitaillement')
    expect(pair.comparison.display.state).toBe('displayed')
    expect(pair.comparison.display.layers.find((entry) => entry.slot === 'ratios')).toMatchObject({
      toggle: null,
      referenceAvailable: true,
      visibleReferenceAvailable: true,
      displayed: true,
    })
    expect(pair.comparison.display.layers
      .filter((entry) => entry.slot === 'stationnement' || entry.slot === 'ravitaillement')
      .every((entry) => !entry.referenceAvailable && !entry.displayed)).toBe(true)
    ratioOnly.wrapper.unmount()

    const { wrapper } = await render({}, { barReferences: 'served', ratioReferences: true })
    toggleByText(
      wrapper,
      '[data-section="stationnement-ravitaillement"] [data-column="stationnement"]',
      'Groupe comparé',
    ).trigger('click')
    await flushPromises()
    expect(wrapper.findAll(
      '[data-section="stationnement-ravitaillement"] .mobilite-ratio-scalar .cahier-comparison-value',
    ).length).toBeGreaterThan(0)
    const toggled = captureOf(wrapper, 'stationnement-ravitaillement')
    expect(toggled.comparison.display.state).toBe('displayed')
    expect(toggled.comparison.display.layers.find((entry) => entry.slot === 'stationnement'))
      .toMatchObject({ toggle: false, displayed: false })
    expect(toggled.comparison.display.layers.find((entry) => entry.slot === 'ratios'))
      .toMatchObject({ displayed: true })
    wrapper.unmount()
  })

  it('reports region ineligibility and profile capability without inventing groups', async () => {
    const content = regionMobiliteContent()
    const wrapper = await mountCahier({ content, control: null })
    const networks = captureOf(wrapper, 'reseaux')
    expect(networks.comparison.eligible).toBe(false)
    expect(networks.comparison.selection.known).toBe(false)
    expect(networks.comparison.group).toBeNull()
    expect(networks.comparison.absent).toBe('not-eligible')
    expect(networks.comparison.display.state).toBe('not-displayed')
    expect(networks.comparison.display.reason).toBe('not-eligible')
    const projected = projeterRequeteExport(networks, [])
    expect(projected.status).toBe('ready')
    if (projected.status === 'ready') {
      const projection = projeterRequeteExportFigures(projected.request)[0]!
      if (projection.family !== 'mobilite-bars') throw new Error('bars expected')
      expect(projection.comparisonDisplayed).toBe(false)
      expect(projection.comparisonLabel).toBeNull()
      expect(projection.accessibleLabel).not.toContain('Groupe comparé')
    }
    wrapper.unmount()

    const { wrapper: communeWrapper } = await render()
    expect(captureOf(communeWrapper, 'aedar-equipment-profile').comparison.display).toEqual({
      state: 'not-applicable',
      reason: 'capability-absent',
      layers: [],
    })
    communeWrapper.unmount()
  })

  it('keeps the mounted ratio scalar and its export projection on the same owner formatter', async () => {
    const { wrapper } = await render({}, { ratioReferences: true })
    const capture = captureOf(wrapper, 'stationnement-ravitaillement')
    const projected = projeterRequeteExport(capture, [])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'mobilite-bars' || !projection.ratio) throw new Error('ratio expected')
    const section = wrapper.get('[data-section="stationnement-ravitaillement"] [data-column="stationnement"]')
    const scalar = section.get('.mobilite-ratio-scalar .cahier-figure-scalar')
    expect(scalar.get('.cahier-figure-scalar-value strong').text()).toBe(projection.ratio.display)
    expect(scalar.attributes('aria-label')).toBe(projection.ratio.ariaLabel)
    const reference = scalar.find('.cahier-comparison-value .region-emphasis')
    if (projection.ratio.comparisonDisplay && reference.exists()) {
      expect(reference.text()).toBe(projection.ratio.comparisonDisplay)
    }
    wrapper.unmount()
  })

  it('keeps the mounted overview scalar value and accessible name on the exported reading', async () => {
    const { wrapper } = await render({ comparisonStatus: 'idle' }, { aedarReference: 'sparse-car' })
    const capture = captureOf(wrapper, 'aedar-car-overview')
    const projected = projeterRequeteExport(capture, [])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'aedar-car-overview') throw new Error('overview expected')
    const scalar = wrapper.get('[data-section="aedar-car-overview"] .aedar-car-overview-scalars .cahier-figure-scalar')
    expect(scalar.get('.cahier-figure-scalar-value strong').text())
      .toBe(projection.scalars[0]?.display)
    expect(scalar.attributes('aria-label')).toBe(projection.scalars[0]?.ariaLabel)
    wrapper.unmount()
  })

  it('feeds grouped AEDAR bars from the same frozen native renderer model and table builder', async () => {
    const { wrapper } = await render({ aedarChapterActive: true })
    await flushPromises()
    const capture = captureOf(wrapper, 'aedar-equipment-explorer')
    const projected = projeterRequeteExport(capture, capture.capabilities.selectedSeries)
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'aedar-equipment-explorer') throw new Error('explorer expected')
    const chart = wrapper.findAllComponents(CahierGroupedVerticalBarChart)
      .find((candidate) => candidate.element.closest('[data-section="aedar-equipment-explorer"]'))!
    const native = chart.props('figure')
    expect(native.xAxisTitle).toBe(projection.distribution.figure.xAxisTitle)
    expect(native.yAxisTitle).toBe(projection.distribution.figure.yAxisTitle)
    expect(native.categories.map((category: { key: string }) => category.key))
      .toEqual(projection.distribution.figure.categories.map((category) => category.key))
    expect(native.series.map((series: { key: string }) => series.key))
      .toEqual(projection.distribution.figure.series.map((series) => series.key))
    expect(native.formatValue?.(12.34)).toBe(projection.distribution.figure.formatValue?.(12.34))
    expect(native.formatAriaValue?.(12.34)).toBe(projection.distribution.figure.formatAriaValue?.(12.34))
    for (const series of native.series as readonly { key: string; color: string; ranks?: unknown }[]) {
      const projected = projection.distribution.figure.series.find((candidate) => candidate.key === series.key)!
      expect(series.color).toBe(projected.color)
      expect(series.ranks).toEqual(projected.ranks)
    }

    const hitbox = chart.get('button.cahier-grouped-vertical-bar-chart__category-hitbox')
    await hitbox.trigger('focus')
    const tooltip = chart.get('.cahier-grouped-vertical-bar-chart__tooltip')
    const table = projection.tables.find((candidate) => candidate.key === 'distribution')!
    const categoryKey = projection.distribution.figure.categories[0]!.key
    const columnIndex = table.columns.findIndex((column) => column.key === categoryKey)
    for (const row of tooltip.findAll('.cahier-figure-tooltip-row')) {
      const label = row.get('dt').text()
      const series = projection.distribution.figure.series.find((candidate) => candidate.label === label)!
      const tableRow = table.rows.find((candidate) => candidate.key === series.key)!
      expect(row.get('dd').text()).toBe(tableRow.cells[columnIndex]?.display)
    }
    wrapper.unmount()
  })

  it('keeps the mounted coverage tracks and their accessible rows on the exported share state', async () => {
    const { wrapper } = await render()
    const capture = captureOf(wrapper, 'couverture-du-territoire')
    const projected = projeterRequeteExport(capture, [])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'mobilite-share') throw new Error('share expected')
    const section = wrapper.get('[data-section="couverture-du-territoire"]')
    const territory = section.get('[data-row="territory"]')
    expect(territory.get('.mobilite-share-track__value').text()).toBe(projection.display)
    expect(territory.get('.mobilite-share-track__track').attributes('aria-label'))
      .toBe(projection.territoryAria)
    const compared = section.find('[data-row="comparison"]')
    if (projection.comparisonDisplayed && compared.exists()) {
      expect(compared.get('.mobilite-share-track__value').text()).toBe(projection.comparisonDisplay)
      expect(compared.get('.mobilite-share-track__track').attributes('aria-label'))
        .toBe(projection.comparisonAria)
    }
    if (projection.stateMessage) expect(section.text()).toContain(projection.stateMessage)
    wrapper.unmount()

    const unavailable = await render({ nativeComparisonStatus: 'unavailable' })
    const unavailableProjection = projeterRequeteExportFigures(
      (() => {
        const state = projeterRequeteExport(captureOf(unavailable.wrapper, 'couverture-du-territoire'), [])
        if (state.status !== 'ready') throw new Error('projection expected')
        return state.request
      })(),
    )[0]!
    if (unavailableProjection.family !== 'mobilite-share') throw new Error('share expected')
    if (unavailableProjection.stateMessage) {
      expect(unavailable.wrapper.get('[data-section="couverture-du-territoire"]').text())
        .toContain(unavailableProjection.stateMessage)
    }
    unavailable.wrapper.unmount()
  })

  it('keeps the mounted curve accessible sentence and tooltip on the exported readings', async () => {
    const { wrapper } = await render()
    const capture = captureOf(wrapper, 'visiter-la-bretagne')
    const projected = projeterRequeteExport(capture, [])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'mobilite-curve') throw new Error('curve expected')
    const section = wrapper.get('[data-section="visiter-la-bretagne"]')
    const svg = section.get('.mobilite-raccordement-curve__svg')
    expect(svg.attributes('aria-label')).toBe(projection.accessibleLabel)
    await section.get('.mobilite-raccordement-curve__hit-surface').trigger('focus')
    const point = projection.points.find((reading) => reading.detail === projection.marker?.detail)!
    const tooltip = section.get('.mobilite-raccordement-curve__tooltip')
    expect(tooltip.get('.cahier-figure-tooltip-row dd').text()).toBe(point.display)
    const comparison = tooltip.find('.cahier-figure-tooltip-comparison-value')
    if (point.comparisonDisplay && comparison.exists()) {
      expect(comparison.text()).toBe(point.comparisonDisplay)
    }
    wrapper.unmount()
  })

  it.each([
    ['loading', 'Comparaison en cours de chargement.'],
    ['unavailable', 'Aucun groupe comparé actif.'],
    ['error', 'Comparaison indisponible'],
  ] as const)('keeps the mounted curve accessible state in the projection (%s)', async (status, expected) => {
    const { wrapper } = await render({
      nativeComparisonStatus: status,
      nativeComparisonError: 'Lecture échouée',
    })
    const capture = captureOf(wrapper, 'visiter-la-bretagne')
    const projected = projeterRequeteExport(capture, [])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'mobilite-curve') throw new Error('curve expected')
    const aria = wrapper.get('[data-section="visiter-la-bretagne"] .mobilite-raccordement-curve__svg')
      .attributes('aria-label')!
    expect(aria).toBe(projection.accessibleLabel)
    expect(aria).toContain(expected)
    wrapper.unmount()
  })

  it('projects the actual car inline asset and owner legend content, never the inspection gallery', async () => {
    const territory = { type: 'commune' as const, code: '22001', name: 'Rennes' }
    const rawLegend = carInlineLegend(territory)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('-car-inline.json')) {
        return new Response(JSON.stringify(rawLegend), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { wrapper } = await render({ aedarChapterActive: true })
    await flushPromises()
    const capture = captureOf(wrapper, 'aedar-car-overview')
    expect(capture.capabilities.maps).toMatchObject({
      status: 'pending',
      legend: 'available',
      items: [{
        id: 'car',
        declared: true,
        loaded: false,
        unavailable: false,
        inlineUrl: 'https://images.calumrobertson.fr/maps/aedar/v1/22001-car-inline.webp',
      }],
      legendDetail: {
        title: 'Types d’équipements accessibles en 15 minutes*',
        minimum: 0,
        maximum: 218,
        colors: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
        tickLabels: ['0', '44', '87', '131', '174', '218'],
        note: '* Sur 235 catégories d’équipements BPE',
        ariaLabel: null,
      },
    })
    expect('inspectionUrl' in capture.capabilities.maps.items[0]!).toBe(false)

    await emitMap(mapPanels(wrapper, 'aedar-car-overview')[0]!, 'loaded')
    const projected = projeterRequeteExport(captureOf(wrapper, 'aedar-car-overview'), [])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') { wrapper.unmount(); return }
    const projection = projeterRequeteExportFigures(projected.request)[0]!
    if (projection.family !== 'aedar-car-overview') throw new Error('overview expected')
    expect(projection.maps).toMatchObject({
      status: 'available',
      legend: 'available',
      items: [{
        loaded: true,
        inlineUrl: 'https://images.calumrobertson.fr/maps/aedar/v1/22001-car-inline.webp',
      }],
      legendDetail: {
        title: 'Types d’équipements accessibles en 15 minutes*',
        minimum: 0,
        maximum: 218,
        tickLabels: ['0', '44', '87', '131', '174', '218'],
      },
    })
    wrapper.unmount()
  })

  it('captures real car map and legend owner transitions', async () => {
    const pending = await render()
    await pending.wrapper
      .get('[data-section="aedar-equipment-profile"] .aedar-waffle-horizon button[aria-label="10 minutes"]')
      .trigger('click')
    await flushPromises()
    const pendingCapture = captureOf(pending.wrapper, 'aedar-car-overview')
    expect(pendingCapture.capabilities.maps).toMatchObject({
      status: 'pending',
      legend: 'pending',
      items: [{ id: 'car', declared: true, loaded: false, unavailable: false }],
    })
    await emitMap(mapPanels(pending.wrapper, 'aedar-car-overview')[0]!, 'loaded')
    expect(captureOf(pending.wrapper, 'aedar-car-overview').capabilities.maps).toMatchObject({
      status: 'available',
      items: [{ declared: true, loaded: true, unavailable: false }],
    })
    pending.wrapper.unmount()

    const failed = await render()
    await failed.wrapper
      .get('[data-section="aedar-equipment-profile"] .aedar-waffle-horizon button[aria-label="10 minutes"]')
      .trigger('click')
    await flushPromises()
    await emitMap(mapPanels(failed.wrapper, 'aedar-car-overview')[0]!, 'unavailable')
    expect(captureOf(failed.wrapper, 'aedar-car-overview').capabilities.maps).toMatchObject({
      status: 'unavailable',
      items: [{ unavailable: true }],
    })
    failed.wrapper.unmount()

    // The legend is read by the owner; the failing fixture request is an honest
    // unavailable observation, never an invented ready legend.
    const legendFailure = await render({ aedarChapterActive: true })
    await legendFailure.wrapper
      .get('[data-section="aedar-equipment-profile"] .aedar-waffle-horizon button[aria-label="10 minutes"]')
      .trigger('click')
    await flushPromises()
    expect(captureOf(legendFailure.wrapper, 'aedar-car-overview').capabilities.maps.legend).toBe('unavailable')
    legendFailure.wrapper.unmount()
  })

  it('captures real diversity map and legend owner transitions', async () => {
    const { wrapper } = await render({}, { lossMetadata: readyLossMetadata() })
    const initial = captureOf(wrapper, 'aedar-diversity-loss').capabilities.maps
    expect(initial.legend).toBe('available')
    expect(initial.status).toBe('pending')
    expect(initial.items).toHaveLength(4)
    expect(initial.items.map((item) => item.inlineUrl)).toEqual(expect.arrayContaining([
      'https://images.calumrobertson.fr/maps/aedar/v1/22001-walk-inline.webp',
      'https://images.calumrobertson.fr/maps/aedar/v1/22001-transit-inline.webp',
    ]))
    expect(initial.legendDetail).toMatchObject({
      title: 'Types d’équipements perdus par rapport à la voiture',
      tickLabels: ['0', '1', '2+'],
    })

    const panels = mapPanels(wrapper, 'aedar-diversity-loss')
    expect(panels).toHaveLength(4)
    await emitMap(panels[0]!, 'loaded')
    await emitMap(panels[1]!, 'unavailable')
    const partial = captureOf(wrapper, 'aedar-diversity-loss').capabilities.maps
    expect(partial.status).toBe('partial')
    expect(partial.items.map((item) => [item.loaded, item.unavailable])).toEqual([
      [true, false], [false, true], [false, false], [false, false],
    ])
    wrapper.unmount()

    const failed = await render({}, { lossMetadata: readyLossMetadata() })
    for (const panel of mapPanels(failed.wrapper, 'aedar-diversity-loss')) {
      await emitMap(panel, 'unavailable')
    }
    expect(captureOf(failed.wrapper, 'aedar-diversity-loss').capabilities.maps.status).toBe('unavailable')
    failed.wrapper.unmount()

    // Loading metadata keeps the legend pending; it is not made available.
    const loading = await render()
    expect(captureOf(loading.wrapper, 'aedar-diversity-loss').capabilities.maps.legend).toBe('pending')
    loading.wrapper.unmount()
  })

  it('keeps explicit empty-selection notes and ratio ARIA aligned with shared comparisonNone', async () => {
    const fixture = cahierExportFixture()
    const content = JSON.parse(JSON.stringify(fixture.content)) as any
    const networks = content.units.flatMap((unit: any) => unit.sections)
      .find((section: any) => section.key === 'reseaux')
    networks.evidence.figure.unavailableResources = ['Ressource test']
    networks.evidence.figure.unavailableComparisons = ['Comparaison test']
    const paired = content.units.flatMap((unit: any) => unit.sections)
      .find((section: any) => section.key === 'stationnement-ravitaillement')
    // A drawn ratio with a served reference: it would be announced if the
    // shared empty-selection state did not suppress the comparative proof.
    paired.evidence.columns[0].ratio.value.fact.value = 1.2
    paired.evidence.columns[0].ratio.value.fact.comparison = {
      direction: 'plus-est-mieux',
      scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
      reference: { kind: 'median', value: 0.3 },
      rank: { position: 2, size: 3 },
    }
    const control = { ...fixture.control, selection: { etat: 'vide' as const } }
    const wrapper = await mountCahier({ content, control })
    await flushPromises()

    const networksCapture = seamOf(wrapper).captureSection('reseaux')!
    const networksRequest = projeterRequeteExport(networksCapture, [])
    expect(networksRequest.status).toBe('ready')
    if (networksRequest.status !== 'ready') { wrapper.unmount(); return }
    const networksProjection = projeterRequeteExportFigures(networksRequest.request)[0]!
    if (networksProjection.family !== 'mobilite-bars') throw new Error('bars expected')
    expect(networksProjection.tables[0]?.notes).toEqual([
      'Publication indisponible : Ressource test',
      'Répartition Protégé/Partagé indisponible : les deux parties publiées ne recomposent pas le total.',
    ])
    expect(networksProjection.unavailable.map((item) => item.kind)).toEqual(['resource'])
    const networksDom = wrapper.get('[data-section="reseaux"]').text()
    expect(networksDom).toContain('Publication indisponible : Ressource test')
    expect(networksDom).not.toContain('Comparaison indisponible')

    const pairedCapture = seamOf(wrapper).captureSection('stationnement-ravitaillement')!
    const pairedRequest = projeterRequeteExport(pairedCapture, [])
    expect(pairedRequest.status).toBe('ready')
    if (pairedRequest.status !== 'ready') { wrapper.unmount(); return }
    const pairedProjection = projeterRequeteExportFigures(pairedRequest.request)[0]!
    if (pairedProjection.family !== 'mobilite-bars' || !pairedProjection.ratio) {
      throw new Error('ratio expected')
    }
    const scalar = wrapper.get(
      '[data-section="stationnement-ravitaillement"] [data-column="stationnement"] .mobilite-ratio-scalar .cahier-figure-scalar',
    )
    expect(scalar.attributes('aria-label')).toBe(pairedProjection.ratio.ariaLabel)
    expect(pairedProjection.ratio.ariaLabel).not.toContain('Référence')
    expect(pairedProjection.ratio.comparisonDisplayed).toBe(false)
    wrapper.unmount()
  })

  it('keeps all three drawn network maps declared when one numeric bar category is absent', async () => {
    const fixture = cahierExportFixture()
    const content = JSON.parse(JSON.stringify(fixture.content)) as typeof fixture.content
    const networks = content.units
      .flatMap((unit) => unit.sections)
      .find((section) => section.key === 'reseaux')!
    if (networks.evidence?.kind !== 'mobilite-networks') throw new Error('networks fixture expected')
    networks.evidence.figure.categories = networks.evidence.figure.categories
      .filter((category) => category.key !== 'car')
    const wrapper = await mountCahier({ content, control: fixture.control })
    await flushPromises()
    const maps = seamOf(wrapper).captureSection('reseaux')!.capabilities.maps
    expect(maps.status).toBe('pending')
    expect(maps.items.map((item) => [item.id, item.declared, item.inlineUrl])).toEqual([
      ['car', true, 'https://images.calumrobertson.fr/maps/v1/22001-car-inline.webp'],
      ['walk', true, 'https://images.calumrobertson.fr/maps/v1/22001-walk-inline.webp'],
      ['bike', true, 'https://images.calumrobertson.fr/maps/v1/22001-bike-inline.webp'],
    ])
    wrapper.unmount()
  })

  it('captures real network map owner transitions with no invented legend', async () => {
    const { wrapper } = await render()
    const initial = captureOf(wrapper, 'reseaux').capabilities.maps
    expect(initial.status).toBe('pending')
    expect(initial.legend).toBe('none')
    expect(initial.items.map((item) => item.declared)).toEqual([true, true, true])
    expect(initial.items.map((item) => [item.id, item.inlineUrl])).toEqual([
      ['car', 'https://images.calumrobertson.fr/maps/v1/22001-car-inline.webp'],
      ['walk', 'https://images.calumrobertson.fr/maps/v1/22001-walk-inline.webp'],
      ['bike', 'https://images.calumrobertson.fr/maps/v1/22001-bike-inline.webp'],
    ])

    for (const panel of mapPanels(wrapper, 'reseaux')) await emitMap(panel, 'loaded')
    expect(captureOf(wrapper, 'reseaux').capabilities.maps.status).toBe('available')
    wrapper.unmount()

    const failed = await render()
    for (const panel of mapPanels(failed.wrapper, 'reseaux')) await emitMap(panel, 'unavailable')
    expect(captureOf(failed.wrapper, 'reseaux').capabilities.maps.status).toBe('unavailable')
    failed.wrapper.unmount()
  })

  it('produces requests no later group, territory or status change can relabel', async () => {
    const { wrapper, controlRef, content } = await render({ nativeComparisonStatus: 'loading' })
    const capture = captureOf(wrapper, 'reseaux')
    const projected = projeterRequeteExport(capture, [])
    if (projected.status !== 'ready') throw new Error('projection expected')
    const snapshot = JSON.stringify(projected.request)

    controlRef.value = { ...controlRef.value, selection: { etat: 'vide' } }
    await wrapper.setProps({
      nativeComparisonStatus: 'ready',
      content: { ...content, territory: { ...content.territory, code: '22999', name: 'Territoire changé' } },
    })
    await flushPromises()

    expect(JSON.stringify(projected.request)).toBe(snapshot)
    expect(projected.request.capture.comparison.selection.state).toBe('defaut')
    expect(projected.request.capture.comparison.group).not.toBeNull()
    expect(projected.request.capture.identity.territory.code).not.toBe('22999')
    const fresh = captureOf(wrapper, 'reseaux')
    expect(fresh.identity.territory.code).toBe('22999')
    expect(fresh.comparison.selection.state).toBe('vide')
    expect(fresh.comparison.group).toBeNull()
    expect(fresh.comparison.absent).toBe('empty-selection')
    expect(fresh.comparison.display.state).toBe('not-displayed')
    expect(fresh.comparison.display.reason).toBe('empty-selection')
    wrapper.unmount()
  })

  it('captures and projects without mutating a screen control, acquiring data or remounting', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await render()
    const accessSection = wrapper.get('[data-section="aedar-access"]')
    const accessElement = accessSection.element
    const pressedBefore = wrapper.findAll('button[aria-pressed]')
      .map((button) => [button.attributes('aria-label'), button.attributes('aria-pressed')])
    fetchMock.mockClear()

    const capture = captureOf(wrapper, 'aedar-access')
    projeterRequeteExport(capture, ['car', 'walk'])
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.get('[data-section="aedar-access"]').element).toBe(accessElement)
    expect(wrapper.findAll('button[aria-pressed]')
      .map((button) => [button.attributes('aria-label'), button.attributes('aria-pressed')]))
      .toEqual(pressedBefore)
    wrapper.unmount()
  })

  it('keeps the current sources, comparison data and loading fences untouched', async () => {
    const { wrapper } = await render({ nativeComparisonStatus: 'error', nativeComparisonError: 'Lecture échouée' })
    const capture = captureOf(wrapper, 'reseaux')
    expect(capture.comparison.status).toBe('error')
    expect(capture.comparison.error).toBe('Lecture échouée')
    expect(capture.comparison.display.reason).toBe('error')
    expect(capture.sources.length).toBeGreaterThan(0)
    expect(wrapper.find('[data-section="reseaux"] .mobilite-comparison-retry').exists()).toBe(true)
    wrapper.unmount()
  })
})
