import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

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

function averageRows(): Indicateur[] {
  return [
    ['avg_tot_car', 1_467.78, 'équipements / bâtiment'],
    ['avg_tot_b', 578.55, 'équipements / bâtiment'],
    ['avg_tot_t', 256.89, 'équipements / bâtiment'],
    ['avg_div_car', 48.63, 'types d’équipement / bâtiment'],
    ['avg_div_b', 37.23, 'types d’équipement / bâtiment'],
    ['avg_div_t', 30.1, 'types d’équipement / bâtiment'],
  ].map(([key, value, unit]) => ({
    territoire: '22001',
    type: 'commune' as const,
    theme: 'mobilite' as const,
    key: key as string,
    detail: null,
    value: value as number,
    unit: unit as string,
    rang_epci: 1,
    rang_epci_n: 2,
    rang_dep: null,
    rang_dep_n: null,
    rang_reg: null,
    rang_reg_n: null,
    ...vintage,
  }))
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: [...indicateursMobiliteFixture, ...totalLossRows(), ...averageRows()],
  histoires: histoiresMobiliteFixture,
  apercu: null,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  profilsAccesBpe: [
    {
      territoire: '22001',
      type: 'commune',
      profil: 'inaccessible-20-minutes',
      profil_libelle: 'Inaccessible ou presque en 20 minutes',
      nombre_typequ: 2,
      exemplar_typequ: 'A128',
      exemplar_libelle: 'France services',
      exemplar_c: 0.9,
      exemplar_b: 0.1,
      exemplar_t: 0.1,
    },
  ],
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

async function render(content: ThemeContent, presentation: 'ruled' | 'plain' = 'ruled') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(VarianteCahierLibre, {
    props: { content, pagination: paginationFor(content), presentation },
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

  it('renders the body content, pagination, evidence, sources, and existing new-tab links', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const wrapper = await render(content)

    expect(wrapper.find('.cahier-cover').exists()).toBe(false)
    expect(wrapper.find('.cahier-page').text()).toContain('Accès aux services')
    expect(wrapper.findAll('.concept-group h3').map((heading) => heading.text())).toEqual([
      'Résumé',
      'Profils d’accès par mode',
      'Services essentiels',
      "Distribution de l'accès par bâtiment",
    ])
    expect(wrapper.findAll('.cahier-marelle-anchor')).toHaveLength(2)
    expect(wrapper.find('.summary-evidence').exists()).toBe(true)
    expect(wrapper.find('.summary-evidence').text()).toContain('Équipements accessibles')
    expect(wrapper.find('.summary-evidence').text()).toContain('Types d’équipements accessibles')
    expect(wrapper.find('.summary-evidence').text()).toContain('1 467,8')
    expect(wrapper.findAll('.summary-value')).toHaveLength(6)
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(true)
    expect(wrapper.find('.mode-figures').exists()).toBe(false)
    expect(wrapper.find('.summary-losses').exists()).toBe(false)
    expect(wrapper.find('.access-figures').exists()).toBe(true)
    expect(wrapper.find('.bpe-evidence').text()).toContain('Composition des profils d’accès')
    expect(wrapper.find('.bpe-evidence').text()).toContain('2 types')
    expect(wrapper.find('.bpe-evidence').text()).toContain('France services')
    expect(wrapper.find('.bpe-evidence').text()).not.toContain('A128')
    expect(wrapper.findAll('.bpe-profile-column')).toHaveLength(1)
    expect(wrapper.find('.bpe-profile-donut').attributes('aria-label')).toContain('10 %')
    expect(wrapper.find('.bpe-profile-donut').attributes('aria-label')).toContain('90 %')
    expect(wrapper.find('.sources-page').text()).toContain(content.sourceRegister[0]?.source)
    expect(wrapper.find('.page-number').text()).toContain('/01')
    expect(wrapper.find('.page-subtitle').text()).toContain('1,2 millions de bâtiments')
    expect(wrapper.find('.page-subtitle strong.region-emphasis').text()).toBe('1,2 millions')
    expect(wrapper.findAll('.page-subtitle p').every((paragraph) => paragraph.classes().includes('cahier-baseline-first-line'))).toBe(true)
    expect(wrapper.findAll('.argument-copy p').every((paragraph) => paragraph.classes().includes('cahier-baseline-first-line'))).toBe(true)

    const links = wrapper.findAll('a[target="_blank"]')
    expect(links).toHaveLength(7)
    const moreLinks = links.filter((link) => link.text().includes('En savoir plus'))
    expect(moreLinks).toHaveLength(2)
    expect(moreLinks.every((link) => link.classes().includes('passarelle-exploration--plain'))).toBe(true)
    expect(links.filter((link) => /^\d+(?:er|e)\/\d+$/.test(link.text()))).toHaveLength(5)
    expect(links.filter((link) => link.attributes('href')?.includes('/indicateurs/mobilite/tot_loss_t'))).toHaveLength(1)
    expect(wrapper.findAll('.cahier-section-exploration')).toHaveLength(2)
    expect(wrapper.findAll('.cahier-figure-title')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-reference-note')).toHaveLength(11)
    expect(wrapper.findAll('.cahier-reference-note').every((note) => note.text().includes('Médiane'))).toBe(true)
    expect(wrapper.find('.cahier-reference-note').text()).toContain('Médiane communes de l’EPCI')
    expect(wrapper.text()).toContain('À pied + TC')
    expect(wrapper.text()).toContain('À vélo + TC')
    expect(wrapper.text()).not.toContain('À pied ou en transports en commun')
    expect(wrapper.find('.access-tooltip').text()).toContain('Médiane')
    expect(wrapper.find('.summary-value strong.is-extreme').exists()).toBe(true)
    expect(wrapper.find('.rank-emphasis.is-extreme').exists()).toBe(true)
    for (const link of links) {
      expect(link.attributes('rel')).toContain('noopener')
      expect(link.attributes('rel')).toContain('noreferrer')
    }
  })

  it('keeps two masonry rails on desktop when the inner content rail is narrower than the breakpoint', async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('figure-stack') ? 688 : 0
      },
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true, media: '(min-width: 1281px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
    })

    try {
      const wrapper = await render(resolveMobiliteThemeContent(factsForTarget()))
      const groups = wrapper.findAll('.concept-group')

      expect(wrapper.find('.figure-stack').classes()).toContain('figure-stack--ready')
      expect(groups[0]?.attributes('style')).toContain('--masonry-width: calc(50% - var(--masonry-half-gap));')
      expect(groups[1]?.attributes('style')).toContain('--masonry-left: calc(50% + var(--masonry-half-gap));')
    } finally {
      if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
      if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
      else delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
    }
  })

  it('offers a plain Variant E treatment and falls to one rail at the 150% zoom breakpoint', async () => {
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: '(min-width: 1281px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(), })),
    })

    try {
      const wrapper = await render(resolveMobiliteThemeContent(factsForTarget()), 'plain')
      const groups = wrapper.findAll('.concept-group')

      expect(wrapper.find('.cahier').classes()).toContain('cahier--sans-grille')
      expect(groups.every((group) => group.attributes('style')?.includes('--masonry-width: 100%;'))).toBe(true)
      expect(groups.every((group) => group.attributes('style')?.includes('--masonry-left: 0px;'))).toBe(true)
      expect(wrapper.findAll('.cahier-section-exploration--unit-footer')).toHaveLength(4)
      const unitExplorations = wrapper.findAll('.cahier-section-exploration--unit-footer')
      expect(unitExplorations.every((link) => link.element.parentElement?.classList.contains('concept-group'))).toBe(true)
      expect(unitExplorations.every((link) => link.find('a').attributes('href')?.startsWith('/indicateurs/mobilite/'))).toBe(true)
    } finally {
      if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
      else delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
    }
  })

  it('uses the narrative sentence as E’s single unit heading without the Marelle duplicate', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const firstSection = content.units[0]?.sections[0]
    const wrapper = await render(content, 'plain')

    expect(firstSection?.lecture?.marelle).toBeTruthy()
    expect(wrapper.find('.concept-group-narrative').text()).toBe(firstSection?.lecture?.marelle)
    expect(wrapper.find('.concept-group-narrative').element.tagName).toBe('H3')
    expect(wrapper.find('.concept-group-heading-copy .concept-group-label').text()).toBe(firstSection?.label)
    expect(wrapper.findAll('.concept-group-narrative').map((heading) => heading.text())).toEqual([
      'Ce que l’on perd sans voiture',
      'Service minimum assuré?',
      'Tous les équipements ne se valent pas...',
      '... Tous les bâtiments non plus',
    ])
    expect(wrapper.findAll('.cahier-marelle-anchor')).toHaveLength(0)
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

    expect(wrapper.find('[data-section="distribution-acces-par-batiment"]').classes()).toContain(
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
      summary: {
        availability: 'absent',
        accessibleEquipment: Object.fromEntries(
          Object.entries(facts.mobility.access.summary.accessibleEquipment).map(([mode, value]) => [
            mode,
            { ...value, value: null, availability: 'absent', provenance: null, comparison: null },
          ]),
        ) as typeof facts.mobility.access.summary.accessibleEquipment,
        accessibleTypes: Object.fromEntries(
          Object.entries(facts.mobility.access.summary.accessibleTypes).map(([mode, value]) => [
            mode,
            { ...value, value: null, availability: 'absent', provenance: null, comparison: null },
          ]),
        ) as typeof facts.mobility.access.summary.accessibleTypes,
      },
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
    facts.mobility.bpeAccess = { availability: 'absent', profiles: [] }
    const wrapper = await render(resolveMobiliteThemeContent(facts))

    expect(wrapper.findAll('.cahier-section--absent')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-section-state')).toHaveLength(4)
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(false)
    expect(wrapper.find('.summary-evidence').exists()).toBe(false)
    expect(wrapper.find('.access-figures').exists()).toBe(false)
    expect(wrapper.findAll('a[target="_blank"]')).toHaveLength(0)
  })
})
