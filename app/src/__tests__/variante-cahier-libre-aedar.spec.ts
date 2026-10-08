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

function aedarFacts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    territory_id: '22001',
    territory_type: 'commune' as const,
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
            .map((stat) => [`count_${duration}_${mode}_${stat}`, 0.5]),
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

const aedarReady: Extract<AedarFetchResult, { status: 'ready' }> = {
  status: 'ready',
  facts: aedarFacts(10),
  contentVersion: 'test-version',
  provenance: {
    contentVersion: 'test-version',
    sources: [{
      source_id: 'aedar_bretagne',
      vintage_id: '2026-v1',
      source_url: 'https://example.com',
      licence: 'Licence Ouverte',
      attribution: 'AEDAR',
      reference_date: '2026-01-01',
      publication_date: '2026-09-30',
    }],
  },
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

    // Both ramps rendered
    expect(wrapper.findAll('.access-ramp-cahier--time')).toHaveLength(2)

    // Section title and reading use the shared section primitive (label + marelle + prose),
    // exactly like the production page 1/page 2 sections.
    const heading = wrapper.find('[data-section="aedar-access"] .concept-group-heading')
    expect(heading.find('.concept-group-label').text()).toBe('Accès aux services')
    expect(heading.find('.concept-group-narrative').text()).toBe('Prototype AEDAR : l’accès depuis les adresses résidentielles')
    expect(wrapper.find('[data-section="aedar-access"] .argument-copy').text()).toContain('prototype')

    // The section label is not duplicated as a figure title: each figure carries
    // its own descriptive title through the shared figure-title primitive.
    expect(wrapper.findAll('.aedar-access-evidence > .cahier-figure-title')).toHaveLength(0)
    expect(wrapper.find('.blank-map-slots > .cahier-figure-title').text()).toBe('Cartes d’accès aux services, par mode')
    expect(wrapper.findAll('.aedar-ramp .cahier-figure-title').map((title) => title.text())).toEqual([
      'Diversité des types d’équipements — Voiture',
      'Équipements accessibles par type — Voiture',
    ])

    // Honest empty-state reading under the map slots
    expect(wrapper.find('.blank-map-slots .cahier-figure-lecture').text()).toContain('aucune carte n’est affichée')

    // The section has a reading: no "lecture indisponible" placeholder may follow the evidence.
    expect(wrapper.find('[data-section="aedar-access"] .evidence-placeholder').exists()).toBe(false)
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

    // The transformed section carries its lecture and map figure wording (content layer owns it)
    const firstUnit = (cahierProps.content as ThemeContent).units[0]
    const section = firstUnit.sections[0] as unknown as AedarAccessSection
    expect(section.key).toBe('aedar-access')
    expect(section.lecture?.marelle).toBe('Prototype AEDAR : l’accès depuis les adresses résidentielles')
    expect(section.evidence?.kind).toBe('aedar-access')
    if (section.evidence?.kind === 'aedar-access') {
      expect(section.evidence.mapFigureTitle).toBe('Cartes d’accès aux services, par mode')
      expect(section.evidence.ramps).toHaveLength(2)
    }
  })
})
