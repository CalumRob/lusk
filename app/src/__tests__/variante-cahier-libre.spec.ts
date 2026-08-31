import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { nomTerritoirePourAffichage, territoryFactsFor } from '@/fiche/content/territoryFacts'
import type {
  MobiliteAccessReader,
  TerritoryFacts,
} from '@/fiche/content/territoryFacts'
import type { ThemeContent } from '@/fiche/content/themeContent'
import {
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Indicateur, Payload } from '@/payload/types'
import { routes } from '@/router'

const vintage = {
  vintage_source: 'Snapshot Mobilité',
  vintage_version: '2026-02',
  vintage_date_reference: '2026-02-28',
  vintage_date_publication: '2026-08-06',
}

const accessReader: MobiliteAccessReader = () => ({
  totalBatimentsBretons: 1_175_048,
  batimentsTerritoire: 65_078,
  provenance: {
    sourceId: 'mobilite_snapshot',
    source: 'Snapshot Mobilité',
    version: '2026-02',
    referenceDate: '2026-02-28',
    publicationDate: '2026-08-06',
  },
  parts: {
    administration: { c: 1, b: 0.86, t: 0.78 },
    alimentation: { c: 1, b: 0.89, t: 0.86 },
    sante: { c: 1, b: 0.86, t: 0.82 },
    banque: { c: 1, b: 0.84, t: 0.78 },
    ecole: { c: 1, b: 0.88, t: 0.83 },
  },
})

function totalLossRows(): Indicateur[] {
  return [
    {
      territoire: '22001',
      type: 'commune',
      theme: 'mobilite',
      key: 'tot_loss_t',
      detail: null,
      value: 4,
      unit: 'accès perdus',
      rang_epci: 1,
      rang_epci_n: 2,
      rang_dep: null,
      rang_dep_n: null,
      rang_reg: null,
      rang_reg_n: null,
      ...vintage,
    },
    {
      territoire: '22001',
      type: 'commune',
      theme: 'mobilite',
      key: 'tot_loss_b',
      detail: null,
      value: 2,
      unit: 'accès perdus',
      rang_epci: 1,
      rang_epci_n: 2,
      rang_dep: null,
      rang_dep_n: null,
      rang_reg: null,
      rang_reg_n: null,
      ...vintage,
    },
  ]
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: [...indicateursMobiliteFixture, ...totalLossRows()],
  histoires: histoiresMobiliteFixture,
  apercu: null,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: structuredClone(metadonneesThemesFixtures.mobilite) },
}

function factsForTarget(): TerritoryFacts {
  const facts = territoryFactsFor(payload, '22001', accessReader)
  if (!facts) throw new Error('Test target should exist')
  return facts
}

function paginationFor(content: ThemeContent) {
  return cahierPaginationFor(payload, content)
}

async function render(content: ThemeContent) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(VarianteCahierLibre, {
    props: { content, pagination: paginationFor(content) },
    global: { plugins: [router] },
  })
  await router.isReady()
  await flushPromises()
  return wrapper
}

describe('Variante D — le seam ThemeContent → Cahier', () => {
  it('uses the public short name for an EPCI without changing its source identity', () => {
    expect(
      nomTerritoirePourAffichage({
        code: '200042174',
        type: 'epci',
        name: "Communauté d'agglomération Lorient Agglomération",
        department: '56',
        epci: null,
      }),
    ).toBe('Lorient Agglomération')
  })

  it('renders resolved complete content, pagination, evidence, sources, and existing new-tab links', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const wrapper = await render(content)

    expect(wrapper.find('.cahier-cover').exists()).toBe(true)
    expect(wrapper.find('.cahier-page').text()).toContain('Accès aux services')
    expect(wrapper.findAll('.concept-group h3').map((heading) => heading.text())).toEqual([
      'Perte de diversité',
      'Perte totale d’accès',
      'Services essentiels',
    ])
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(true)
    expect(wrapper.find('.mode-figures').exists()).toBe(true)
    expect(wrapper.find('.comparison-figure').exists()).toBe(true)
    expect(wrapper.find('.access-figures').exists()).toBe(true)
    expect(wrapper.find('.sources-page').text()).toContain(content.sourceRegister[0]?.source)
    expect(wrapper.find('.page-number').text()).toContain('/01')
    expect(wrapper.find('.page-subtitle').text()).toContain('1,2 millions de bâtiments')
    expect(wrapper.find('.page-subtitle strong.region-emphasis').text()).toBe('1,2 millions')
    expect(wrapper.findAll('.page-subtitle p').every((paragraph) => paragraph.classes().includes('cahier-baseline-first-line'))).toBe(true)
    expect(wrapper.findAll('.argument-copy p').every((paragraph) => paragraph.classes().includes('cahier-baseline-first-line'))).toBe(true)

    const links = wrapper.findAll('a[target="_blank"]')
    expect(links).toHaveLength(12)
    const moreLinks = links.filter((link) => link.text().includes('En savoir plus'))
    expect(moreLinks).toHaveLength(3)
    expect(moreLinks.every((link) => link.classes().includes('passarelle-exploration--plain'))).toBe(true)
    expect(links.filter((link) => /^\d+(?:er|e)\/\d+$/.test(link.text()))).toHaveLength(9)
    expect(links.filter((link) => link.attributes('href')?.includes('/indicateurs/mobilite/tot_loss_t'))).toHaveLength(4)
    expect(wrapper.findAll('.cahier-section-exploration')).toHaveLength(3)
    expect(wrapper.findAll('.cahier-figure-title')).toHaveLength(3)
    expect(wrapper.findAll('.cahier-reference-note')).toHaveLength(7)
    expect(wrapper.findAll('.cahier-reference-note').every((note) => note.text().includes('Médiane'))).toBe(true)
    expect(wrapper.find('.cahier-reference-note').text()).toContain('Médiane communes de l’EPCI')
    expect(wrapper.text()).toContain('À pied + TC')
    expect(wrapper.text()).toContain('À vélo + TC')
    expect(wrapper.text()).not.toContain('À pied ou en transports en commun')
    expect(wrapper.find('.access-tooltip').text()).toContain('Médiane')
    expect(wrapper.find('.mode-value.is-extreme').exists()).toBe(true)
    expect(wrapper.find('.rank-emphasis.is-extreme').exists()).toBe(true)
    for (const link of links) {
      expect(link.attributes('rel')).toContain('noopener')
      expect(link.attributes('rel')).toContain('noreferrer')
    }
  })

  it('renders incomplete sections without inventing a figure or lecture', async () => {
    const facts = structuredClone(factsForTarget())
    facts.mobility.losses.distributionWalkTransit = {
      ...facts.mobility.losses.distributionWalkTransit!,
      densities: [null, ...facts.mobility.losses.distributionWalkTransit!.densities.slice(1)],
    }
    facts.mobility.access.byService.administration.walkTransit = {
      ...facts.mobility.access.byService.administration.walkTransit,
      value: null,
      availability: 'incomplete',
      comparison: null,
    }
    const content = resolveMobiliteThemeContent(facts)
    const wrapper = await render(content)

    expect(wrapper.find('[data-section="perte-de-diversite"]').classes()).toContain(
      'cahier-section--incomplete',
    )
    expect(wrapper.find('[data-section="services-essentiels"]').classes()).toContain(
      'cahier-section--incomplete',
    )
    expect(wrapper.find('.cahier-section-state').text()).toContain('Lecture indisponible')
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(false)
    expect(wrapper.find('.access-figures').exists()).toBe(true)
  })

  it('renders absent sections as an honest, link-free state', async () => {
    const facts = structuredClone(factsForTarget())
    facts.mobility.indicators = []
    facts.mobility.losses = {
      diversityWalkTransit: { ...facts.mobility.losses.diversityWalkTransit, value: null, availability: 'absent', provenance: null },
      diversityBike: { ...facts.mobility.losses.diversityBike, value: null, availability: 'absent', provenance: null },
      distributionWalkTransit: null,
      distributionPeers: [],
    }
    facts.mobility.access = {
      availability: 'absent',
      totalBuildings: { ...facts.mobility.access.totalBuildings, value: null, availability: 'absent', provenance: null },
      totalBrittanyBuildings: { ...facts.mobility.access.totalBrittanyBuildings, value: null, availability: 'absent', provenance: null },
      byService: Object.fromEntries(
        Object.entries(facts.mobility.access.byService).map(([service, modes]) => [
          service,
          Object.fromEntries(
            Object.entries(modes).map(([mode, value]) => [
              mode,
              { ...value, value: null, availability: 'absent', provenance: null, comparison: null },
            ]),
          ),
        ]),
      ) as typeof facts.mobility.access.byService,
    }
    const wrapper = await render(resolveMobiliteThemeContent(facts))

    expect(wrapper.findAll('.cahier-section--absent')).toHaveLength(3)
    expect(wrapper.findAll('.cahier-section-state')).toHaveLength(3)
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(false)
    expect(wrapper.find('.comparison-figure').exists()).toBe(false)
    expect(wrapper.find('.access-figures').exists()).toBe(false)
    expect(wrapper.findAll('a[target="_blank"]')).toHaveLength(0)
  })
})
