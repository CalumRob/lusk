import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { nomTerritoirePourAffichage, territoryFactsFor } from '@/fiche/content/territoryFacts'
import type {
  NumericFact,
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
  indicateurs: [
    ...indicateursMobiliteFixture,
    ...totalLossRows(),
    ...averageRows(),
    ...[
      ['22001', 65_078],
      ['53', 1_223_578],
    ].map(([territoire, value]) => ({
      territoire: territoire as string,
      type: territoire === '53' ? 'region' as const : 'commune' as const,
      theme: 'mobilite' as const,
      key: 'nb_buildings',
      detail: null,
      value: value as number,
      unit: 'bâtiments',
      rang_epci: null,
      rang_epci_n: null,
      rang_dep: null,
      rang_dep_n: null,
      rang_reg: null,
      rang_reg_n: null,
      ...vintage,
    })),
  ],
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
    {
      territoire: '22001',
      type: 'commune',
      profil: 'acces-pied-tc',
      profil_libelle: 'Accès à pied ou en TC possible',
      nombre_typequ: 11,
      exemplar_typequ: 'B304',
      exemplar_libelle: 'Équipement de proximité',
      exemplar_c: 0.9,
      exemplar_b: 0.5,
      exemplar_t: 0.4,
    },
    {
      territoire: '22001',
      type: 'commune',
      profil: 'voiture-requise',
      profil_libelle: 'La voiture est requise',
      nombre_typequ: 40,
      exemplar_typequ: 'C108',
      exemplar_libelle: 'Équipement spécialisé',
      exemplar_c: 0.8,
      exemplar_b: 0.2,
      exemplar_t: 0.1,
    },
    {
      territoire: '22002',
      type: 'commune',
      profil: 'acces-pied-tc',
      profil_libelle: 'Accès à pied ou en TC possible',
      nombre_typequ: 10,
      exemplar_typequ: 'A208',
      exemplar_libelle: 'Agence postale',
      exemplar_c: 1,
      exemplar_b: 0.74,
      exemplar_t: 0.72,
    },
    {
      territoire: '22002',
      type: 'commune',
      profil: 'voiture-requise',
      profil_libelle: 'La voiture est requise',
      nombre_typequ: 42,
      exemplar_typequ: 'F111',
      exemplar_libelle: 'Plateaux et terrains de jeux extérieurs',
      exemplar_c: 1,
      exemplar_b: 0,
      exemplar_t: 0,
    },
    {
      territoire: '22002',
      type: 'commune',
      profil: 'inaccessible-20-minutes',
      profil_libelle: 'Inaccessible ou presque en 20 minutes',
      nombre_typequ: 1,
      exemplar_typequ: 'C303',
      exemplar_libelle: 'Lycée technique agricole',
      exemplar_c: 0.03,
      exemplar_b: 0,
      exemplar_t: 0,
    },
  ],
  themeMetadata: { mobilite: structuredClone(metadonneesThemesFixtures.mobilite) },
}

function factsForTarget(): TerritoryFacts {
  const facts = territoryFactsFor(payload, '22001')
  if (!facts) throw new Error('Test target should exist')
  return facts
}

function withMedian(fact: NumericFact, value: number): NumericFact {
  if (!fact.comparison) throw new Error(`Expected a comparison for ${fact.key}`)
  return {
    ...fact,
    comparison: {
      ...fact.comparison,
      reference: { kind: 'median', value },
    },
  }
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
    expect(wrapper.find('.summary-evidence .cahier-figure-title').text()).toBe('Équipements accessibles en 20 min., moyenne')
    expect(wrapper.find('.summary-evidence').text()).toContain('Équipements accessibles en 20 min., moyenne')
    expect(wrapper.find('.summary-evidence').text()).toContain('Types d’équipements accessibles')
    expect(wrapper.find('.summary-evidence').text()).toContain('1 467,8')
    expect(wrapper.findAll('.summary-value')).toHaveLength(6)
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(true)
    expect(wrapper.find('.distribution-cahier').classes()).toContain('cahier-figure-frame')
    expect(wrapper.findAll('.cahier-figure-frame')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-figure-frame .cahier-figure-axis-title')).toHaveLength(4)
    expect(wrapper.findAll('.summary-evidence .cahier-figure-axis')).toHaveLength(0)
    expect(wrapper.findAll('.access-figure-collection .cahier-figure-axis')).toHaveLength(0)
    expect(wrapper.find('.mode-figures').exists()).toBe(false)
    expect(wrapper.find('.summary-losses').exists()).toBe(false)
    expect(wrapper.find('.access-figures').exists()).toBe(true)
    expect(wrapper.find('.bpe-evidence').text()).toContain('Profils d’accès par mode')
    expect(wrapper.find('.bpe-evidence').text()).toContain('2 types')
    expect(wrapper.find('.bpe-evidence').text()).toContain('France services')
    expect(wrapper.find('.bpe-evidence').text()).not.toContain('A128')
    expect(wrapper.findAll('.bpe-profile-column')).toHaveLength(4)
    const inaccessibleProfile = wrapper.find('[data-profile="inaccessible-20-minutes"] .bpe-profile-donut')
    expect(inaccessibleProfile.attributes('aria-label')).toContain('10 %')
    expect(inaccessibleProfile.attributes('aria-label')).toContain('90 %')
    expect(wrapper.find('.sources-page').text()).toContain(content.sourceRegister[0]?.source)
    expect(wrapper.find('.page-number').text()).toContain('/01')
    expect(wrapper.find('.page-subtitle').text()).toContain('1,2 millions de bâtiments')
    expect(wrapper.find('.page-subtitle strong.region-emphasis').text()).toBe('1,2 millions')
    expect(wrapper.findAll('.page-subtitle p').every((paragraph) => paragraph.classes().includes('cahier-baseline-first-line'))).toBe(true)
    expect(wrapper.findAll('.argument-copy p').every((paragraph) => paragraph.classes().includes('cahier-baseline-first-line'))).toBe(true)

    const links = wrapper.findAll('a[target="_blank"]')
    expect(links).toHaveLength(17)
    const moreLinks = links.filter((link) => link.text().includes('En savoir plus'))
    expect(moreLinks).toHaveLength(2)
    expect(moreLinks.every((link) => link.classes().includes('passarelle-exploration--plain'))).toBe(true)
    expect(links.filter((link) => /^\d+(?:er|e)\/\d+$/.test(link.text()))).toHaveLength(15)
    expect(links.filter((link) => link.attributes('href')?.includes('/indicateurs/mobilite/tot_loss_t'))).toHaveLength(7)
    expect(wrapper.findAll('.cahier-section-exploration')).toHaveLength(2)
    expect(wrapper.findAll('.cahier-figure-title')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-reference-note')).toHaveLength(15)
    expect(wrapper.findAll('.cahier-reference-note').every((note) => !note.text().includes('Médiane'))).toBe(true)
    expect(wrapper.find('.cahier-reference-note').text()).toContain('vs ref*')
    expect(wrapper.text()).toContain('À pied + TC')
    expect(wrapper.text()).toContain('À vélo + TC')
    expect(wrapper.text()).not.toContain('À pied ou en transports en commun')
    expect(wrapper.find('.access-tooltip').text()).toContain('vs ref*')
    expect(wrapper.find('.access-figures .stacked-donut').attributes('aria-describedby')).toBe('access-administration-detail')
    expect(wrapper.find('#access-administration-detail').classes()).toContain('cahier-figure-tooltip')
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
      expect(unitExplorations.every((link) => link.element.parentElement?.classList.contains('cahier-section-footer'))).toBe(true)
      expect(unitExplorations.every((link) => link.find('a').attributes('href')?.startsWith('/indicateurs/mobilite/'))).toBe(true)
    } finally {
      if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
      else delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
    }
  })

  it('pairs the summary bars and shares the app-wide compact figure label', async () => {
    const wrapper = await render(resolveMobiliteThemeContent(factsForTarget()), 'plain')

    const pairedMetrics = wrapper.findAll('.summary-bar-metrics .summary-metric')
    expect(pairedMetrics).toHaveLength(2)
    expect(wrapper.findAll('.summary-bar-row')).toHaveLength(4)
    expect(wrapper.findAll('.summary-bar-row--territory .summary-bar-label')).toHaveLength(0)
    expect(wrapper.findAll('.summary-bar-row--reference').every((row) => row.text().includes('vs ref*'))).toBe(true)
    expect(wrapper.find('.summary-bar-label--reference').text()).toBe('vs ref*')
    expect(wrapper.findAll('.summary-bar-row--reference .summary-bar-label').every((label) => !label.text().includes('Médiane'))).toBe(true)
    expect(wrapper.findAll('.summary-metric-title').map((title) => title.text())).toEqual([
      'Nombre d’équip. accessibles',
      "Types d'équip. accessibles",
    ])
    expect(wrapper.findAll('.summary-metric-title').every((title) => title.classes().includes('type-figure-label'))).toBe(true)
    expect(wrapper.findAll('.summary-mode-key .cahier-figure-legend-item')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-figure-legend')).toHaveLength(4)
    expect(wrapper.find('.summary-mode-key .cahier-figure-legend-mark--slash').exists()).toBe(true)
    expect(wrapper.find('.summary-values--paired').exists()).toBe(false)
    expect(wrapper.findAll('.summary-loss')).toHaveLength(2)
    expect(wrapper.findAll('.summary-loss-reading')).toHaveLength(4)
    expect(wrapper.findAll('.summary-loss-reading .cahier-figure-scalar-icon')).toHaveLength(4)
    expect(wrapper.findAll('.summary-loss-reading .cahier-figure-scalar-value strong').map((value) => value.text())).toEqual([
      '1 211',
      '889',
      '19',
      '11',
    ])
    expect(wrapper.findAll('.summary-loss-reading').every((reading) => {
      const label = reading.attributes('aria-label') ?? ''
      return label.includes('À pied + TC') || label.includes('À vélo + TC')
    })).toBe(true)
    expect(wrapper.findAll('.summary-loss .cahier-reference-note')).toHaveLength(4)
    expect(wrapper.findAll('.summary-loss .cahier-reference-note').every((note) => !note.text().includes('Médiane'))).toBe(true)
    expect(wrapper.findAll('.summary-loss .cahier-rank')).toHaveLength(4)
    expect(wrapper.findAll('.summary-loss .cahier-rank.is-extreme')).toHaveLength(4)
    const summaryExplorationHref = wrapper.find('.cahier-section-exploration--unit-footer a').attributes('href')
    expect(summaryExplorationHref).toBeTruthy()
    expect(wrapper.findAll('.summary-loss .cahier-rank').every((rank) => rank.element.tagName === 'A')).toBe(true)
    expect(wrapper.findAll('.summary-loss .cahier-rank').every((rank) => rank.attributes('href') === summaryExplorationHref)).toBe(true)
    const typesLastSegment = pairedMetrics[1]!.find('.summary-bar-row--territory').find('.summary-stack-segment--c')
    const equipmentLastSegment = pairedMetrics[0]!.find('.summary-bar-row--territory').findAll('.summary-stack-segment').at(-1)
    if (!typesLastSegment || !equipmentLastSegment) throw new Error('Expected summary stack segments')
    const endFromStyle = (style: string): number => {
      const left = style.match(/left:\s*([\d.]+)%/)?.[1]
      const right = style.match(/right:\s*([\d.]+)%/)?.[1]
      if (left === undefined || right === undefined) throw new Error('Expected percentage segment styles')
      return 100 - parseFloat(right)
    }
    const typesBarEnd = endFromStyle(typesLastSegment.attributes('style') ?? '')
    const equipmentBarEnd = endFromStyle(equipmentLastSegment.attributes('style') ?? '')
    expect(typesBarEnd).toBeCloseTo((48.63 / 53) * 100, 4)
    expect(typesBarEnd).not.toBeCloseTo(100, 4)
    expect(equipmentBarEnd).toBeCloseTo(100, 4)
    expect(wrapper.find('.summary-bar-metrics .summary-stack-segment--inaccessible').exists()).toBe(true)
    expect(wrapper.findAll('.summary-loss-reading .cahier-figure-scalar-icon--t')).toHaveLength(2)
    expect(wrapper.findAll('.summary-loss-reading .cahier-figure-scalar-icon--b')).toHaveLength(2)
    expect(wrapper.findAll('.summary-loss-reading .cahier-figure-scalar-label')).toHaveLength(0)
    expect(wrapper.findAll('.summary-bar-tooltip .cahier-figure-tooltip-marker--slash')).toHaveLength(2)
    expect(wrapper.findAll('.access-tooltip .cahier-figure-tooltip-marker--slash')).toHaveLength(5)
    expect(wrapper.findAll('.access-foot-summary.cahier-figure-scalar')).toHaveLength(5)
    expect(wrapper.findAll('.summary-bar-tooltip')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-figure-tooltip')).toHaveLength(9)
    const summaryTooltipTriggers = wrapper.findAll('.summary-stack[tabindex="0"]')
    expect(summaryTooltipTriggers.every((bar) => bar.attributes('aria-describedby') && wrapper.find(`#${bar.attributes('aria-describedby')}`).exists())).toBe(true)
    expect(summaryTooltipTriggers.every((bar) => bar.classes().includes('cahier-tooltip-trigger'))).toBe(true)
    expect(wrapper.findAll('.access-figures .stacked-donut[tabindex="0"]').every((donut) => donut.classes().includes('cahier-tooltip-trigger'))).toBe(true)
    const legend = wrapper.find('.summary-mode-key').element
    const bars = wrapper.find('.summary-bar-pair').element
    expect(Boolean(bars.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(wrapper.find('.distribution-cahier .cahier-figure-axis-title--x').classes()).toContain('type-figure-label')
  })

  it('makes the bounded profile composition legible without exposing the type matrix', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const profileSection = content.units[0]!.sections[1]!
    expect(profileSection.evidence?.kind).toBe('bpe-profiles')
    if (profileSection.evidence?.kind !== 'bpe-profiles') throw new Error('Expected BPE profile evidence')
    expect(profileSection.evidence.profiles.map((profile) => ({
      profile: profile.profile,
      direction: profile.comparison?.direction,
      rank: profile.comparison?.rank,
    }))).toEqual([
      { profile: 'acces-pied-tc', direction: 'plus-est-mieux', rank: { position: 1, size: 2 } },
      { profile: 'velo-compense', direction: 'plus-est-mieux', rank: { position: 1, size: 2 } },
      { profile: 'voiture-requise', direction: 'moins-est-mieux', rank: { position: 1, size: 2 } },
      { profile: 'inaccessible-20-minutes', direction: 'moins-est-mieux', rank: { position: 2, size: 2 } },
    ])
    const wrapper = await render(content, 'plain')

    expect(wrapper.find('.bpe-evidence .cahier-figure-title').text()).toBe(profileSection.label)
    expect(wrapper.find('.bpe-profile-total').text()).toBe('53 types d’équipement')
    expect(wrapper.find('.bpe-profile-distribution').exists()).toBe(false)
    expect(wrapper.find('.bpe-profile-chart').exists()).toBe(true)
    expect(wrapper.find('.bpe-profile-chart svg').exists()).toBe(true)
    expect(wrapper.findAll('.bpe-profile-chart .cahier-figure-axis')).toHaveLength(2)
    expect(wrapper.findAll('.bpe-profile-chart .cahier-figure-tick')).toHaveLength(9)
    expect(wrapper.findAll('.bpe-profile-chart .cahier-figure-tick-label')).toHaveLength(5)
    expect(wrapper.findAll('.bpe-profile-visual .cahier-figure-axis-title')).toHaveLength(2)
    expect(wrapper.find('.bpe-profile-chart .cahier-figure-axis-title').exists()).toBe(false)
    expect(wrapper.find('.bpe-profile-visual > .cahier-figure-frame__plot').exists()).toBe(true)
    expect(wrapper.findAll('.bpe-profile-bars[role="img"]')).toHaveLength(4)
    expect(wrapper.findAll('.bpe-profile-bars[role="button"]')).toHaveLength(0)
    expect(wrapper.findAll('.bpe-profile-bars[tabindex="0"]')).toHaveLength(4)
    expect(wrapper.find('.bpe-profile-tooltip').exists()).toBe(false)
    expect(wrapper.find('.bpe-profile-visual').classes()).toContain('cahier-figure-frame')
    expect(wrapper.findAll('.bpe-profile-column').map((column) => column.attributes('data-profile'))).toEqual([
      'acces-pied-tc',
      'velo-compense',
      'voiture-requise',
      'inaccessible-20-minutes',
    ])
    expect(wrapper.findAll('.bpe-profile-swatch')).toHaveLength(4)
    expect(wrapper.findAll('.bpe-profile-count.cahier-figure-scalar')).toHaveLength(4)
    expect(wrapper.findAll('.bpe-profile-count .cahier-figure-scalar-reference')).toHaveLength(4)
    expect(wrapper.findAll('.bpe-profile-count .cahier-figure-scalar-label')).toHaveLength(0)
    expect(wrapper.findAll('.bpe-profile-label').map((label) => label.text())).toEqual([
      'Accès à pied ou en TC possible',
      'Le vélo compense',
      'La voiture est requise',
      'Inaccessible ou presque en 20 minutes',
    ])
    expect(wrapper.findAll('.bpe-profile-count .cahier-reference-note').map((note) => note.text().replace(/\s+/g, ' ').trim())).toEqual([
      'vs ref* : 10,51er/2',
      'vs ref* : 01er/2',
      'vs ref* : 411er/2',
      'vs ref* : 1,52e/2',
    ])
    expect(wrapper.findAll('.bpe-profile-count .cahier-reference-note').every((note) => note.classes().includes('cahier-figure-comparison'))).toBe(true)
    expect(wrapper.findAll('.bpe-profile-count .cahier-rank').map((rank) => rank.text())).toEqual([
      '1er/2',
      '1er/2',
      '1er/2',
      '2e/2',
    ])
    const bpeGroup = wrapper.find('.bpe-evidence').element.closest('.concept-group')
    const sectionExplorationHref = bpeGroup?.querySelector('.cahier-section-footer .cahier-section-exploration a')?.getAttribute('href')
    expect(sectionExplorationHref).toBeTruthy()
    expect(wrapper.findAll('.bpe-profile-count .cahier-rank').every((rank) => rank.element.tagName === 'A')).toBe(true)
    expect(wrapper.findAll('.bpe-profile-count .cahier-rank').map((rank) => rank.attributes('href'))).toEqual([
      sectionExplorationHref,
      sectionExplorationHref,
      sectionExplorationHref,
      sectionExplorationHref,
    ])
    expect(wrapper.findAll('.bpe-profile-series-key .cahier-figure-legend-item').map((item) => item.text())).toEqual([
      'Territoire',
      'vs ref*',
    ])
    expect(wrapper.find('.bpe-profile-reference-note').text()).toBe('*ref : moyenne des communes de l’EPCI')
    expect(wrapper.find('.bpe-profile-column[data-profile="inaccessible-20-minutes"]').attributes('aria-label')).toBe('Inaccessible ou presque en 20 minutes')
    expect(wrapper.find('.bpe-profile-chart').attributes('aria-label')).toContain('Inaccessible ou presque en 20 minutes')
    const firstProfileBars = wrapper.find('.bpe-profile-bars[data-profile="acces-pied-tc"]')
    await firstProfileBars.trigger('mouseenter')
    expect(wrapper.find('.bpe-profile-tooltip').exists()).toBe(true)
    expect(wrapper.find('.bpe-profile-tooltip').classes()).toContain('cahier-figure-tooltip--chart')
    expect(wrapper.find('.bpe-profile-tooltip').text()).toContain('10,5 types')
    await firstProfileBars.trigger('mouseleave')
    expect(wrapper.find('.bpe-profile-tooltip').exists()).toBe(false)
    expect(wrapper.find('.bpe-evidence').text()).not.toContain('inaccessible-20-minutes')
    expect(wrapper.find('.bpe-evidence').text()).not.toContain('A128')
  })

  it('writes the first group as a territory-specific comparison story', async () => {
    const facts = structuredClone(factsForTarget())
    const summary = facts.mobility.access.summary
    summary.accessibleEquipment.car = withMedian(summary.accessibleEquipment.car, 1_000)
    summary.accessibleTypes.car = withMedian(summary.accessibleTypes.car, 60)
    summary.averageLosses.diversity.walkTransit = withMedian(summary.averageLosses.diversity.walkTransit, 25)
    summary.averageLosses.diversity.bike = withMedian(summary.averageLosses.diversity.bike, 20)

    const content = resolveMobiliteThemeContent(facts)
    const firstSection = content.units[0]!.sections[0]!
    const prose = firstSection.lecture!.prose.map((block) => block.map((segment) => segment.value).join(''))
    const wrapper = await render(content, 'plain')

    expect(prose).toHaveLength(3)
    expect(prose[0]).toContain('À Commune A1, dans un rayon de 20 minutes en voiture')
    expect(prose[0]).toContain('atteint plus d’équipements au total')
    expect(prose[0]).toContain('mais moins de types d’équipements')
    expect(prose[1]).toContain('La voiture ouvre peu d’accès')
    expect(prose[1]).toContain('À pied et/ou en transports en commun')
    expect(prose[1]).not.toContain('médiane des communes de l’EPCI')
    expect(prose[2]).toContain('Le vélo renforce cette situation')
    expect(prose[2]).toContain('référence : 20')
    expect(wrapper.find('.margin-comparison').exists()).toBe(false)
    expect(wrapper.findAll('.subgroup-reference')).toHaveLength(4)
    expect(wrapper.findAll('.subgroup-reference').every((marker) => marker.text() === '*ref : médiane des communes de l’EPCI')).toBe(true)
    expect(wrapper.findAll('.cahier-section-footer').every((footer) => footer.find('.subgroup-reference').exists())).toBe(true)
    expect(wrapper.findAll('.cahier-section-footer').every((footer) => footer.find('.cahier-section-exploration--unit-footer').exists())).toBe(true)
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
        averageLosses: {
          diversity: {
            walkTransit: { ...facts.mobility.access.summary.averageLosses.diversity.walkTransit, value: null, availability: 'absent', provenance: null, comparison: null },
            bike: { ...facts.mobility.access.summary.averageLosses.diversity.bike, value: null, availability: 'absent', provenance: null, comparison: null },
          },
          total: {
            walkTransit: { ...facts.mobility.access.summary.averageLosses.total.walkTransit, value: null, availability: 'absent', provenance: null, comparison: null },
            bike: { ...facts.mobility.access.summary.averageLosses.total.bike, value: null, availability: 'absent', provenance: null, comparison: null },
          },
        },
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
