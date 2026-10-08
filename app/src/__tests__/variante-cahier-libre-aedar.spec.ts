import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import VarianteCahierLibreAedar from '@/fiche/prototype/VarianteCahierLibreAedar.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { aedarAccessSection } from '@/fiche/content/aedarAccessSection'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type { AedarAccessSection, ThemeContent } from '@/fiche/content/themeContent'
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

function aedarFacts(count: number, options: { territoryId?: string; territoryType?: 'commune' | 'epci'; value?: number } = {}) {
  const { territoryId = '22001', territoryType = 'commune', value = 0.5 } = options
  return Array.from({ length: count }, (_, index) => ({
    territory_id: territoryId,
    territory_type: territoryType,
    typequ: `TYPEQU${index}`,
    typequ_label: `Type ${index}`,
    identity: {},
    n_addresses: 100,
    n_observed: 100,
    coverage_status: 'covered',
    measures: Object.fromEntries(
      [5, 10, 15, 20].flatMap((duration) =>
        ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) =>
          ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']
            .map((stat) => [`count_${duration}_${mode}_${stat}`, value]),
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
  provenance: aedarProvenance('test-version'),
}

const aedarReferenceReady: Extract<AedarFetchResult, { status: 'ready' }> = {
  status: 'ready',
  facts: aedarFacts(10, { territoryId: '200000001', territoryType: 'epci', value: 0.25 }),
  contentVersion: 'test-version',
  provenance: aedarProvenance('test-version'),
}

describe('VarianteCahierLibre — aedar-access opt-in', () => {
  it('renders blank map slots and both time ramps when aedarAccessEnabled is true', async () => {
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

    // Map slots rendered
    expect(wrapper.find('.blank-map-slots').exists()).toBe(true)
    expect(wrapper.findAll('.blank-map-slot')).toHaveLength(3)

    // Only diversity is rendered in this prototype presentation.
    expect(wrapper.findAll('.access-ramp-cahier--time')).toHaveLength(1)

    // The AEDAR section has no generic Lecture block.
    const heading = wrapper.find('[data-section="aedar-access"] .concept-group-heading')
    expect(heading.find('.concept-group-label').text()).toBe('Accès aux services')
    expect(heading.find('.concept-group-narrative').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-access"] .argument-copy').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-access"] .cahier-section-state').exists()).toBe(false)

    // The section label is not duplicated as a figure title: each figure carries
    // its own descriptive title through the shared figure-title primitive.
    expect(wrapper.findAll('.aedar-access-evidence > .cahier-figure-title')).toHaveLength(0)
    expect(wrapper.find('.blank-map-slots > .cahier-figure-title').text()).toBe("Combien de types d'équipements accessibles en 15 minutes depuis les adresses résidentielles ?")
    expect(wrapper.findAll('.aedar-ramp .cahier-figure-title').map((title) => title.text())).toEqual([
      'Nombre de types d’équipements accessibles (moyenne du territoire)',
    ])

    // Every mode renders a mode-colored territory line and the legend names the modes.
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--car').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--bike').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--bike-light').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--walkTransit').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--walkTransit-light').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.find('.aedar-ramp figcaption').text()).toBe('Diversité de l’offre accessible (moyenne du territoire)')
    expect(wrapper.find('.aedar-ramp .cahier-figure-axis-title--y').text()).toBe('Diversité de l’offre')
    expect(wrapper.find('.aedar-ramp .cahier-figure-axis-title--x').text()).toBe('Temps de trajet')
    const firstRampLegend = wrapper.findAll('.aedar-ramp')[0]!.findAll('.cahier-figure-legend-item')
    expect(firstRampLegend.map((item) => item.text())).toEqual([
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
    expect(tooltip).toContain('À pied')

    // AEDAR maps have no lecture disclosure; the main figure has no horizon marker or territory dots.
    expect(wrapper.find('.blank-map-slots .cahier-figure-lecture').exists()).toBe(false)
    expect(wrapper.find('.aedar-ramp .cahier-figure-lecture').exists()).toBe(false)
    expect(wrapper.find('.aedar-ramp .access-ramp-horizon').exists()).toBe(false)
    expect(wrapper.find('.aedar-ramp .access-ramp-time-point').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading__number').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading__gap-copy').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading__gap--unavailable').exists()).toBe(false)
    expect(wrapper.find('.aedar-reading .cahier-prose').text()).not.toContain('transit_gain')
    expect(wrapper.find('.aedar-reading .foot-emphasis').text()).toContain('Transports en commun')
    expect(wrapper.findAll('.aedar-reading .bike-emphasis').map((item) => item.text())).toEqual(['vélo', 'LTS2', 'LTS4'])
    expect(wrapper.findAll('.aedar-reading .foot-emphasis').map((item) => item.text())).toEqual(['Transports en commun', 'marche'])
    expect(wrapper.find('.aedar-reading__source a').text()).toBe('AEDAR')
    expect(wrapper.find('.aedar-reading__source a').text()).not.toBe('aedar_bretagne')
    expect(wrapper.find('.aedar-reading__source').text().replace(/\s+/gu, ' ').trim()).toBe('AEDAR 2026-v1 · © OpenStreetMap contributors')

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

    // Dashed, mode-colored comparison lines on the sole rendered ramp.
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison').length).toBeGreaterThanOrEqual(5)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--car').length).toBeGreaterThanOrEqual(1)

    // The legend names the five modes plus the explicitly labeled reference territory.
    const firstRampLegend = wrapper.findAll('.aedar-ramp')[0]!.findAll('.cahier-figure-legend-item')
    expect(firstRampLegend.map((item) => item.text())).toEqual([
      'Voiture',
      'Vélo (LTS2)',
      'Vélo (LTS4)',
      'Transports en commun',
      'À pied',
      'EPCI X',
    ])
    const referenceMark = firstRampLegend[5]!.find('.cahier-figure-legend-mark')
    expect(referenceMark.classes()).toContain('cahier-figure-legend-mark--dash')

    // The ramp reading explains the reference honestly — never a fabricated cohort.
    const lecture = wrapper.find('.aedar-access-evidence > .cahier-figure-lecture').text()
    expect(lecture).toContain('EPCI X')
    expect(lecture).toContain('territoire de référence')

    // The reference values land in the tooltip note per mode.
    await wrapper.find('.aedar-ramp [aria-label="Temps d\'accès : 15 min"]').trigger('focus')
    expect(wrapper.find('.aedar-ramp [role="tooltip"]').text()).toContain('EPCI X : 2,5')
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

describe('VarianteCahierLibreAedar wrapper', () => {
  it('shows loading state when AEDAR data is loading', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibreAedar, {
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

    expect(wrapper.find('.aedar-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('Chargement des agrégats AEDAR')
  })

  it('shows error state with retry when AEDAR data failed', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const retrySpy = { called: false }
    const wrapper = mount(VarianteCahierLibreAedar, {
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

    await wrapper.find('button').trigger('click')
    expect(retrySpy.called).toBe(true)
  })

  it('renders the prototype with transformed content when AEDAR data is ready', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibreAedar, {
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

    // The transformed content should have the aedar-access section
    const cahierProps = wrapper.findComponent(VarianteCahierLibre).props()
    expect(cahierProps.aedarAccessEnabled).toBe(true)

    // The transformed section has no Lecture and retains its map figure wording.
    const firstUnit = (cahierProps.content as ThemeContent).units[0]
    const section = firstUnit.sections[0] as unknown as AedarAccessSection
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('Accès aux services')
    expect(firstUnit.label).toEqual(content.units[0]?.label)
    expect(firstUnit.introduction).toEqual(content.units[0]?.introduction)
    expect(firstUnit.rundown).toEqual(content.units[0]?.rundown)
    expect(section.lecture).toBeNull()
    expect(section.evidence?.kind).toBe('aedar-access')
    if (section.evidence?.kind === 'aedar-access') {
      expect(section.evidence.mapFigureTitle.map((segment) => segment.value).join('')).toBe("Combien de types d'équipements accessibles en 15 minutes depuis les adresses résidentielles ?")
      expect(section.evidence.ramps).toHaveLength(2)
    }
  })

  it('merges the reference territory into per-mode comparison values when versions match', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibreAedar, {
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
    const section = (cahierProps.content as ThemeContent).units[0].sections[0] as unknown as AedarAccessSection
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    for (const ramp of section.evidence.ramps) {
      expect(ramp.referenceLabel).toBe('EPCI X')
    }
    // 10 reference types at 0.25 share: diversity sums to 2.5, count-per-type averages to 0.25.
    expect(section.evidence.ramps[0]?.reference?.car).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(section.evidence.ramps[1]?.reference?.walk).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('drops the reference when its published version differs from the focal aggregates', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibreAedar, {
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
    const section = (cahierProps.content as ThemeContent).units[0].sections[0] as unknown as AedarAccessSection
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.ramps.every((ramp) => ramp.reference === null)).toBe(true)
    expect(section.evidence.ramps.every((ramp) => ramp.referenceLabel === null)).toBe(true)
  })
})
