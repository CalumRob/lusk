import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import ProductionMobiliteAedar from '@/fiche/mobilite/ProductionMobiliteAedar.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { aedarAccessSection } from '@/fiche/content/aedarAccessSection'
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type { AedarAccessSection, ContentSection, ThemeContent } from '@/fiche/content/themeContent'
import type { AedarFetchResult } from '@/fiche/content/aedarApiClient'
import {
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { routes } from '@/router'
import { carInlineLegend } from './fixtures/aedar-car-inline-legend'

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  apercu: null,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  profilsAccesBpe: [],
  rampesAccesBatiments: [],
  reseauxMobilite: null,
  themeMetadata: metadonneesThemesFixtures,
} as unknown as Payload

function baseContent(): ThemeContent {
  const facts = territoryFactsFor(payload, '22001')
  if (!facts) throw new Error('Test target should exist')
  return resolveMobiliteThemeContent(facts, payload.themeMetadata?.mobilite)
}

function contentWithAedarAccess(): ThemeContent {
  const content = baseContent()
  const section = aedarAccessSection(aedarReady, content.territory)
  const first = content.units[0]
  return {
    ...content,
    units: [{ ...first, sections: [section] }, ...content.units.slice(1)],
  } as unknown as ThemeContent
}

function contentWithAedarAccessReference(): ThemeContent {
  const content = baseContent()
  const section = aedarAccessSection(aedarReady, content.territory, {
    reference: { data: aedarReferenceReady, territory: { type: 'epci', id: '200000001' }, label: 'EPCI X' },
  })
  const first = content.units[0]
  return {
    ...content,
    units: [{ ...first, sections: [section] }, ...content.units.slice(1)],
  } as unknown as ThemeContent
}

function aedarFacts(count: number, options: { territoryId?: string; territoryType?: 'commune' | 'epci'; value?: number; canonicalUniverse?: boolean } = {}) {
  const { territoryId = '22001', territoryType = 'commune', value = 0.5 } = options
  const types = options.canonicalUniverse !== false ? AEDAR_TYPEQU_REGISTRY : Array.from({ length: count }, (_, index) => ({ code: `TYPEQU${index}`, label: `Type ${index}` }))
  return types.map(({ code, label }, index) => ({
    territory_id: territoryId,
    territory_type: territoryType,
    typequ: code,
    typequ_label: label,
    identity: {},
    n_addresses: 100,
    n_observed: index < count ? 100 : 0,
    coverage_status: 'covered',
    measures: Object.fromEntries(
      [5, 10, 15, 20].flatMap((duration) =>
        ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) =>
          ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']
            .map((stat) => [`count_${duration}_${mode}_${stat}`, index < count ? value : 0]),
        ),
      ),
    ),
    source_id: 'aedar_bretagne',
    vintage_id: '2026-v1',
    source_url: 'https://example.com',
    licence: 'Licence Ouverte',
    attribution: 'AEDAR',
    reference_date: '2026-01-01',
    publication_date: '2026-09-30',
  }))
}

function aedarExplorerReady() {
  const facts = aedarFacts(10, { canonicalUniverse: true })
  for (const fact of facts) {
    const count = fact.typequ === 'B207' ? 3 : fact.typequ === 'A129' ? 7 : null
    if (count === null) continue
    for (const horizon of [5, 10, 15, 20]) {
      for (const [modeIndex, mode] of ['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'].entries()) {
        const minimum = (fact.typequ === 'B207' ? 4 : 8) + modeIndex + (horizon - 15) / 5
        fact.measures[`count_${horizon}_${mode}_mean`] = count
        fact.measures[`count_${horizon}_${mode}_min`] = minimum
        fact.measures[`count_${horizon}_${mode}_max`] = minimum + 10
        for (let decile = 1; decile <= 9; decile += 1) {
          fact.measures[`count_${horizon}_${mode}_decile${decile}`] = minimum + decile
        }
      }
    }
  }
  return { ...aedarReady, facts }
}

function aedarProvenance(contentVersion: string) {
  return {
    contentVersion,
    sources: [{
      source_id: 'aedar_bretagne',
      vintage_id: '2026-v1',
      source_url: 'https://example.com',
      licence: 'Licence Ouverte',
      attribution: 'AEDAR',
      reference_date: '2026-01-01',
      publication_date: '2026-09-30',
    }],
  }
}

const aedarReady: Extract<AedarFetchResult, { status: 'ready' }> = {
  status: 'ready',
  facts: aedarFacts(10),
  contentVersion: 'test-version',
  referenceContentVersion: 'test-reference-version',
  provenance: aedarProvenance('test-version'),
}

const aedarReferenceReady: Extract<AedarFetchResult, { status: 'ready' }> = {
  status: 'ready',
  facts: aedarFacts(10, { territoryId: '200000001', territoryType: 'epci', value: 0.25 }),
  contentVersion: 'test-version',
  referenceContentVersion: 'test-reference-version',
  provenance: aedarProvenance('test-version'),
}

const lossMapModes = ['walk', 'transit', 'bike_lts2', 'bike_lts4'] as const
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/22001-car-inline.json')) {
      return { ok: true, json: async () => carInlineLegend({ type: 'commune', code: '22001', name: 'Allineuc' }) } as Response
    }
    const mode = lossMapModes.find((candidate) => String(input).endsWith(`22001-${candidate}-inline.json`))
    if (!mode) throw new Error(`Unexpected request: ${String(input)}`)
    return { ok: true, json: async () => lossInlineLegend(mode) } as Response
  }))
})
afterEach(() => vi.unstubAllGlobals())

function lossInlineLegend(mode: typeof lossMapModes[number]) {
  return {
    schema: 'lusk.aedar.inline-legend.v1',
    territory: { kind: 'commune', code: '22001', name: 'Allineuc' },
    mode,
    measure: 'equipment_loss',
    horizon_minutes: 15,
    image: {
      key: `maps/aedar/v1/22001-${mode}-inline.webp`,
      sha256: 'a'.repeat(64),
      bytes: 36412,
    },
    scale: {
      type: 'equal-width',
      semantics: 'car-only-typequ',
      scope: 'territory-local-pooled-loss',
      minimum: 12,
      maximum: 92,
      boundaries: [12, 28, 44, 60, 76, 92],
      colours: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
      display_ticks: ['12', '28', '44,0', '60', '76', '92'],
      regional_reference: null,
      regional_reference_label: null,
    },
  }
}

describe('VarianteCahierLibre — AEDAR access', () => {
  it('renders two standalone time ramps with existing mode controls, but no duplicate map slots', async () => {
    const content = contentWithAedarAccess()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibre, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        showAllUnits: true,
        presentation: 'plain',
        aedarAccessEnabled: true,
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.blank-map-slots').exists()).toBe(false)

    expect(wrapper.findAll('.access-ramp-cahier--time')).toHaveLength(2)
    expect(wrapper.find('.page-margin').exists()).toBe(true)
    expect(wrapper.find('.page-heading-territory').exists()).toBe(false)
    expect(wrapper.find('.concept-group-heading > span').exists()).toBe(true)

    // The AEDAR section has no generic Lecture block.
    const heading = wrapper.find('[data-section="aedar-access"] .concept-group-heading')
    expect(heading.find('h3').text()).toBe('La ville du 1/12, du 1/6, du 1/4 et du 1/3 d’heure')
    expect(wrapper.find('[data-section="aedar-access"] .argument-copy').text()).toContain('Les deux variables sont ici présentées pour chaque mode')
    expect(wrapper.find('[data-section="aedar-access"] .cahier-section-state').exists()).toBe(false)

    // The section label is not duplicated as a figure title: each figure carries
    // its own descriptive title through the shared figure-title primitive.
    expect(wrapper.findAll('.aedar-access-evidence > .cahier-figure-title')).toHaveLength(0)
    expect(wrapper.findAll('.aedar-ramp .cahier-figure-title').map((title) => title.text())).toEqual([
      'Diversité de l’offre accessible (moyenne par adresse)',
      'Établissements accessibles (moyenne par adresse)',
    ])

    // The selectable ramp defaults to car, transit and LTS2.
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--car').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--bike-light').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--bike')).toHaveLength(0)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--walkTransit').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--bike-light').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--walkTransit-light')).toHaveLength(0)
    expect(wrapper.find('.aedar-ramp figcaption').text()).toBe('Diversité de l’offre accessible (moyenne par adresse)')
    expect(wrapper.find('.aedar-ramp .cahier-figure-axis-title--y').text()).toBe('Diversité de l’offre')
    expect(wrapper.find('.aedar-ramp .cahier-figure-axis-title--x').text()).toBe('Temps de trajet')
    const volume = wrapper.findAll('.aedar-ramp')[1]!
    expect(volume.get('.cahier-figure-axis-title--y').text()).toBe('Volume de l’offre')
    expect(volume.get('svg[role="img"]').attributes('aria-label')).toContain('15 min 5')
    await volume.get('[aria-label="Temps d\'accès : 15 min"]').trigger('focus')
    expect(volume.get('[role="tooltip"]').text()).toContain('5')
    const moreInfo = wrapper.get('[data-section="aedar-access"] .cahier-section-footer .passarelle-exploration')
    expect(moreInfo.text()).toBe('En savoir plus')
    expect(moreInfo.attributes('disabled')).toBeDefined()
    const sharedRampLegend = wrapper.get('[data-section="aedar-access"] .aedar-access-mode-selector').findAll('.cahier-figure-legend-item')
    expect(sharedRampLegend.map((item) => item.text())).toEqual([
      'Voiture',
      'Vélo (LTS2)',
      'Vélo (LTS4)',
      'Transports en commun',
      'À pied',
    ])

    // The tooltip reads one row per mode.
    await wrapper.find('.aedar-ramp [aria-label="Temps d\'accès : 15 min"]').trigger('focus')
    const tooltip = wrapper.find('.aedar-ramp [role="tooltip"]').text()
    expect(tooltip).toContain('Voiture')
    expect(tooltip).toContain('Vélo (LTS2)')
    expect(tooltip).toContain('Transports en commun')

    // AEDAR maps have no lecture disclosure; the main figure has no horizon marker or territory dots.
    expect(wrapper.find('.aedar-ramp .cahier-figure-lecture').exists()).toBe(false)
    expect(wrapper.find('.aedar-ramp .access-ramp-horizon').exists()).toBe(false)
    expect(wrapper.find('.aedar-ramp .access-ramp-time-point').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading__number').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading__gap-copy').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading__gap--unavailable').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading .cahier-prose').text()).not.toContain('transit_gain')
    expect(wrapper.find('.aedar-reading .cahier-evidence-source a').text()).toBe('AEDAR')
    expect(wrapper.find('.aedar-reading .cahier-evidence-source a').text()).not.toBe('aedar_bretagne')
    expect(wrapper.find('.aedar-reading .cahier-evidence-source').text().replace(/\s+/gu, ' ').trim()).toBe('AEDAR 2026-v1')
    const prose = wrapper.get('.aedar-reading .argument-copy').element
    const source = wrapper.get('.aedar-reading .cahier-evidence-source').element
    const figures = wrapper.get('.aedar-analysis').element
    expect(prose.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(source.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // The section has a reading: no "lecture indisponible" placeholder may follow the evidence.
    expect(wrapper.find('[data-section="aedar-access"] .evidence-placeholder').exists()).toBe(false)
  })

  it('renders per-mode comparison lines and an explicit reference label when reference evidence exists', async () => {
    const content = contentWithAedarAccessReference()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibre, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        showAllUnits: true,
        presentation: 'plain',
        aedarAccessEnabled: true,
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    // Comparison series are selectable; the default shows car, transit and LTS2.
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison')).toHaveLength(6)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--car').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--walkTransit').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--bike-light').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--bike')).toHaveLength(0)

    // The legend names the five modes plus the explicitly labeled reference territory.
    const sharedRampLegend = wrapper.get('[data-section="aedar-access"] .aedar-access-mode-selector').findAll('.cahier-figure-legend-item')
    expect(sharedRampLegend.map((item) => item.text())).toEqual([
      'Voiture',
      'Vélo (LTS2)',
      'Vélo (LTS4)',
      'Transports en commun',
      'À pied',
      'EPCI X',
    ])
    const referenceMark = sharedRampLegend[5]!.find('.cahier-figure-legend-mark')
    expect(referenceMark.classes()).toContain('cahier-figure-legend-mark--dash')

    // The reference values land in the tooltip note per mode.
    await wrapper.find('.aedar-ramp [aria-label="Temps d\'accès : 15 min"]').trigger('focus')
    expect(wrapper.find('.aedar-ramp [role="tooltip"]').text()).toContain('EPCI X : 2,5')
    const note = wrapper.get('[data-section="aedar-access"] .cahier-comparison-note')
    expect(wrapper.get('.aedar-analysis').element.compareDocumentPosition(note.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.text()).toBe('Groupe comparé : moyennes des adresses résidentielles de EPCI X')
    expect(wrapper.findAll('[data-section="aedar-access"] .cahier-comparison-note')).toHaveLength(1)

  })

  it('does NOT render the aedar-access branch when aedarAccessEnabled is false (default)', async () => {
    const content = contentWithAedarAccess()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibre, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        showAllUnits: true,
        presentation: 'plain',
        // aedarAccessEnabled not set — defaults to false/undefined
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    // AEDAR branch NOT rendered
    expect(wrapper.find('.aedar-access-evidence').exists()).toBe(false)
    expect(wrapper.find('.blank-map-slots').exists()).toBe(false)

    // Falls through to the placeholder (evidence-placeholder) or other branches
    // The section has aedar-access evidence which is not handled when aedarAccessEnabled is false
    expect(wrapper.find('.evidence-placeholder').exists()).toBe(true)
  })

  it('does NOT render the aedar-access branch when aedarAccessEnabled is false even with the prop explicitly false', async () => {
    const content = contentWithAedarAccess()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibre, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        showAllUnits: true,
        presentation: 'plain',
        aedarAccessEnabled: false,
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.aedar-access-evidence').exists()).toBe(false)
    expect(wrapper.find('.blank-map-slots').exists()).toBe(false)
  })
})

describe('ProductionMobiliteAedar', () => {
  it('keeps maps/editorial structure mounted while the aggregate request is pending', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push({ path: '/territoire/commune/22001' })
    await router.isReady()
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const mode = lossMapModes.find((candidate) => input.endsWith(`22001-${candidate}-inline.json`))
      if (!mode) throw new Error(`Unexpected request: ${input}`)
      return { ok: true, json: async () => lossInlineLegend(mode) }
    }))
    const wrapper = mount(ProductionMobiliteAedar, { props: {
      content, pagination: cahierPaginationFor(payload, content), comparisonOptions: [],
      aedarData: null, aedarStatus: 'loading', retryAedar: () => {},
    }, global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('.cahier-page').exists()).toBe(true)
    expect(wrapper.find('.aedar-diversity-loss-map').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Les données AEDAR ne sont pas disponibles.')
  })

  it('renders production loss maps and metadata-driven legend', async () => {
    const base = baseContent()
    const content = {
      ...base,
      sourceRegister: [...base.sourceRegister, {
        id: 'unused-source',
        source: 'Source non présente sur cette page',
        version: 'unused-v1',
        referenceDate: null,
        publicationDate: null,
      }],
    } as ThemeContent
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push({ path: '/territoire/commune/22001' })
    await router.isReady()
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      const mode = lossMapModes.find((candidate) => input.endsWith(`22001-${candidate}-inline.json`))
      if (!mode) throw new Error(`Unexpected request: ${input}`)
      return { ok: true, json: async () => lossInlineLegend(mode) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        comparisonOptions: [],
        aedarData: { ...aedarReady, facts: aedarFacts(10, { canonicalUniverse: true }) },
        aedarStatus: 'ready',
        retryAedar: () => {},
      },
      global: { plugins: [router] },
    })
    await flushPromises()
    await flushPromises()

    expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => !String(url).startsWith('/api/'))).toEqual([...lossMapModes, 'car'].map((mode) =>
      `https://images.calumrobertson.fr/maps/aedar/v1/22001-${mode}-inline.json`))
    expect(wrapper.findAll('.figure-stack > [data-section]')
      .slice(0, 5)
      .map((section) => section.attributes('data-section')))
      .toEqual(['aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer'])

    const firstPageHeading = wrapper.get('.cahier-page .page-heading')
    const firstPage = cahierPaginationFor(payload, content).entries[0]
    expect(firstPageHeading.find('.page-heading-index').text()).toContain(String(firstPage?.page).padStart(2, '0'))
    expect(firstPageHeading.find('h2').text()).toBe(content.units[0]?.label)
    expect(firstPageHeading.find('.page-heading-theme').text()).toBe(content.label)
    expect(firstPageHeading.find('.page-heading-context-separator').text()).toBe('·')
    expect(firstPageHeading.find('.page-heading-territory').text()).toBe(content.territory.name)
    expect(wrapper.find('.page-margin').exists()).toBe(false)
    expect(wrapper.find('.margin-sources').exists()).toBe(false)
    expect(wrapper.findAll('.concept-group-heading > span')).toHaveLength(0)
    expect(wrapper.findAll('.map-section-number')).toHaveLength(0)
    const sourcesPage = wrapper.get('.sources-page .sources-list').text()
    expect(sourcesPage).toContain('AEDAR')
    expect(sourcesPage).not.toContain('Source non présente sur cette page')

    const lossSection = wrapper.get('[data-section="aedar-diversity-loss"]')
    expect(lossSection.findAll('.aedar-diversity-loss-map')).toHaveLength(4)
    expect(lossSection.findAll('.aedar-diversity-loss-map-label').map((label) => label.text())).toEqual([
      'À pied', 'Transports', 'Vélo LTS2', 'Vélo LTS4',
    ])
    const comparisonRows = lossSection.findAll('.aedar-diversity-loss__comparison-row')
    expect(comparisonRows).toHaveLength(2)
    expect(comparisonRows.map((row) => row.attributes('aria-label'))).toEqual([
      'À pied / Transports',
      'Vélo LTS2 / Vélo LTS4',
    ])
    expect(comparisonRows.map((row) => row.findAll('.aedar-diversity-loss-map-label').map((label) => label.text()))).toEqual([
      ['À pied', 'Transports'],
      ['Vélo LTS2', 'Vélo LTS4'],
    ])
    expect(lossSection.get('.aedar-diversity-loss__introduction').classes()).toContain('argument-copy')
    expect(lossSection.get('.cahier-evidence-source a').text()).toBe('AEDAR')
    expect(comparisonRows.map((row) => row.get('.aedar-diversity-loss__comparison-copy').findAll('p').map((paragraph) => paragraph.text()))).toEqual([
      ['Les transports en commun incluent la marche et ils excluent le transport à la demande. La présence (ou l’absence) de différences entre ces deux cartes montre la capacité (ou l’incapacité) du réseau de transports en commun existant à compenser la perte d’accès sans voiture.'],
      [
        'Vélo LTS 2 : Un trajet de 15 minutes d’un·e cycliste qui emprunte les aménagements cyclables, les voies résidentielles, ou bien les voies où la vitesse autorisée est strictement inférieure à 50 km/h. Sinon, iel marche.',
        'Vélo LTS4 : Un trajet de 15 minutes d’un·e cycliste qui est prêt·e à rester sur le vélo sur toutes les portions qui lui sont autorisées.',
        'La présence (ou l’absence) de différences entre ces deux cartes montre l’incapacité (ou la capacité) du réseau d’aménagements cyclo-compatibles à compenser la perte d’accès sans voiture.',
      ],
    ])
    expect(lossSection.findAll('.aedar-mode-emphasis').map((mode) => mode.text())).toEqual([
      'transports en commun', 'marche', 'transports en commun', 'Vélo LTS 2', 'Vélo LTS4',
    ])
    expect(lossSection.text()).not.toContain('Les hexagones estompés servent de repère spatial')
    expect(lossSection.findAll('.aedar-diversity-loss-map img').map((image) => image.attributes('src'))).toEqual(
      lossMapModes.map((mode) => `https://images.calumrobertson.fr/maps/aedar/v1/22001-${mode}-inline.webp`),
    )
    const mapPanels = lossSection.findAll('.aedar-diversity-loss-map')
    expect(mapPanels.map((panel) => panel.attributes('style'))).toEqual([
      '--mode-ring: color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper));',
      '--mode-ring: var(--cahier-mode-foot);',
      '--mode-ring: color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper));',
      '--mode-ring: var(--cahier-mode-bike);',
    ])
    const inlineMaps = lossSection.findAll('.aedar-diversity-loss-map .map-viewport')
    expect(inlineMaps.every((panel) => !panel.classes().includes('map-viewport--cycling'))).toBe(true)
    expect(lossSection.find('.cahier-map-legend').attributes('aria-label')).toContain(content.territory.name)
    expect(lossSection.find('.cahier-map-legend__ticks').text()).toBe('122844,0607692')
    expect(lossSection.findAll('.cahier-map-legend__ramp .cahier-map-legend__swatch').map((swatch) =>
      swatch.attributes('style'))).toEqual([
      'background-color: #716ca2;',
      'background-color: #8f85b1;',
      'background-color: #ad9ebf;',
      'background-color: #b186a3;',
      'background-color: #ac5b78;',
    ])
    expect(lossSection.text()).toContain('Échelle locale')
    expect(lossSection.text()).not.toContain('hexagones estompés')
  })

  it('renders both mean scalars with named EPCI comparisons through the shared figure primitives', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content, pagination: cahierPaginationFor(payload, content), comparisonOptions: [],
        aedarData: { ...aedarReady, facts: aedarFacts(10, { canonicalUniverse: true }) },
        aedarStatus: 'ready', retryAedar: () => {},
        aedarReferenceTerritoire: { type: 'epci', id: '200000001', nom: 'EPCI X' },
        aedarReferenceData: { ...aedarReferenceReady, facts: aedarFacts(10, { canonicalUniverse: true, territoryId: '200000001', territoryType: 'epci', value: 0.25 }) },
        aedarReferenceStatus: 'ready',
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()
    const overview = wrapper.get('[data-section="aedar-car-overview"]')
    const scalars = overview.findAll('.cahier-figure-scalar')
    expect(scalars).toHaveLength(2)
    expect(scalars.map((scalar) => scalar.get('.cahier-figure-scalar-value').text())).toEqual(['5', '5'])
    expect(scalars.map((scalar) => scalar.get('.cahier-figure-scalar-label').text())).toEqual(['Types d’équipements', 'Établissements'])
    expect(scalars.every((scalar) => scalar.get('.cahier-figure-scalar-label').classes().includes('type-figure-label'))).toBe(true)
    const overviewHtml = overview.element.innerHTML
    expect(overviewHtml.indexOf('class="cahier-prose argument-copy"'))
      .toBeLessThan(overviewHtml.indexOf('class="cahier-evidence-source"'))
    expect(overviewHtml.indexOf('cahier-evidence-source'))
      .toBeLessThan(overviewHtml.indexOf('cahier-figure-scalar'))
    expect(scalars.map((scalar) => scalar.get('.cahier-comparison-value').text())).toEqual(['Groupe comparé : 2,5', 'Groupe comparé : 2,5'])
    expect(scalars[0]!.attributes('aria-label')).toContain('Moyenne — EPCI X : 2,5 types / adresse')
    expect(overview.text()).toContain('15 minutes (moyenne par adresse)')
    const comparisonNotes = overview.findAll('.cahier-comparison-note')
    expect(comparisonNotes).toHaveLength(1)
    expect(comparisonNotes[0]!.text()).toBe('Groupe comparé : moyenne des adresses résidentielles de EPCI X')
    expect(overview.find('.cahier-rank').exists()).toBe(false)
    expect(overview.get('.argument-copy').text()).not.toContain('5 types')
    const exploration = overview.get('.cahier-section-footer button.passarelle-exploration')
    expect(exploration.text()).toBe('En savoir plus')
    expect(exploration.attributes('disabled')).toBeDefined()
    expect(exploration.attributes('href')).toBeUndefined()
  })

  it('keeps the cahier stable without a loading banner while AEDAR data loads', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        comparisonOptions: [],
        aedarData: null,
        aedarStatus: 'loading',
        retryAedar: () => {},
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.aedar-state').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Chargement des agrégats AEDAR')
    expect(wrapper.findComponent(VarianteCahierLibre).exists()).toBe(true)
  })

  it('shows error state with retry when AEDAR data failed', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const retrySpy = { called: false }
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        comparisonOptions: [],
        aedarData: { status: 'error', error: { code: 'publication-unavailable', message: 'N/A' } },
        aedarStatus: 'error',
        retryAedar: () => { retrySpy.called = true },
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.aedar-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('Les données AEDAR ne sont pas disponibles')
    expect(wrapper.findComponent(VarianteCahierLibre).exists()).toBe(true)

    await wrapper.find('button').trigger('click')
    expect(retrySpy.called).toBe(true)
  })

  it('renders the transformed cahier when AEDAR data is ready', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        comparisonOptions: [],
        aedarData: aedarReady,
        aedarStatus: 'ready',
        retryAedar: () => {},
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    // The wrapper should render VarianteCahierLibre with the transformed content
    expect(wrapper.findComponent(VarianteCahierLibre).exists()).toBe(true)

    // The overview, time ramps and equipment profile are independent sibling sections.
    const cahierProps = wrapper.findComponent(VarianteCahierLibre).props()
    expect(cahierProps.aedarAccessEnabled).toBe(true)

    // The AEDAR cahier keeps its own unit and gives the waffle its own section heading/anchor.
    const firstUnit = (cahierProps.content as ThemeContent).units[0]
    expect(firstUnit.sections.map((section) => section.key)).toEqual([
      'aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer',
    ])
    const section = (firstUnit.sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-access') as AedarAccessSection
    const profileSection = (firstUnit.sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-equipment-profile')
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('La ville du 1/12, du 1/6, du 1/4 et du 1/3 d’heure')
    expect(profileSection?.key).toBe('aedar-equipment-profile')
    expect(profileSection?.label).toBe('Au moins un quart des adresses')
    expect(firstUnit.label).toEqual(content.units[0]?.label)
    const introduction = firstUnit.introduction.flat().map((segment) => segment.value).join('')
    expect(introduction).toContain('adresses résidentielles')
    expect(introduction).toContain('5, 10, 15 ou 20 minutes')
    expect(introduction).toContain('BDNB')
    expect(firstUnit.rundown).toEqual([])
    expect(section.lecture).toBeNull()
    expect(section.evidence?.kind).toBe('aedar-access')
    expect(wrapper.find('[data-section="aedar-equipment-profile"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="aedar-access"] .aedar-waffle-grid').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle-grid').exists()).toBe(true)
    const accessSections = wrapper.findAll('[data-section]').slice(0, 5)
    expect(accessSections.map((section) => section.attributes('data-section'))).toEqual([
      'aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer',
    ])
    expect(accessSections.every((section) => !section.find('.concept-group-heading > span').exists())).toBe(true)
    expect(accessSections[2]!.findAll('.access-ramp-cahier--time')).toHaveLength(2)
    const timeRamps = accessSections[2]!.findAll('.access-ramp-cahier--time')
    const timeRamp = timeRamps[0]!
    const territoryLines = () => timeRamp.findAll('path.access-ramp-time-line.access-ramp-line--territory')
    const volumeTerritoryLines = () => timeRamps[1]!.findAll('path.access-ramp-time-line.access-ramp-line--territory')
    expect(territoryLines().map((line) => line.attributes('style'))).toContain(
      'stroke: color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper));',
    )
    const lts4Toggle = accessSections[2]!.get('.aedar-access-mode-selector').findAll('.cahier-figure-legend-toggle').find((toggle) => toggle.text().includes('LTS4'))
    const explorerLts4Toggle = accessSections[4]!.findAll('.cahier-figure-legend-toggle').find((toggle) => toggle.text().includes('LTS4'))
    expect(lts4Toggle).toBeDefined()
    expect(explorerLts4Toggle?.attributes('aria-pressed')).toBe('false')
    await lts4Toggle!.trigger('click')
    expect(territoryLines().map((line) => line.attributes('style'))).toContain('stroke: var(--cahier-mode-bike);')
    expect(volumeTerritoryLines().map((line) => line.attributes('style'))).toContain('stroke: var(--cahier-mode-bike);')
    expect(explorerLts4Toggle?.attributes('aria-pressed')).toBe('true')
    await explorerLts4Toggle!.trigger('click')
    expect(lts4Toggle!.attributes('aria-pressed')).toBe('false')
    expect(accessSections[2]!.find('.blank-map-slot').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').exists()).toBe(true)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').element.compareDocumentPosition(
      wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle').element,
    ) & 2).toBeTruthy()
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').classes()).toContain('argument-copy')
    expect(wrapper.find('.page-subtitle').text()).not.toBe('')
    const sourceLink = wrapper.get('.page-subtitle a.cahier-prose__link')
    expect(sourceLink.text()).toContain('AEDAR')
    expect(sourceLink.find('svg').exists()).toBe(true)
    expect(sourceLink.attributes('target')).toBe('_blank')
    expect(sourceLink.attributes('rel')).toBe('noopener noreferrer')
    const carOverview = wrapper.get('[data-section="aedar-car-overview"]')
    expect(carOverview.findAll('.blank-map-slot')).toHaveLength(1)
    expect(carOverview.get('.blank-map-slot').classes()).toContain('blank-map-slot--car')
    expect(carOverview.get('.argument-copy').text()).toContain('Ces moyennes incluent les adresses sans accès')
    expect(carOverview.find('.cahier-evidence-source').exists()).toBe(true)
    expect(profileSection?.lecture).toBeNull()
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').text()).toContain('25%')
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').text()).toContain('Les transports en commun incluent la marche')
    const profileModes = wrapper.findAll('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation] .aedar-mode-emphasis')
    expect(profileModes.map((item) => item.text())).toEqual([
      'transports en commun', 'vélo LTS2', 'vélo LTS4', 'voiture', 'transports en commun', 'marche',
    ])
    expect(wrapper.find('[data-section="aedar-equipment-profile"] .evidence-placeholder').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] .cahier-evidence-source').exists()).toBe(true)
    const moreInfo = wrapper.find('[data-section="aedar-equipment-profile"] .cahier-section-exploration--unit-footer a')
    expect(moreInfo.text()).toContain('En savoir plus')
    expect(moreInfo.attributes('href')).toContain('#')
    expect(moreInfo.attributes('target')).toBe('_blank')
    if (section.evidence?.kind === 'aedar-access') {
      expect(section.evidence.mapFigureTitle.map((segment) => segment.value).join('')).toBe('Quelle diversité de l’offre est accessible en 15 minutes depuis les adresses résidentielles ?')
      expect(section.evidence.ramps).toHaveLength(2)
    }
  })

  it('keeps TYPEQU selection independent while sharing modes and horizons across AEDAR sections', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        comparisonOptions: [],
        aedarData: aedarExplorerReady(),
        aedarStatus: 'ready',
        retryAedar: () => {},
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    const explorer = wrapper.get('[data-section="aedar-equipment-explorer"]')
    const chartLabels = () => explorer.findAll('svg[role="img"]').map((chart) => chart.attributes('aria-label') ?? '')
    const selection = explorer.get('.aedar-equipment-explorer-selection')
    const typeSelection = selection.get('.aedar-equipment-explorer-type-selection')
    expect(typeSelection.findAll(':scope > *').map((element) => element.text().trim())).toEqual([
      'Équipement sélectionné',
      'BOULANGERIE-PÂTISSERIE (B207)',
      'Choisir un autre équipement',
    ])
    expect(selection.element.lastElementChild).toBe(explorer.get('.aedar-equipment-explorer-horizon').element)
    expect(explorer.get('.aedar-equipment-explorer-selected').attributes('aria-live')).toBe('polite')
    expect(explorer.get('.aedar-equipment-explorer-selected').text()).toContain('BOULANGERIE-PÂTISSERIE (B207)')
    expect(explorer.findAll('figcaption').map((caption) => caption.findAll('span').map((span) => span.text()))).toEqual([
      ['Établissements accessibles (moyenne par adresse)', 'BOULANGERIE-PÂTISSERIE'],
      ['Distribution des établissements accessibles par décile', 'BOULANGERIE-PÂTISSERIE'],
    ])
    expect(chartLabels()).toHaveLength(2)
    expect(chartLabels().every((label) => label.includes('B207') && label.includes('3'))).toBe(true)
    expect(explorer.findAll('.cahier-figure-axis-title--x').map((title) => title.text())).toEqual(['Temps de trajet', 'Décile'])
    expect(explorer.findAll('.cahier-figure-axis-title--y').map((title) => title.text())).toEqual([
      'Volume de l’offre',
      'Nombre d’établissements',
    ])
    expect(explorer.get('.aedar-equipment-explorer-introduction').classes()).toContain('argument-copy')
    const introduction = explorer.get('.aedar-equipment-explorer-introduction')
    const source = explorer.get('.cahier-evidence-source')
    expect(introduction.element.nextElementSibling).toBe(source.element)
    const moreInfo = explorer.get('.cahier-section-footer a.passarelle-exploration')
    expect(moreInfo.text()).toContain('En savoir plus')
    expect(moreInfo.attributes('href')).toContain('#figure-sources')
    const distributionHorizon = explorer.get('[role="group"][aria-label="Temps de trajet de la distribution"]')
    expect(distributionHorizon.find('.cahier-travel-time-label').text()).toBe('Temps de trajet')
    expect(distributionHorizon.find('.cahier-travel-time-label svg').exists()).toBe(true)

    await explorer.get('button[aria-label="Choisir un autre équipement"]').trigger('click')
    const dialog = wrapper.get('dialog[open]')
    await dialog.get('input[type="search"][aria-label="Nom ou code BPE"]').setValue('A129')
    await dialog.get('button[aria-label*="A129"]').trigger('click')

    expect(explorer.get('[role="status"]').text()).toContain('MAIRIE')
    expect(chartLabels().every((label) => label.includes('A129') && label.includes('7'))).toBe(true)
    const lts2 = explorer.findAll('.cahier-figure-legend-toggle').find((toggle) => toggle.text().includes('LTS2'))
    expect(lts2?.attributes('aria-pressed')).toBe('true')
    await lts2!.trigger('click')
    expect(chartLabels().every((label) => !label.includes('LTS2'))).toBe(true)

    await distributionHorizon.get('button[aria-label="10 minutes"]').trigger('click')
    expect(distributionHorizon.get('button[aria-label="10 minutes"]').attributes('aria-pressed')).toBe('true')
    const profile = wrapper.get('[data-section="aedar-equipment-profile"]')
    const profileHorizon = profile.get('.aedar-waffle-horizon')
    expect(profileHorizon.get('button[aria-pressed="true"]').attributes('value')).toBe('10')
    expect(chartLabels()[0]).toContain('20 min')
    expect(chartLabels()[1]).toContain('10 minutes')
    expect(profile.get('.aedar-waffle-grid').attributes('aria-label')).toContain('10 minutes')

    await profileHorizon.get('button[value="5"]').trigger('click')
    expect(distributionHorizon.get('button[aria-label="5 minutes"]').attributes('aria-pressed')).toBe('true')
    expect(chartLabels()[1]).toContain('5 minutes')

    await profile.get('.aedar-waffle-explore').trigger('click')
    const profileDialog = profile.get('dialog[open]')
    const dialogHorizon = profileDialog.get('.aedar-waffle-dialog-horizon')
    expect(dialogHorizon.get('button[aria-pressed="true"]').text()).toBe('5 min')
    await profileDialog.findAll('.aedar-waffle-dialog-horizon button').find((button) => button.text() === '20 min')!.trigger('click')
    expect(profileHorizon.get('button[aria-pressed="true"]').attributes('value')).toBe('20')
    expect(distributionHorizon.get('button[aria-label="20 minutes"]').attributes('aria-pressed')).toBe('true')
    expect(chartLabels()[1]).toContain('20 minutes')
  })

  it('merges the reference territory into per-mode comparison values when versions match', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        comparisonOptions: [],
        aedarData: aedarReady,
        aedarStatus: 'ready',
        retryAedar: () => {},
        aedarReferenceTerritoire: { type: 'epci', id: '200000001', nom: 'EPCI X' },
        aedarReferenceData: aedarReferenceReady,
        aedarReferenceStatus: 'ready',
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    const cahierProps = wrapper.findComponent(VarianteCahierLibre).props()
    const section = ((cahierProps.content as ThemeContent).units[0].sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-access') as AedarAccessSection
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    for (const ramp of section.evidence.ramps) {
      expect(ramp.referenceLabel).toBe('EPCI X')
    }
    // Ten reference types contribute 0.25 each, all remaining types have zero access.
    expect(section.evidence.ramps[0]?.reference?.car).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(section.evidence.ramps[1]?.reference?.walk).toEqual([2.5, 2.5, 2.5, 2.5])
  })

  it('drops the reference when its published version differs from the focal aggregates', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(ProductionMobiliteAedar, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content),
        comparisonOptions: [],
        aedarData: aedarReady,
        aedarStatus: 'ready',
        retryAedar: () => {},
        aedarReferenceTerritoire: { type: 'epci', id: '200000001', nom: 'EPCI X' },
        aedarReferenceData: { ...aedarReferenceReady, contentVersion: 'other-version', provenance: aedarProvenance('other-version') },
        aedarReferenceStatus: 'ready',
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    const cahierProps = wrapper.findComponent(VarianteCahierLibre).props()
    const section = ((cahierProps.content as ThemeContent).units[0].sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-access') as AedarAccessSection
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.ramps.every((ramp) => ramp.reference === null)).toBe(true)
    expect(section.evidence.ramps.every((ramp) => ramp.referenceLabel === null)).toBe(true)
  })
})
