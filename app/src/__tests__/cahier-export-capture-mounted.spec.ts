import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchAedarAggregates } from '@/fiche/content/aedarApiClient'
import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import type { ControleComparaison } from '@/fiche/comparisonContext'
import type { ContentEvidence } from '@/fiche/content/themeContent'
import type { Payload } from '@/payload/types'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { CAHIER_SECTION_RENDERERS } from '@/fiche/prototype/cahierSectionRenderers'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { routes } from '@/router'
import { cahierExportFixture } from './helpers/cahierExportFixtures'

vi.mock('@/fiche/content/aedarApiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/fiche/content/aedarApiClient')>()
  return { ...actual, fetchAedarAggregates: vi.fn() }
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

function aggregatesFor(typequ: string) {
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
function withServedBarReferences(content: ReturnType<typeof cahierExportFixture>['content']) {
  const withReference = <T extends { fact: { value: number | null } }>(value: T): T => ({
    ...value,
    fact: {
      ...value.fact,
      comparison: {
        direction: 'plus-est-mieux' as const,
        scope: { kind: 'communes-bretagne' as const, label: 'communes bretonnes' },
        rank: null,
        reference: value.fact.value === null ? null : { kind: 'median' as const, value: value.fact.value },
      },
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

async function render(extra: Record<string, unknown> = {}) {
  const { content, control } = cahierExportFixture()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const controlRef = ref<ControleComparaison>(control)
  const wrapper = mount(VarianteCahierLibre, {
    props: {
      content: withServedBarReferences(content),
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

describe('Cahier export capture — mounted shared path (#1021)', () => {
  beforeEach(() => {
    vi.mocked(fetchAedarAggregates).mockReset()
    vi.mocked(fetchAedarAggregates).mockImplementation(async (_type, _id, options) =>
      aggregatesFor(String(options?.typequ?.[0] ?? 'B207')) as never)
  })

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
    toggleByText(wrapper, '[data-section="reseaux"] .mobilite-comparison-bars__legend', 'Groupe comparé').trigger('click')
    toggleByText(wrapper, '[data-section="visiter-la-bretagne"] .mobilite-raccordement-curve__legend', 'Groupe comparé')
      .trigger('click')
    await flushPromises()

    const figures = captureOf(wrapper, 'stationnement-ravitaillement').figures
    const stationnement = figures.find((figure) => figure.slot === 'stationnement')
    const ravitaillement = figures.find((figure) => figure.slot === 'ravitaillement')
    if (!stationnement || stationnement.family !== 'mobilite-bars'
      || !ravitaillement || ravitaillement.family !== 'mobilite-bars') throw new Error('bars expected')
    expect(stationnement.effective.comparisonVisible).toBe(false)
    expect(ravitaillement.effective.comparisonVisible).toBe(true)

    const networks = captureOf(wrapper, 'reseaux').figures[0]
    if (!networks || networks.family !== 'mobilite-bars') throw new Error('bars expected')
    expect(networks.effective.comparisonVisible).toBe(false)

    const curve = captureOf(wrapper, 'visiter-la-bretagne').figures[0]
    if (!curve || curve.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(curve.effective.comparisonVisible).toBe(false)
    wrapper.unmount()
  })

  it('captures the shared AEDAR reference visibility without touching it', async () => {
    const { wrapper } = await render()
    const reference = wrapper
      .findAll('[data-section="aedar-access"] .aedar-access-mode-selector .cahier-figure-legend-toggle')
      .find((button) => button.attributes('aria-label')?.startsWith('Groupe comparé'))
    if (!reference) throw new Error('Reference toggle missing')
    await reference.trigger('click')
    await flushPromises()
    const ramps = captureOf(wrapper, 'aedar-access').figures[0]
    const explorer = captureOf(wrapper, 'aedar-equipment-explorer').figures[0]
    if (!ramps || ramps.family !== 'aedar-ramps'
      || !explorer || explorer.family !== 'aedar-equipment-explorer') throw new Error('AEDAR figures expected')
    expect(ramps.effective.comparisonVisible).toBe(false)
    expect(explorer.effective.comparisonVisible).toBe(false)
    wrapper.unmount()
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
    // The delegate's honest effective state: an empty selection is unavailable,
    // never a silent fallback cohort.
    expect(fresh.comparison.status).toBe('unavailable')
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
    expect(capture.sources.length).toBeGreaterThan(0)
    expect(wrapper.find('[data-section="reseaux"] .mobilite-comparison-retry').exists()).toBe(true)
    wrapper.unmount()
  })
})
