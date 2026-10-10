import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import VarianteCahierLibreAedar from '@/fiche/prototype/VarianteCahierLibreAedar.vue'
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
  const types = options.canonicalUniverse ? AEDAR_TYPEQU_REGISTRY : Array.from({ length: count }, (_, index) => ({ code: `TYPEQU${index}`, label: `Type ${index}` }))
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
    expect(heading.find('h3').text()).toBe('Diversité de l’offre')
    expect(wrapper.find('[data-section="aedar-access"] .argument-copy').text()).toContain('Les Transports en commun incluent aussi la marche')
    expect(wrapper.find('[data-section="aedar-access"] .cahier-section-state').exists()).toBe(false)

    // The section label is not duplicated as a figure title: each figure carries
    // its own descriptive title through the shared figure-title primitive.
    expect(wrapper.findAll('.aedar-access-evidence > .cahier-figure-title')).toHaveLength(0)
    expect(wrapper.find('.blank-map-slots > .cahier-figure-title').text()).toBe('Quelle diversité de l’offre est accessible en 15 minutes depuis les adresses résidentielles ?')
    expect(wrapper.findAll('.aedar-ramp .cahier-figure-title').map((title) => title.text())).toEqual([
      'Diversité de l’offre accessible (moyenne du territoire)',
    ])

    // The selectable ramp defaults to car, transit and LTS2.
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--car').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--bike').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--walkTransit').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--bike-light')).toHaveLength(0)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--walkTransit-light')).toHaveLength(0)
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
    expect(tooltip).toContain('Transports en commun')

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
    expect(wrapper.find('.aedar-reading .cahier-evidence-source a').text()).toBe('AEDAR')
    expect(wrapper.find('.aedar-reading .cahier-evidence-source a').text()).not.toBe('aedar_bretagne')
    expect(wrapper.find('.aedar-reading .cahier-evidence-source').text().replace(/\s+/gu, ' ').trim()).toBe('AEDAR 2026-v1')

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
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison')).toHaveLength(3)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--car').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--walkTransit').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.aedar-ramp .access-ramp-line--comparison.access-ramp-line--bike').length).toBeGreaterThanOrEqual(1)

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
  it('renders both mean scalars with named EPCI comparisons through the shared figure primitives', async () => {
    const content = baseContent()
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibreAedar, {
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
    const prose = overview.get('.argument-copy').element
    const source = overview.get('.cahier-evidence-source').element
    expect(prose.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(source.compareDocumentPosition(scalars[0]!.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

    // The access maps/ramps and equipment profile are independent sibling sections.
    const cahierProps = wrapper.findComponent(VarianteCahierLibre).props()
    expect(cahierProps.aedarAccessEnabled).toBe(true)

    // The AEDAR prototype keeps its own unit and gives the waffle its own section heading/anchor.
    const firstUnit = (cahierProps.content as ThemeContent).units[0]
    expect(firstUnit.sections.map((section) => section.key)).toEqual(['aedar-car-overview', 'aedar-access', 'aedar-equipment-profile'])
    const section = (firstUnit.sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-access') as AedarAccessSection
    const profileSection = (firstUnit.sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-equipment-profile')
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('Diversité de l’offre')
    expect(profileSection?.key).toBe('aedar-equipment-profile')
    expect(profileSection?.label).toBe('Types d’équipements par premier mode d’accès')
    expect(firstUnit.label).toEqual(content.units[0]?.label)
    const introduction = firstUnit.introduction.flat().map((segment) => segment.value).join('')
    expect(introduction).toContain('adresses résidentielles')
    expect(introduction).toContain('15 minutes')
    expect(introduction).not.toContain('bâtiment')
    expect(introduction).not.toContain('20 minutes')
    expect(firstUnit.rundown).toEqual([])
    expect(section.lecture).toBeNull()
    expect(section.evidence?.kind).toBe('aedar-access')
    expect(wrapper.find('[data-section="aedar-equipment-profile"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="aedar-access"] .aedar-waffle-grid').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle-grid').exists()).toBe(true)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').exists()).toBe(true)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').element.compareDocumentPosition(
      wrapper.find('[data-section="aedar-equipment-profile"] .aedar-waffle').element,
    ) & 2).toBeTruthy()
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').classes()).toContain('argument-copy')
    expect(wrapper.find('.page-subtitle').text()).not.toBe('')
    const carOverview = wrapper.get('[data-section="aedar-car-overview"]')
    expect(carOverview.findAll('.blank-map-slot')).toHaveLength(1)
    expect(carOverview.get('.blank-map-slot').classes()).toContain('blank-map-slot--car')
    expect(carOverview.get('.argument-copy').text()).toContain('pas disponibles')
    expect(carOverview.find('.cahier-evidence-source').exists()).toBe(true)
    expect(profileSection?.lecture).toBeNull()
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').text()).toContain('25%')
    expect(wrapper.find('[data-section="aedar-equipment-profile"] [data-aedar-profile-explanation]').text()).toContain('Les transports en commun incluent la marche')
    expect(wrapper.find('[data-section="aedar-equipment-profile"] .evidence-placeholder').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-equipment-profile"] .cahier-evidence-source').exists()).toBe(true)
    const moreInfo = wrapper.find('[data-section="aedar-equipment-profile"] .cahier-section-exploration--unit-footer a')
    expect(moreInfo.text()).toContain('En savoir plus')
    expect(moreInfo.attributes('href')).toContain('#')
    if (section.evidence?.kind === 'aedar-access') {
      expect(section.evidence.mapFigureTitle.map((segment) => segment.value).join('')).toBe('Quelle diversité de l’offre est accessible en 15 minutes depuis les adresses résidentielles ?')
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
    const section = ((cahierProps.content as ThemeContent).units[0].sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-access') as AedarAccessSection
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
    const section = ((cahierProps.content as ThemeContent).units[0].sections as readonly ContentSection[]).find((candidate) => candidate.key === 'aedar-access') as AedarAccessSection
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.ramps.every((ramp) => ramp.reference === null)).toBe(true)
    expect(section.evidence.ramps.every((ramp) => ramp.referenceLabel === null)).toBe(true)
  })
})
