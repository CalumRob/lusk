import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import VarianteCahierLibreE from '@/fiche/prototype/VarianteCahierLibreE.vue'
import CartographicBreakoutPrototype from '@/fiche/prototype/CartographicBreakoutPrototype.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type {
  MobiliteAccessGaps,
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
import type { Indicateur, Payload, RampeAccesBatimentsRow } from '@/payload/types'
import { routes } from '@/router'

const vintage = {
  vintage_source: 'Snapshot Mobilité',
  vintage_version: '2026-02',
  vintage_date_reference: '2026-02-28',
  vintage_date_publication: '2026-08-06',
}
const varianteCahierLibreStyles = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'VarianteCahierLibre.vue'),
  'utf-8',
).match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''

function regleCss(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`CSS rule not found: ${selector}`)
  return match[1]
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
  const values: readonly [string, number, string][] = [
    ['avg_tot_car', 1_467.78, 'équipements / bâtiment'],
    ['avg_tot_b', 578.55, 'équipements / bâtiment'],
    ['avg_tot_t', 256.89, 'équipements / bâtiment'],
    ['avg_div_car', 48.63, 'types d’équipement / bâtiment'],
    ['avg_div_b', 37.23, 'types d’équipement / bâtiment'],
    ['avg_div_t', 30.1, 'types d’équipement / bâtiment'],
  ]
  return ['22001', '22002'].flatMap((territoire) => values.map(([key, value, unit]) => ({
      territoire,
      type: 'commune' as const,
      theme: 'mobilite' as const,
      key,
      detail: null,
      value,
      unit,
      rang_epci: territoire === '22001' ? 1 : 2,
      rang_epci_n: 2,
      rang_dep: null,
      rang_dep_n: null,
      rang_reg: null,
      rang_reg_n: null,
      ...vintage,
    })))
}

const rampRows: RampeAccesBatimentsRow[] = [
  ['c', 'Voiture'],
  ['b', 'À vélo + TC'],
  ['t', 'À pied + TC'],
].flatMap(([mode, modeLabel]) =>
  Array.from({ length: 11 }, (_, index) => ({
    territoire: '22001',
    type: 'commune' as const,
    availability: 'complete' as const,
    total_buildings: 65_078,
    mode: mode as RampeAccesBatimentsRow['mode'],
    mode_label: modeLabel,
    quantile: index / 10,
    quantile_label: `${index * 10} %`,
    accessible_types: index * 3,
    x_axis_label: 'Part cumulée des bâtiments',
    y_axis_label: 'types d’équipements accessibles',
     source_id: 'mobilite_snapshot',
     source: 'Lusk — analyse d\'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)',
     version: '2026-02',
     date_reference: '2026-02-28',
     date_publication: '2026-08-06',
    comparison_label: 'communes de l’EPCI',
    comparison_total_buildings: 100_000,
    comparison_accessible_types: index * 4,
  })),
)

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: [
    ...indicateursMobiliteFixture,
    ...totalLossRows(),
    ...averageRows(),
    ...indicateursMobiliteFixture
      .filter((row) => row.territoire === '22001' && row.key.startsWith('share_'))
      .map((row) => ({ ...row, territoire: '22002' })),
    ...[
      ['22001', 65_078],
      ['22002', 65_078],
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
  rampeAccesBatiments: rampRows,
}

function factsForTarget(): TerritoryFacts {
  const facts = territoryFactsFor(payload, '22001')
  if (!facts) throw new Error('Test target should exist')
  return facts
}

function withMean(fact: NumericFact, value: number): NumericFact {
  if (!fact.comparison) throw new Error(`Expected a comparison for ${fact.key}`)
  return {
    ...fact,
    comparison: {
      ...fact.comparison,
      reference: { kind: 'mean', value },
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
  it('uses the payload-owned EPCI name verbatim', () => {
    const publicName = 'CA EPCI X'
    const payloadWithPublicName: Payload = {
      ...payload,
      territoires: payload.territoires.map((territoire) =>
        territoire.territoire === '200000001'
          ? { ...territoire, nom: publicName }
          : territoire,
      ),
    }

    expect(territoryFactsFor(payloadWithPublicName, '22001')?.territory.epciName).toBe(publicName)
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
    expect(wrapper.find('[data-section="distribution-acces-par-batiment"] .cahier-marelle-anchor').text()).toBe('... Tous les bâtiments non plus')
    expect(wrapper.findAll('.cahier-marelle-anchor')).toHaveLength(4)
    expect(wrapper.find('.summary-evidence').exists()).toBe(true)
    expect(wrapper.find('.summary-evidence .cahier-figure-title').text()).toBe("Quantité et Diversité d'Équipements accessibles en 20 min (moyennes)")
    expect(wrapper.find('.summary-evidence').text()).toContain("Quantité et Diversité d'Équipements accessibles en 20 min (moyennes)")
    expect(wrapper.find('.summary-evidence').text()).toContain('Types d’équipements accessibles')
    expect(wrapper.find('.summary-evidence').text()).toContain('1 467,8')
    expect(wrapper.findAll('.summary-value')).toHaveLength(6)
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(false)
    expect(wrapper.find('.bivariate-distribution-svg').exists()).toBe(false)
    expect(wrapper.find('.access-ramp-evidence').exists()).toBe(true)
    expect(wrapper.find('.access-ramp-evidence .cahier-figure-title').text()).toBe('Nombre de types accessibles par part cumulée des bâtiments')
    expect(wrapper.find('.access-ramp-svg').attributes('aria-label')).toContain('Commune A')
    expect(wrapper.findAll('.cahier-figure-frame')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-figure-lecture')).toHaveLength(4)
    for (const selector of [
      '.summary-evidence',
      '.bpe-evidence',
      '.access-figure-collection',
      '.access-ramp-evidence',
    ]) {
      expect(wrapper.find(`${selector} .cahier-figure-lecture`).text()).toContain('Exemple :')
      expect(wrapper.find(`${selector} .cahier-figure-lecture`).text()).toContain('contre')
    }
    expect(wrapper.find('.access-figure-collection .cahier-figure-lecture').text()).not.toContain('trois bâtiments sur quatre')
    expect(wrapper.find('.access-ramp-evidence .cahier-figure-lecture').text()).toContain('la moitié des bâtiments accèdent à au plus 15 types')
    expect(wrapper.findAll('.cahier-figure-frame .cahier-figure-axis-title')).toHaveLength(4)
    expect(wrapper.findAll('.summary-evidence .cahier-figure-axis')).toHaveLength(0)
    expect(wrapper.findAll('.access-figure-collection .cahier-figure-axis')).toHaveLength(0)
    expect(wrapper.find('.mode-figures').exists()).toBe(false)
    expect(wrapper.find('.summary-losses').exists()).toBe(false)
    expect(wrapper.find('.access-figures').exists()).toBe(true)
    const administrationDonut = wrapper.find('.access-figures .stacked-donut')
    expect(administrationDonut.element.previousElementSibling?.textContent).toBe('Administration')
    expect(administrationDonut.find('.stacked-donut-center').text()).not.toContain('Administration')
    expect(administrationDonut.findAll('.concentric-donut-ring')).toHaveLength(3)
    expect(administrationDonut.find('.concentric-donut-ring--car').exists()).toBe(true)
    expect(administrationDonut.find('.concentric-donut-ring--bike').exists()).toBe(true)
    expect(administrationDonut.find('.concentric-donut-ring--walkTransit').exists()).toBe(true)
    expect(administrationDonut.find('.concentric-donut-ring--car').attributes('stroke-width')).toBe('6')
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
    expect(wrapper.findAll('.cahier-comparison-value')).toHaveLength(15)
    expect(wrapper.findAll('.cahier-comparison-value').every((note) => !note.text().includes('Médiane'))).toBe(true)
    expect(wrapper.findAll('.cahier-comparison-note')).toHaveLength(4)
    expect(wrapper.find('.cahier-comparison-note').text()).toContain('Groupe comparé : moyenne des communes de EPCI X')
    expect(wrapper.find('.bpe-comparison-note').text()).toContain('Groupe comparé : moyenne des communes de EPCI X')
    expect(wrapper.find('.cahier-comparison-value').text()).toContain('Groupe comparé')
    expect(wrapper.text()).toContain('À pied + TC')
    expect(wrapper.text()).toContain('À vélo + TC')
    expect(wrapper.text()).not.toContain('À pied ou en transports en commun')
    expect(wrapper.find('.access-tooltip').text()).toContain('Groupe comparé')
    expect(wrapper.text()).not.toContain('vs ref*')
    expect(wrapper.text()).not.toContain('*ref')
    expect(wrapper.findAll('#access-administration-detail .cahier-figure-tooltip-row')).toHaveLength(3)
    expect(wrapper.find('#access-administration-detail .cahier-figure-tooltip-icon--neutral').exists()).toBe(false)
    expect(wrapper.find('.access-figures .stacked-donut').attributes('aria-describedby')).toBe('access-administration-detail')
    expect(wrapper.find('#access-administration-detail').classes()).toContain('cahier-figure-tooltip')
    expect(wrapper.find('.rank-emphasis.is-extreme').exists()).toBe(true)
    for (const link of links) {
      expect(link.attributes('rel')).toContain('noopener')
      expect(link.attributes('rel')).toContain('noreferrer')
    }
  })

  it('renders Variant E subgroups vertically at full width and in content order', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const wrapper = await render(content, 'plain')
    const groups = wrapper.findAll('.concept-group')

    expect(wrapper.find('.cahier').classes()).toContain('cahier--sans-grille')
    expect(groups.map((group) => group.attributes('data-section'))).toEqual(
      content.units[0]?.sections.map((section) => section.key),
    )
    expect(groups.every((group) => !group.attributes('style'))).toBe(true)
    expect(wrapper.findAll('.cahier-section-exploration--unit-footer')).toHaveLength(4)
    const unitExplorations = wrapper.findAll('.cahier-section-exploration--unit-footer')
    expect(unitExplorations.every((link) => link.element.parentElement?.classList.contains('cahier-section-footer'))).toBe(true)
    expect(unitExplorations.every((link) => link.find('a').attributes('href')?.startsWith('/indicateurs/mobilite/'))).toBe(true)
  })

  it('renders the summary as two horizontal grouped plots', async () => {
    const facts = structuredClone(factsForTarget())
    facts.mobility.access.summary.accessibleEquipment.car = withMean(
      facts.mobility.access.summary.accessibleEquipment.car,
      1_032,
    )
    const wrapper = await render(resolveMobiliteThemeContent(facts), 'plain')

    const plots = wrapper.findAll('.summary-plot')
    expect(plots).toHaveLength(2)
    expect(wrapper.find('.summary-evidence .cahier-figure-title').text()).toBe(
      "Quantité et Diversité d'Équipements accessibles en 20 min (moyennes)",
    )
    expect(plots.map((plot) => plot.find('.cahier-figure-axis-title--x').text())).toEqual([
      'Nombre d’équip. accessibles',
      "Types d'équip. accessibles",
    ])
    expect(plots.every((plot) => plot.find('svg').classes().includes('summary-plot-svg'))).toBe(true)
    expect(plots.every((plot) => plot.findAll('.summary-plot-group').length === 2)).toBe(true)
    expect(plots[0]!.findAll('.summary-plot-bar')).toHaveLength(6)
    expect(plots[1]!.findAll('.summary-plot-bar')).toHaveLength(8)
    expect(plots[0]!.findAll('.summary-plot-bar[data-mode="inaccessible"]')).toHaveLength(0)
    expect(plots[1]!.findAll('.summary-plot-bar[data-mode="inaccessible"]')).toHaveLength(2)
    expect(plots[0]!.findAll('.cahier-figure-tick-label')).toHaveLength(5)
    expect(plots[0]!.findAll('.cahier-figure-tick-label').map((tick) => tick.text())).not.toContain('1 000')
    expect(plots[0]!.findAll('.cahier-figure-tick-label').map((tick) => tick.text())).toContain('1 250')
    expect(plots[1]!.findAll('.cahier-figure-tick-label')).toHaveLength(6)
    expect(plots[1]!.findAll('.cahier-figure-tick-label').map((tick) => tick.text())).toEqual([
      '0',
      '10',
      '20',
      '30',
      '40',
      '53',
    ])
    expect(plots.every((plot) => plot.findAll('.summary-plot-group-label').length === 2)).toBe(true)
    expect(plots.every((plot) => plot.findAll('.summary-plot-group-label').map((label) => label.text()).includes('Commune A1'))).toBe(true)
    expect(plots.every((plot) => plot.findAll('.summary-plot-group-label').map((label) => label.text()).includes('Groupe comparé'))).toBe(true)
    expect(plots.every((plot) => !plot.findAll('.cahier-figure-tick-label').map((tick) => tick.text()).includes('Groupe comparé'))).toBe(true)
    expect(plots.every((plot) => plot.findAll('.summary-plot-group[tabindex="0"]').length === 2)).toBe(true)
    const firstGroup = plots[0]!.find('.summary-plot-group')
    await firstGroup.trigger('focus')
    expect(firstGroup.attributes('aria-describedby')).toBe('summary-plot-equipment-territory-detail')
    expect(wrapper.find('#summary-plot-equipment-territory-detail').exists()).toBe(true)
    expect(wrapper.findAll('.summary-bar-row')).toHaveLength(0)
    expect(wrapper.findAll('.summary-mode-key .cahier-figure-legend-item')).toHaveLength(4)
    expect(wrapper.findAll('.summary-loss')).toHaveLength(2)
    expect(wrapper.findAll('.summary-loss-reading')).toHaveLength(4)

    const equipmentCar = plots[0]!.find('.summary-plot-bar[data-mode="car"][data-series="territory"]')
    expect(equipmentCar.attributes('x')).toBe('220')
    expect(Number(equipmentCar.attributes('width'))).toBeCloseTo(574, 3)

    const typesCar = plots[1]!.find('.summary-plot-bar[data-mode="car"][data-series="territory"]')
    expect(Number(typesCar.attributes('width'))).toBeCloseTo((48.63 / 53) * 574, 3)

    const typesGroups = plots[1]!.findAll('.summary-plot-group')
    const territoryBars = typesGroups[0]!.findAll('.summary-plot-bar')
    const referenceBars = typesGroups[1]!.findAll('.summary-plot-bar')
    const lastTerritoryBar = territoryBars[territoryBars.length - 1]!
    const firstReferenceBar = referenceBars[0]!
    expect(Number(firstReferenceBar.attributes('y')) - (Number(lastTerritoryBar.attributes('y')) + 22)).toBeGreaterThan(0)
    const xAxis = plots[1]!.find('.cahier-figure-axis')
    expect(Number(xAxis.attributes('y1')) - (Number(referenceBars[referenceBars.length - 1]!.attributes('y')) + 22)).toBeGreaterThan(0)
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
    expect(wrapper.findAll('.bpe-profile-chart .cahier-figure-tick')).toHaveLength(10)
    expect(wrapper.findAll('.bpe-profile-chart .cahier-figure-tick-label')).toHaveLength(6)
    expect(wrapper.findAll('.bpe-profile-chart .cahier-figure-tick-label').map((tick) => tick.text())).toEqual([
      '0',
      '10',
      '20',
      '30',
      '40',
      '53',
    ])
    expect(wrapper.findAll('.bpe-profile-visual .cahier-figure-axis-title')).toHaveLength(2)
    expect(wrapper.find('.bpe-profile-visual .cahier-figure-axis-title--x').exists()).toBe(false)
    expect(wrapper.find('.bpe-profile-visual .cahier-figure-axis-title--y').text()).toBe('Types d’équipements')
    expect(wrapper.find('.bpe-profile-chart .cahier-figure-axis-title').exists()).toBe(false)
    expect(wrapper.find('.bpe-profile-examples-title').text()).toBe('Exemples')
    expect(wrapper.find('.bpe-profile-examples-title').classes()).toContain('cahier-figure-axis-title--y')
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
      'Inaccessible ou presque',
    ])
    const profileArgument = wrapper.findAll('.argument-copy')[0]!
    expect(profileArgument.text()).toContain('types d’équipements BPE')
    expect(profileArgument.find('.car-emphasis').exists()).toBe(false)
    expect(profileArgument.find('.foot-emphasis').exists()).toBe(false)
    expect(profileArgument.find('.bike-emphasis').exists()).toBe(false)
    expect(profileArgument.find('.neutral-emphasis').exists()).toBe(false)
    expect(wrapper.findAll('.bpe-profile-count .cahier-comparison-value').map((note) => note.text().replace(/\s+/g, ' ').trim())).toEqual([
      'Groupe comparé : 10,51er/2',
      'Groupe comparé : 01er/2',
      'Groupe comparé : 411er/2',
      'Groupe comparé : 1,52e/2',
    ])
    expect(wrapper.findAll('.bpe-profile-count .cahier-comparison-value').every((note) => !note.text().includes('Rang :'))).toBe(true)
    expect(wrapper.findAll('.bpe-profile-count .cahier-comparison-value').every((note) => note.classes().includes('cahier-figure-comparison'))).toBe(true)
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
    expect(wrapper.find('.bpe-profile-series-key').exists()).toBe(false)
    expect(wrapper.find('.bpe-comparison-note').text()).toBe('Groupe comparé : moyenne des communes de EPCI X')
    expect(wrapper.text()).not.toContain('Exemple indisponible')
    expect(wrapper.find('.bpe-profile-column[data-profile="velo-compense"] .bpe-profile-donut-anchor').exists()).toBe(true)
    expect(wrapper.find('.bpe-profile-column[data-profile="velo-compense"] .bpe-profile-exemplar').exists()).toBe(false)
    expect(wrapper.find('.bpe-profile-column[data-profile="velo-compense"] .bpe-profile-donut-placeholder').text()).toBe('Aucun type')
    expect(wrapper.findAll('.bpe-profile-donut .stacked-donut-center')).toHaveLength(0)
    expect(wrapper.find('.bpe-profile-column[data-profile="inaccessible-20-minutes"]').attributes('aria-label')).toBe('Inaccessible ou presque en 20 minutes')
    expect(wrapper.find('.bpe-profile-chart').attributes('aria-label')).toContain('Inaccessible ou presque en 20 minutes')
    const firstProfileBars = wrapper.find('.bpe-profile-bars[data-profile="acces-pied-tc"]')
    await firstProfileBars.trigger('mouseenter')
    expect(wrapper.find('.bpe-profile-tooltip').exists()).toBe(true)
    expect(wrapper.find('.bpe-profile-tooltip').classes()).toContain('cahier-figure-tooltip--chart')
    expect(wrapper.find('.bpe-profile-tooltip').text()).toContain('10,5 types')
    expect(wrapper.find('.bpe-profile-tooltip').text()).toContain('Groupe comparé')
    expect(wrapper.find('.bpe-profile-tooltip').text()).not.toContain('moyenne des')
    expect(wrapper.find('.bpe-profile-tooltip').text()).toContain('Commune A1')
    expect(wrapper.findAll('.bpe-profile-tooltip .cahier-figure-tooltip-icon--t')).toHaveLength(2)
    expect(wrapper.findAll('.bpe-profile-tooltip .cahier-figure-tooltip-marker')).toHaveLength(0)
    expect(wrapper.find('.bpe-profile-tooltip').attributes('style')).toContain('--cahier-figure-tooltip-anchor-x:')
    expect(wrapper.find('.bpe-profile-tooltip').attributes('style')).not.toContain('--cahier-figure-tooltip-anchor-x: 50%')
    await firstProfileBars.trigger('mouseleave')
    expect(wrapper.find('.bpe-profile-tooltip').exists()).toBe(false)
    const firstProfileDonut = wrapper.find('.bpe-profile-donut[data-profile="acces-pied-tc"]')
    expect(firstProfileDonut.exists()).toBe(true)
    expect(firstProfileDonut.find('.concentric-donut-ring--car').attributes('stroke-width')).toBe('3.6')
    expect(firstProfileDonut.attributes('aria-describedby')).toBe('bpe-profile-donut-tooltip-acces-pied-tc')
    await firstProfileDonut.trigger('mouseenter')
    expect(wrapper.find('.bpe-profile-tooltip').exists()).toBe(false)
    const firstDonutTooltip = wrapper.find('.bpe-profile-donut-tooltip')
    expect(firstDonutTooltip.exists()).toBe(true)
    expect(firstDonutTooltip.classes()).toContain('cahier-figure-tooltip--popover')
    expect(firstDonutTooltip.find('.cahier-figure-tooltip > strong').text()).toBe('% des bâtiments ayant accès')
    expect(firstDonutTooltip.text()).not.toContain('Inaccessible')
    expect(firstDonutTooltip.find('.cahier-figure-tooltip-icon--neutral').exists()).toBe(false)
    expect(firstDonutTooltip.find('.cahier-figure-tooltip-icon--t').exists()).toBe(true)
    expect(firstDonutTooltip.find('.cahier-figure-tooltip-icon--b').exists()).toBe(true)
    expect(firstDonutTooltip.find('.cahier-figure-tooltip-icon--c').exists()).toBe(true)
    expect(firstDonutTooltip.findAll('.cahier-figure-tooltip-row')).toHaveLength(3)
    expect(firstDonutTooltip.findAll('.cahier-figure-tooltip-row--t')).toHaveLength(1)
    expect(firstDonutTooltip.findAll('.cahier-figure-tooltip-row--b')).toHaveLength(1)
    expect(firstDonutTooltip.findAll('.cahier-figure-tooltip-row--c')).toHaveLength(1)
    const donutTooltips = wrapper.findAll('.bpe-profile-donut-tooltip')
    expect(donutTooltips).toHaveLength(wrapper.findAll('.bpe-profile-donut').length)
    expect(donutTooltips.every((tooltip) => tooltip.classes().includes('cahier-figure-tooltip--popover'))).toBe(true)
    expect(donutTooltips.every((tooltip) => tooltip.findAll('.cahier-figure-tooltip-row').length === 3)).toBe(true)
    expect(wrapper.find('.bpe-evidence').text()).not.toContain('inaccessible-20-minutes')
    expect(wrapper.find('.bpe-evidence').text()).not.toContain('A128')
  })

  it('marks an exemplar inaccessible in every mode with a neutral ring and explanation', async () => {
    const facts = structuredClone(factsForTarget())
    const bpeAccess = facts.mobility.bpeAccess
    if (!bpeAccess) throw new Error('Expected BPE access facts')
    const profile = bpeAccess.profiles.find((candidate) => candidate.profile === 'acces-pied-tc')
    if (!profile?.exemplar) throw new Error('Expected an exemplar')
    facts.mobility.bpeAccess = {
      ...bpeAccess,
      profiles: bpeAccess.profiles.map((candidate) => candidate.profile === 'acces-pied-tc'
        ? { ...candidate, exemplar: { ...profile.exemplar!, car: 0, bike: 0, walkTransit: 0 } }
        : candidate),
    }

    const wrapper = await render(resolveMobiliteThemeContent(facts), 'plain')
    const donut = wrapper.find('.bpe-profile-donut[data-profile="acces-pied-tc"]')
    expect(donut.findAll('.concentric-donut-ring')).toHaveLength(1)
    expect(donut.find('.concentric-donut-ring--inaccessible').exists()).toBe(true)
    expect(donut.find('.concentric-donut-ring--inaccessible').attributes('d')).toContain('A 36 36 0 1 1 50 86')

    await donut.trigger('mouseenter')
    const tooltip = wrapper.find('.bpe-profile-donut-tooltip')
    expect(tooltip.text()).toContain('Équipement inaccessible quel que soit le mode')
    expect(tooltip.findAll('.cahier-figure-tooltip-row')).toHaveLength(1)
  })

  it('removes the summary subgroup argument while keeping its figure', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const wrapper = await render(content, 'plain')

    expect(content.units[0]!.sections[0]!.lecture?.marelle).toBe('Ce que l’on perd sans voiture')
    expect(wrapper.find('.summary-evidence').exists()).toBe(true)
    expect(wrapper.findAll('.argument-copy')).toHaveLength(2)
    expect(wrapper.find('.summary-evidence .cahier-figure-lecture').exists()).toBe(true)
  })

  it('uses the narrative sentence as E’s single unit heading without the Marelle duplicate', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const wrapper = await render(content, 'plain')

    expect(wrapper.findAll('.concept-group-narrative').map((heading) => heading.text())).toEqual([
      'Ce que l’on perd sans voiture',
      'Service minimum ?',
      'Tous les services ne se valent pas...',
      '... Tous les bâtiments non plus',
    ])
    expect(wrapper.findAll('.cahier-marelle-anchor')).toHaveLength(0)
  })

  it('renders incomplete sections without inventing a figure or lecture', async () => {
    const facts = structuredClone(factsForTarget())
    facts.mobility.accessRamp!.availability = 'incomplete'
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
    expect(
      wrapper.find('[data-section="services-essentiels"] .concentric-donut-ring--walkTransit').attributes('d'),
    ).toBe('M 50 14 L 50 14')
    expect(wrapper.find('#access-administration-detail').text()).toContain('Indisponible')
  })

  it('renders the same figure Lectures in ruled and plain presentations', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const ruled = await render(content, 'ruled')
    const plain = await render(content, 'plain')

    const lectureTexts = (wrapper: Awaited<ReturnType<typeof render>>) =>
      wrapper.findAll('.cahier-figure-lecture__content').map((lecture) => lecture.text())

    expect(lectureTexts(plain)).toEqual(lectureTexts(ruled))
    expect(plain.find('.page-rundown').text()).toBe(ruled.find('.page-rundown').text())
    expect(plain.find('.page-rundown').text()).toBe(content.units[0].rundown.map((block) => block.map((segment) => segment.value).join('')).join(' '))
  })

  it('shows the standard comparison helper for the building-distribution subgroup', async () => {
    const facts = structuredClone(factsForTarget())
    if (!facts.mobility.accessRamp) throw new Error('Expected access-ramp facts')
    facts.mobility.accessRamp.comparisonLabel = 'communes de EPCI X'
    facts.mobility.buildingDistribution = {
      availability: 'complete',
      mode: 't',
      modeLabel: 'À pied + TC',
      breadthAxisLabel: 'types d’équipements accessibles',
      depthAxisLabel: 'équipements accessibles',
      breadthBins: [{ key: '0', min: 0, max: 0, label: '0' }],
      depthBins: [{ key: '0', min: 0, max: 0, label: '0' }],
      cells: [{
        breadthBucket: '0',
        depthBucket: '0',
        buildingCount: 100,
        share: 1,
        comparisonBuildingCount: 100,
        comparisonShare: 1,
      }],
      totalBuildings: 100,
      provenance: facts.mobility.accessRamp.provenance,
      comparisonLabel: 'communes de EPCI X',
      comparisonTotalBuildings: 100,
    }

    const wrapper = await render(resolveMobiliteThemeContent(facts))

    expect(wrapper.find('.access-ramp-evidence .cahier-comparison-note').text()).toBe('Groupe comparé : bâtiments de EPCI X')
    expect(wrapper.find('.bivariate-evidence .cahier-figure-lecture').text()).toContain('Chaque case regroupe les bâtiments')
    expect(wrapper.find('.bivariate-evidence .cahier-figure-lecture').text()).toContain('Exemple :')
    expect(wrapper.find('.bivariate-evidence .cahier-figure-lecture').text()).toContain('contre')
    expect(wrapper.findAll('.cahier-figure-lecture')).toHaveLength(5)
  })

  it('renders absent sections as an honest, link-free state', async () => {
    const facts = structuredClone(factsForTarget())
    facts.mobility.indicators = []
    facts.mobility.losses = {
      diversityWalkTransit: { ...facts.mobility.losses.diversityWalkTransit, value: null, availability: 'absent', provenance: null },
      diversityBike: { ...facts.mobility.losses.diversityBike, value: null, availability: 'absent', provenance: null },
    }
    facts.mobility.buildingDistribution = null
    facts.mobility.accessRamp = null
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
      gapsByService: Object.fromEntries(
        Object.entries(facts.mobility.access.gapsByService).map(([service, gaps]) => [
          service,
          {
            carGap: { ...gaps.carGap, value: null, availability: 'absent', provenance: null, comparison: null },
            bikeGain: { ...gaps.bikeGain, value: null, availability: 'absent', provenance: null, comparison: null },
          },
        ]),
    ) as Record<string, MobiliteAccessGaps>,
    }
    facts.mobility.bpeAccess = { availability: 'absent', profiles: [] }
    facts.mobility.accessRamp = null
    const wrapper = await render(resolveMobiliteThemeContent(facts))

    expect(wrapper.findAll('.cahier-section--absent')).toHaveLength(4)
    expect(wrapper.findAll('.cahier-figure-lecture')).toHaveLength(0)
    expect(wrapper.findAll('.cahier-section-state')).toHaveLength(4)
    expect(wrapper.find('.distribution-cahier-svg').exists()).toBe(false)
    expect(wrapper.find('.summary-evidence').exists()).toBe(false)
    expect(wrapper.find('.access-figures').exists()).toBe(false)
    expect(wrapper.findAll('a[target="_blank"]')).toHaveLength(0)
  })
})

describe('Variante E — partage de l’espace public', () => {
  it('starts at the persistent AppHeader edge and aligns Sommaire page targets there', () => {
    expect(regleCss(varianteCahierLibreStyles, '\\.cahier')).toContain(
      '--cahier-sticky-top: var(--header-height);',
    )
    const anchorRules = [...varianteCahierLibreStyles.matchAll(
      /\.cahier--sans-grille \.cahier-page,\s*\.cahier--sans-grille \.sources-page\s*\{([^}]*)\}/g,
    )]
    expect(anchorRules.some((rule) => rule[1]?.includes('scroll-margin-top: var(--cahier-sticky-top);'))).toBe(true)
    expect(regleCss(varianteCahierLibreStyles, '\\.page-layout--sticky \\.page-heading')).toContain(
      'top: var(--cahier-sticky-top);',
    )
    expect(regleCss(varianteCahierLibreStyles, '\\.page-layout--sticky > \\.page-margin')).toContain(
      'top: var(--cahier-sticky-top);',
    )
  })

  it('keeps the sticky page title separate from the right-margin metadata', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibreE, {
      props: { content, pagination: cahierPaginationFor(payload, content, true) },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    const pages = wrapper.findAll('.cahier-page')
    expect(pages).toHaveLength(content.units.length)
    for (const page of pages) {
      const layout = page.find('.page-layout--sticky')
      expect(layout.exists()).toBe(true)

      const main = layout.find('.page-main')
      const title = main.find('.page-heading h2')
      const margin = layout.find('aside.page-margin')
      expect(page.attributes('aria-labelledby')).toBe(title.attributes('id'))
      expect(page.findAll('.page-heading .page-subtitle')).toHaveLength(0)
      expect(margin.find('.page-number').text()).toContain('page')
      expect(margin.findAll('.margin-sources a').length).toBeGreaterThan(0)
    }
  })

  it('renders the public-space unit with its three sections and local reading helpers', async () => {
    const facts = structuredClone(factsForTarget())
    const bikeParking = facts.mobility.indicators.find((fact) => fact.key === 'places_stationnement_velo_1000')
    if (!bikeParking) throw new Error('Expected bike parking facts')
    facts.mobility.indicators = [
      ...facts.mobility.indicators,
      {
        ...bikeParking,
        key: 'places_stationnement_voiture_1000',
        value: 25,
        unit: 'places / 1 000 hab',
      },
      {
        ...bikeParking,
        key: 'stationnement_velo_par_voiture',
        value: 0.2,
        unit: 'places vélo / place voiture',
      },
    ]
    const content = resolveMobiliteThemeContent(facts)
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibreE, {
      props: { content, pagination: cahierPaginationFor(payload, content, true) },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.cahier').classes()).toContain('cahier--sans-grille')
    expect(wrapper.findAll('.cahier-page h2').map((heading) => heading.text())).toEqual([
      'Accès aux services',
      'Partage de l’espace public',
    ])
    expect(wrapper.findAll('.cahier-page .page-number').map((number) => number.text())).toEqual([
      'page 01/02',
      'page 02/02',
    ])
    for (const page of wrapper.findAll('.cahier-page')) {
      const groups = page.findAll('.concept-group')
      expect(groups.every((group) => !group.attributes('style'))).toBe(true)
    }
    expect(wrapper.findAll('.page-rundown').map((rundown) => rundown.text())).toHaveLength(2)
    expect(wrapper.findAll('.page-rundown')[1]!.text()).toContain('réseau cyclable')
    expect(wrapper.findAll('.concept-group-narrative').map((heading) => heading.text())).toEqual([
      'Ce que l’on perd sans voiture',
      'Service minimum ?',
      'Tous les services ne se valent pas...',
      '... Tous les bâtiments non plus',
      'Une piste ne suffit pas',
      'Quelle place pour chaque mode ?',
    ])
    expect(wrapper.find('.map-breakout').exists()).toBe(true)
    expect(wrapper.find('.sharing-networks-evidence').exists()).toBe(false)
    expect(wrapper.find('.sharing-cycling-offer-evidence').exists()).toBe(true)
    expect(wrapper.find('.sharing-parking-evidence').exists()).toBe(true)
    expect(wrapper.find('.road-surface-figure').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Part du territoire couverte par des polygones d’usage routier de tout type.')
    expect(wrapper.text()).toContain('médiane des')
    expect(wrapper.find('.sharing-network-figure').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Trois longueurs, un horizon')
    expect(wrapper.text()).not.toContain('Le point d’arrivée varie avec la longueur du réseau.')
    expect(wrapper.findAll('.sharing-cycling-reading')).toHaveLength(5)
    expect(wrapper.findAll('.sharing-parking-reading')).toHaveLength(3)
    expect(wrapper.findAll('.cahier-figure-lecture')).toHaveLength(7)
    expect(wrapper.findAll('.cahier-section-exploration--unit-footer')).toHaveLength(6)
    expect(wrapper.text()).toContain('Groupe comparé')
  })

  it('renders the settled circular map plate contract', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const sharing = content.units
      .find((unit) => unit.key === 'partage-de-lespace-public')
      ?.sections.find((section) => section.key === 'reseaux')
    const cycling = content.units
      .find((unit) => unit.key === 'partage-de-lespace-public')
      ?.sections.find((section) => section.key === 'offre-cyclable')
    if (!sharing?.evidence || sharing.evidence.kind !== 'sharing-networks') {
      throw new Error('Expected complete sharing-network evidence')
    }
    if (!cycling?.evidence || cycling.evidence.kind !== 'cycling-offer') {
      throw new Error('Expected complete cycling-offer evidence')
    }

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push({ path: '/', query: { plate: 'C', map: 'redon' } })
    await router.isReady()
    const wrapper = mount(CartographicBreakoutPrototype, {
      props: { evidence: sharing.evidence, cyclingEvidence: cycling.evidence },
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.find('.map-breakout--c').exists()).toBe(true)
    expect(wrapper.find('.plate').attributes('aria-label')).toContain('CA Redon Agglomération*')
    expect(wrapper.find('.map-breakout .plate > .cahier-figure-title').text()).toBe('Cartes des réseaux de mobilité, par mode')
    expect(wrapper.find('.plate-apparatus-heading h3').text()).toBe('Réseaux')
    expect(wrapper.find('.map-breakout-tagline').text()).toBe('Trois réseaux, trois empreintes')
    expect(wrapper.findAll('.map-panel').map((panel) => panel.classes()[1])).toEqual([
      'map-panel--car',
      'map-panel--walk',
      'map-panel--bike',
    ])
    expect(wrapper.findAll('.map-panel-label').map((label) => label.text())).toEqual([
      'Réseau automobile',
      'Réseau piéton',
      'Réseau cyclable',
    ])
    expect(wrapper.findAll('.cahier-network-bar-row')).toHaveLength(4)
    expect(wrapper.findAll('.cycling-evidence-segment')).toHaveLength(0)
    expect(wrapper.find('.cahier-network-bar-row--bike .cahier-network-bar-row__fill').exists()).toBe(true)
    expect(wrapper.find('.cahier-network-bar-row--bike .cahier-network-bar-row__segments').text()).toContain('Protégé')
    expect(wrapper.find('.cahier-network-bar-row--bike .cahier-network-bar-row__segments').text()).toContain('Partagé')
    expect(wrapper.find('.border-legend').exists()).toBe(true)
    expect(wrapper.find('.border-legend').text()).toContain('CA Redon Agglomération')
    expect(wrapper.find('.border-legend').text()).toContain('Bretagne')
    expect(wrapper.find('.plate-subfigure--road').exists()).toBe(true)
    expect(wrapper.find('.plate-subfigure--road .cahier-network-bar-row').exists()).toBe(true)
    expect(wrapper.find('.plate-subfigure--road .cahier-network-bar-chart__unit').text()).toBe('%')
    expect(wrapper.findAll('.map-panel h4')).toHaveLength(0)
    expect(wrapper.find('.cahier-figure-lecture').exists()).toBe(true)
    expect(wrapper.find('.cahier-network-bar-chart__reference-key').text()).toContain('Groupe comparé')
    expect(wrapper.findAll('.cahier-network-bar-chart__reference-key')).toHaveLength(1)
    await wrapper.find('.cahier-network-bar-row--bike').trigger('mouseenter')
    expect(wrapper.find('.plate-network-tooltip').exists()).toBe(true)
    expect(wrapper.find('.cahier-network-bar-row--car').classes()).toContain('cahier-network-bar-row--dimmed')
    await wrapper.find('.map-panel--bike').trigger('mouseenter')
    expect(wrapper.find('.map-panel--car').classes()).toContain('map-panel--dimmed')
    expect(wrapper.findAll('.map-gallery-source img')).toHaveLength(3)
    await wrapper.find('.map-viewport').trigger('click')
    await flushPromises()
    const viewer = document.querySelector('.lusk-map-gallery')
    expect(viewer).not.toBeNull()
    expect(viewer?.querySelector('.viewer-navbar')).not.toBeNull()
    expect(viewer?.querySelector('.viewer-list')).not.toBeNull()
    expect(viewer?.querySelector('.viewer-navigation')).not.toBeNull()
    expect(viewer?.querySelector('.viewer-button')).not.toBeNull()
  })

  it('uses the cartographic plate in place of the old Réseaux subgroup', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibre, {
      props: {
        content,
        pagination: paginationFor(content),
        showAllUnits: true,
        showMapPrototype: true,
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.map-breakout').exists()).toBe(true)
    const mapGroup = wrapper.find('.concept-group[data-section="reseaux"]')
    expect(mapGroup.exists()).toBe(true)
    expect(mapGroup.attributes('style')).toBeUndefined()
    expect(mapGroup.find('.map-figure-spread').exists()).toBe(true)
    expect(mapGroup.find('.map-breakout').exists()).toBe(true)
    expect(mapGroup.find('.map-breakout .map-section-number').text()).toBe('01')
    expect(mapGroup.find('.map-breakout .plate > .cahier-figure-title').text()).toBe('Cartes des réseaux de mobilité, par mode')
    expect(mapGroup.find('.plate-apparatus-heading h3').text()).toBe('Réseaux')
    expect(mapGroup.find('.plate-exploration').exists()).toBe(true)
    expect(mapGroup.find('.cahier-figure-lecture .plate-sources').exists()).toBe(true)
    expect(mapGroup.find('.cahier-figure-lecture .plate-sources').element.closest('details')).not.toBeNull()
    expect(wrapper.find('.sharing-networks-evidence').exists()).toBe(false)
    expect(wrapper.find('.sharing-cycling-offer-evidence').exists()).toBe(true)
  })
})
