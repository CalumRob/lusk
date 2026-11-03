import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import VarianteCahierLibreE from '@/fiche/prototype/VarianteCahierLibreE.vue'
import CartographicBreakoutPrototype from '@/fiche/prototype/CartographicBreakoutPrototype.vue'
import CahierMotorisationFigure from '@/fiche/prototype/CahierMotorisationFigure.vue'
import CahierOffreTransportsFigure from '@/fiche/prototype/CahierOffreTransportsFigure.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type { TerritoryFacts } from '@/fiche/content/territoryFacts'
import type { ThemeContent } from '@/fiche/content/themeContent'
import {
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Payload, ThemeMetadata } from '@/payload/types'
import { routes } from '@/router'

const varianteCahierLibreStyles = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'VarianteCahierLibre.vue'),
  'utf-8',
).match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''
const cahierEvidenceSourceStyles = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierEvidenceSource.css'),
  'utf-8',
)
const tokensStyles = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf-8')
const cartographicBreakoutStyles = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CartographicBreakoutPrototype.vue'),
  'utf-8',
).match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''

function regleCss(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`CSS rule not found: ${selector}`)
  return match[1]
}

function blocCss(css: string, atRule: string): string {
  const start = css.lastIndexOf(atRule)
  if (start < 0) throw new Error(`CSS at-rule not found: ${atRule}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index)
  }
  throw new Error(`Unclosed CSS at-rule: ${atRule}`)
}

function mediaCssBlocks(css: string): string[] {
  const blocks: string[] = []
  const mediaStarts = [...css.matchAll(/@media\b/g)].map((match) => match.index ?? -1)
  for (const start of mediaStarts) {
    const open = css.indexOf('{', start)
    let depth = 0
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}' && --depth === 0) {
        blocks.push(css.slice(open + 1, index))
        break
      }
    }
  }
  return blocks
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: [
    ...indicateursMobiliteFixture,
    ...indicateursMobiliteFixture
      .filter((row) => row.territoire === '22001' && row.key.startsWith('share_'))
      .map((row) => ({ ...row, territoire: '22002' })),
  ],
  histoires: histoiresMobiliteFixture,
  apercu: null,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: structuredClone(metadonneesThemesFixtures.mobilite) },
}

function factsForTarget(): TerritoryFacts {
  const facts = territoryFactsFor(payload, '22001')
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

describe('figures des unités Mobilité ajoutées', () => {
  it.each([['mean', 'Moyenne'], ['median', 'Médiane']] as const)(
    'nomme la référence selon la statistique servie (%s), pas selon la famille', async (kind, word) => {
      const facts = factsForTarget()
      for (const fact of facts.mobility.indicators) {
        fact.comparison = {
          direction: 'plus-est-mieux', scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
          reference: { kind, value: 2 }, rank: null,
        }
      }
      const content = resolveMobiliteThemeContent(facts)
      const router = createRouter({ history: createMemoryHistory(), routes })
      const wrapper = mount(VarianteCahierLibreE, {
        props: { content, pagination: paginationFor(content) },
        global: { plugins: [router] },
      })
      await router.isReady()
      await flushPromises()
      const names = wrapper.findAll('.cahier-network-bar-chart__reference-key')
      expect(names.length).toBeGreaterThan(0)
      for (const name of names) expect(name.text()).toBe(`${word} des communes de EPCI X`)
      for (const mark of wrapper.findAll('.cahier-comparison-value__reference')) {
        expect(mark.text()).not.toMatch(/Moyenne|Médiane|EPCI|·/)
        expect(mark.text()).toMatch(/^Groupe comparé :/)
      }
      wrapper.unmount()
    },
  )
  const contentFact = (key: string, detail: string | null, value: number, label: string, unit = '%') => ({
    label,
    fact: {
      key, detail, value, label, unit, availability: 'complete' as const, provenance: null,
      comparison: null, comparisonBasis: 'territory-median' as const, reason: null,
    },
  })

  it('trace une seule série raccordement pour le territoire sélectionné', () => {
    const trajectory = [contentFact('raccordement_courbe', 't0000', 0.1, '0'), contentFact('raccordement_courbe', 't0090', 0.7, '1 h 30')]
    const published = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8'))
    const metadata = published.indicator_pages.raccordement_courbe
    if (metadata.family !== 'trajectory') throw new Error('Fixture must declare a trajectory')
    const wrapper = mount(CahierOffreTransportsFigure, {
      props: { offer: contentFact('offre_tc', null, 0.4, 'Part des bâtiments près d’un arrêt'), trajectory, metadata: metadata.trajectory },
    })
    expect(wrapper.find('path[data-series="territory"]').attributes('d')).toContain('M')
    expect(wrapper.find('path[data-series="reference"]').exists()).toBe(false)
    expect(wrapper.findAll('path.transit-series')).toHaveLength(1)
    expect(wrapper.findAll('.transit-point')).toHaveLength(2)
    expect(wrapper.text()).not.toContain(metadata.trajectory.reference?.label)
    expect(wrapper.find('.transit-marker').attributes('data-detail')).toBe(metadata.trajectory.marker?.detail)
    expect(wrapper.find('.transit-marker-label').text()).toBe(metadata.trajectory.marker?.label)
    expect(wrapper.findAll('.cahier-figure-axis').length).toBe(2)

    expect(wrapper.find('.transit-legend-reference').exists()).toBe(false)
    expect(wrapper.find('.transit-legend-territory').exists()).toBe(true)
    expect(wrapper.find('.transit-legend-territory').attributes('aria-label')).toBe('Série du territoire')
    expect(wrapper.find('svg[role="img"]').attributes('aria-label')).toContain('Territoire')
    expect(wrapper.find('svg[role="img"]').attributes('aria-label')).not.toContain(metadata.trajectory.reference?.label)

    const riderFigure = mount(CahierOffreTransportsFigure, {
      props: {
        offer: { ...contentFact('offre_tc', null, 0, 'Part des bâtiments près d’un arrêt'), fact: { ...contentFact('offre_tc', null, 0, 'Part des bâtiments près d’un arrêt').fact, value: null, reason: 'Aucune station desservie' } },
        trajectory: [{ ...contentFact('raccordement_courbe', 't0090', 0, '1 h 30'), fact: { ...contentFact('raccordement_courbe', 't0090', 0, '1 h 30').fact, value: null, reason: 'Courbe non calculable' } }],
        metadata: metadata.trajectory,
      },
    })
    expect(riderFigure.text()).toContain('Indisponible')
    expect(riderFigure.text()).toContain('Aucune station desservie')
    expect(riderFigure.text()).toContain('Courbe non calculable')
  })

  it('plots the payload-labeled household composition as separate bars with exact share values', () => {
    const composition = [
      contentFact('voitures_menage', 'sans_voiture', 0.25, 'Ménages sans voiture'),
      contentFact('voitures_menage', 'une_voiture', 0.5, 'Ménages avec 1 voiture'),
      contentFact('voitures_menage', 'deux_plus', 0.25, 'Ménages avec 2 voitures ou plus'),
    ]
    const wrapper = mount(CahierMotorisationFigure, { props: { composition, charging: [] } })
    const bars = wrapper.findAll('.motorisation-bar')
    expect(bars).toHaveLength(3)
    expect(wrapper.findAll('.motorisation-part').map(row => row.attributes('data-value'))).toEqual(['0.25', '0.5', '0.25'])
    expect(wrapper.text()).toContain('Ménages avec 2 voitures ou plus')
    expect(bars.map(bar => bar.attributes('style'))).toEqual(expect.arrayContaining([expect.stringContaining('25%'), expect.stringContaining('50%')]))
  })

  it('keeps only payload-present motorisation facts and carries a null fact rider into the figure', () => {
    const metadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8')) as ThemeMetadata
    const original = factsForTarget()
    const sansVoiture = original.mobility.indicators.find(fact => fact.key === 'voitures_menage' && fact.detail === 'sans_voiture')
    expect(sansVoiture).toBeDefined()
    const withoutPart = {
      ...original,
      mobility: { ...original.mobility, indicators: original.mobility.indicators.filter(fact => fact !== sansVoiture && fact.key !== 'bornes_recharge' && fact.key !== 'bornes_ev_par_station_service') },
    }
    const absentContent = resolveMobiliteThemeContent(withoutPart, metadata)
    const absentEvidence = absentContent.units[2]!.sections[0]!.evidence
    expect(absentEvidence?.kind).toBe('motorisation')
    if (absentEvidence?.kind !== 'motorisation') throw new Error('Motorisation evidence should include remaining published facts')
    expect(absentEvidence.composition.some(part => part.fact.detail === 'sans_voiture')).toBe(false)
    expect(absentEvidence.charging).toHaveLength(0)
    expect(absentContent.units.map(unit => unit.label)).toEqual([
      'L’accès aux services', 'Le partage de l’espace public', 'La motorisation', 'L’offre de transports en commun',
    ])
    expect(absentContent.units[2]!.label).toBe('La motorisation')
    expect(absentContent.units[3]!.label).toBe('L’offre de transports en commun')

    const baseFact = original.mobility.indicators.find(fact => fact.key === 'bornes_recharge')!
    const rider = { ...baseFact, key: 'bornes_ev_par_station_service', value: null, reason: 'Aucune station-service sur le territoire' }
    const withRider = {
      ...withoutPart,
      mobility: { ...withoutPart.mobility, indicators: [...withoutPart.mobility.indicators, rider] },
    }
    const riderEvidence = resolveMobiliteThemeContent(withRider, metadata).units[2]!.sections[0]!.evidence
    if (riderEvidence?.kind !== 'motorisation') throw new Error('Motorisation evidence should keep its declared null fact')
    const wrapper = mount(CahierMotorisationFigure, { props: riderEvidence })
    expect(wrapper.text()).toContain('Indisponible')
    expect(wrapper.text()).toContain('Aucune station-service sur le territoire')
    expect(wrapper.findAll('.motorisation-part')).toHaveLength(metadata.detail_labels.voitures_menage ? Object.keys(metadata.detail_labels.voitures_menage).length - 1 : 2)
  })
})

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
  it('renders the body content, pagination and honest empty access unit (#627)', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const wrapper = await render(content)

    expect(wrapper.find('.cahier-cover').exists()).toBe(false)
    expect(wrapper.find('.cahier-page').text()).toContain('L’accès aux services')
    // #627 - the acces-aux-services unit keeps its structural identity and
    // renders no legacy placeholder sections: only the retained subgroups
    // carry sections.
    expect(wrapper.find('[data-section="resume"]').exists()).toBe(false)
    expect(wrapper.find('[data-section="profils-acces-par-mode"]').exists()).toBe(false)
    expect(wrapper.find('[data-section="services-essentiels"]').exists()).toBe(false)
    expect(wrapper.find('[data-section="distribution-acces-par-batiment"]').exists()).toBe(false)
    expect(wrapper.find('.summary-evidence').exists()).toBe(false)
    expect(wrapper.find('.bpe-evidence').exists()).toBe(false)
    expect(wrapper.find('.access-figure-collection').exists()).toBe(false)
    expect(wrapper.find('.sources-page').text()).toContain(content.sourceRegister[0]?.source)
    expect(wrapper.find('.page-number').text()).toBe('page 01/14')
  })
  it('renders Variant E subgroups vertically at full width and in content order', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const wrapper = await render(content, 'plain')
    const groups = wrapper.findAll('.concept-group')

    expect(wrapper.find('.cahier').classes()).toContain('cahier--sans-grille')
    // #627 - the single-unit (non-showAllUnits) presentation renders only the
    // first unit, which now carries the structural access identity with no
    // sections: no legacy placeholder body renders. The production cahier
    // mounts with showAllUnits (covered by the public-space test below).
    expect(groups).toHaveLength(0)
    expect(wrapper.find('.cahier-page').text()).toContain('L’accès aux services')
    expect(wrapper.findAll('.cahier-section-exploration--unit-footer')).toHaveLength(0)
  })
})

describe('Variante E — partage de l’espace public', () => {
  it('uses the spacing token for mobile Cahier page insets', () => {
    const mobileStyles = blocCss(varianteCahierLibreStyles, '@media (max-width: 760px)')

    expect(mobileStyles).toContain('--page-left-inset: var(--space-4);')
    expect(mobileStyles).toContain('--page-right-inset: var(--space-4);')
    expect(mobileStyles).toContain('padding-inline: var(--space-4);')
  })

  it('uses the shared overline tracking for the cartographic plate orientation', () => {
    const orientation = regleCss(cartographicBreakoutStyles, '\\.plate-orientation')

    expect(orientation).toContain('letter-spacing: var(--text-overline-tracking);')
    expect(orientation).not.toContain('letter-spacing: .06em;')
  })

  it('flows plain Cahier marginalia below the page content through the mobile breakpoint', () => {
    const mobileStyles = blocCss(varianteCahierLibreStyles, '@media (max-width: 760px)')

    expect(regleCss(mobileStyles, '\\.page-margin')).toContain('position: static;')
  })

  it('routes Cahier reading and title styles through semantic font roles', () => {
    expect(regleCss(varianteCahierLibreStyles, '\\.cahier')).toContain(
      'font-family: var(--font-body);',
    )
    const pageHeading = regleCss(varianteCahierLibreStyles, '\\.page-heading h2')
    expect(pageHeading).toContain('font: var(--text-page-heading);')
    expect(pageHeading).toContain('letter-spacing: var(--text-page-heading-tracking);')
    expect(pageHeading).not.toMatch(/font-(?:family|weight)\s*:|line-height\s*:/)
    const sectionHeading = regleCss(varianteCahierLibreStyles, '\\.concept-group-heading h3')
    expect(sectionHeading).toContain('font: var(--text-cahier-section);')
    expect(sectionHeading).not.toContain('font-family:')
    expect(sectionHeading).not.toContain('font-size:')
    expect(sectionHeading).not.toContain('font-weight:')
    expect(sectionHeading).not.toContain('line-height:')
    expect(regleCss(varianteCahierLibreStyles, '\\.cahier--sans-grille \.summary-metric-title')).toContain(
      'font-family: var(--font-figure-label);',
    )
  })

  it('keeps the indexed page heading on its token size and reflows its metadata row on mobile', () => {
    const evidenceSource = regleCss(cahierEvidenceSourceStyles, '\\.cahier-evidence-source')
    const marginSource = regleCss(varianteCahierLibreStyles, '\\.margin-sources a')
    for (const rule of [evidenceSource, marginSource]) {
      expect(rule).toContain('font: 500 var(--text-source-stamp-size)/1.4 var(--font-metadata);')
      expect(rule).toContain('letter-spacing: var(--text-caption-tracking);')
    }
    expect(cahierEvidenceSourceStyles).not.toContain('@media (max-width: 760px)')
    expect(varianteCahierLibreStyles).not.toContain('.margin-sources a { font-size: 11px; }')
    expect(tokensStyles).toMatch(/--text-source-stamp-size:\s*0\.625rem;/u)
    expect(tokensStyles).toMatch(
      /@media\s*\(max-width:\s*760px\)\s*\{\s*:root\s*\{\s*--text-source-stamp-size:\s*0\.6875rem;\s*\}\s*\}/u,
    )
    expect(regleCss(varianteCahierLibreStyles, '\\.page-number span, \\.page-number small')).toContain(
      'font: var(--text-overline);',
    )
    const pageNumberSpan = regleCss(varianteCahierLibreStyles, '\\.page-number span')
    expect(pageNumberSpan).toContain('text-transform: uppercase;')
    expect(pageNumberSpan).not.toMatch(/font-weight\s*:|letter-spacing\s*:/)
    expect(varianteCahierLibreStyles).not.toMatch(/\.concept-group-label\s*\{\s*font-family\s*:/)
    const mobileStyles = blocCss(varianteCahierLibreStyles, '@media (max-width: 600px)')
    const indexedHeading = regleCss(
      varianteCahierLibreStyles,
      '\\.cahier--indexed-sections \\.page-heading h2',
    )
    expect(indexedHeading).toContain('text-align: left;')
    expect(indexedHeading).not.toMatch(/font-(?:family|size|weight)\s*:|letter-spacing\s*:|line-height\s*:/)
    for (const mediaBlock of mediaCssBlocks(varianteCahierLibreStyles)) {
      const mediaHeading = mediaBlock.match(
        /\.cahier--indexed-sections\s+\.page-heading\s+h2\s*\{([^}]*)\}/,
      )?.[1] ?? ''
      expect(mediaHeading).not.toMatch(/font-size\s*:/)
    }

    const pageHeadingContext = regleCss(
      varianteCahierLibreStyles,
      '\\.cahier--indexed-sections \\.page-heading-context',
    )
    expect(pageHeadingContext).toContain('font-size: var(--text-cahier-min-size);')
    expect(pageHeadingContext).not.toContain('--type-figure-tick-size')
    const mobilePageHeadingContext = regleCss(
      mobileStyles,
      '\\.cahier--indexed-sections \\.page-heading-context',
    )
    expect(mobilePageHeadingContext).not.toMatch(/font-size\s*:/)
    expect(
      regleCss(
        mobileStyles,
        '\\.cahier--indexed-sections \\.page-layout--sticky \\.page-heading',
      ),
    ).toContain('grid-template-columns: var(--cahier-indexed-heading-index-column) minmax(0, 1fr);')
    expect(regleCss(mobileStyles, '\\.cahier--indexed-sections \\.page-heading-index')).toContain(
      'grid-column: 1;',
    )
    expect(regleCss(mobileStyles, '\\.cahier--indexed-sections \\.page-heading-index')).toContain(
      'grid-row: 1;',
    )
    expect(regleCss(mobileStyles, '\\.cahier--indexed-sections \\.page-heading h2')).toContain(
      'grid-column: 1 / -1;',
    )
    expect(regleCss(mobileStyles, '\\.cahier--indexed-sections \\.page-heading h2')).toContain(
      'grid-row: 2;',
    )
    expect(mobilePageHeadingContext).toContain('grid-column: 2;')
    expect(mobilePageHeadingContext).toContain('grid-row: 1;')
  })

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
      'L’accès aux services',
      'Le partage de l’espace public',
      'La motorisation',
      'L’offre de transports en commun',
    ])
    expect(wrapper.findAll('.cahier-page .page-number').map((number) => number.text())).toEqual([
      'page 01/14',
      'page 02/14',
      'page 03/14',
      'page 04/14',
    ])
    for (const page of wrapper.findAll('.cahier-page')) {
      const groups = page.findAll('.concept-group')
      expect(groups.every((group) => !group.attributes('style'))).toBe(true)
    }
    expect(wrapper.findAll('.page-rundown').map((rundown) => rundown.text())).toHaveLength(4)
    expect(wrapper.findAll('.page-rundown')[1]!.text()).toContain('réseau cyclable')
    // #627 - the retired legacy access sections no longer carry their
    // Marelles; only the retained public-space figures' narratives render.
    expect(wrapper.findAll('.concept-group-narrative').map((heading) => heading.text())).toEqual([
      'Une piste ne suffit pas',
      'Quelle place pour chaque mode ?',
    ])
    expect(wrapper.find('.map-breakout').exists()).toBe(true)
    expect(wrapper.find('.sharing-networks-evidence').exists()).toBe(false)
    expect(wrapper.find('.sharing-cycling-offer-evidence').exists()).toBe(true)
    expect(wrapper.find('.sharing-parking-evidence').exists()).toBe(true)
    expect(wrapper.find('.road-surface-figure').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Part du territoire couverte par des polygones d’usage routier de tout type.')
    expect(wrapper.text()).toContain('Médiane des')
    expect(wrapper.find('.sharing-network-figure').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Trois longueurs, un horizon')
    expect(wrapper.text()).not.toContain('Le point d’arrivée varie avec la longueur du réseau.')
    expect(wrapper.findAll('.sharing-cycling-reading')).toHaveLength(5)
    expect(wrapper.findAll('.sharing-parking-reading')).toHaveLength(3)
    // #627 - the retired legacy figure lectures no longer render; the three
    // retained public-space/parking readings own the figure-lecture slots.
    expect(wrapper.findAll('.cahier-figure-lecture')).toHaveLength(3)
    expect(wrapper.findAll('.cahier-section-exploration--unit-footer')).toHaveLength(4)
    // #860 (ruling) — une seule légende par figure : la note « Groupe comparé »
    // séparée est retirée ; la loi de nommage vit dans la légende de la figure.
    expect(wrapper.findAll('.cahier-comparison-note')).toHaveLength(0)
    expect(wrapper.text()).toContain('Médiane des communes de EPCI X')
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
    await router.push({ path: '/' })
    await router.isReady()
    document.querySelectorAll('.lusk-map-gallery').forEach((element) => element.remove())
    const wrapper = mount(CartographicBreakoutPrototype, {
      props: { evidence: sharing.evidence, cyclingEvidence: cycling.evidence, territory: content.territory },
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.find('.map-breakout--c').exists()).toBe(true)
    expect(wrapper.find('.plate').attributes('aria-label')).toContain(content.territory.name)
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
    expect(wrapper.find('.border-legend').text()).toContain(content.territory.name)
    expect(wrapper.findAll('.map-panel img').map((image) => image.attributes('src'))).toEqual(['car', 'walk', 'bike'].map((mode) => `https://images.calumrobertson.fr/maps/v1/${content.territory.code}-${mode}-inline.webp`))
    expect(wrapper.find('.plate-subfigure--road').exists()).toBe(true)
    expect(wrapper.find('.plate-subfigure--road .cahier-network-bar-row').exists()).toBe(true)
    expect(wrapper.find('.plate-subfigure--road .cahier-network-bar-chart__unit').text()).toBe('%')
    expect(wrapper.findAll('.map-panel h4')).toHaveLength(0)
    expect(wrapper.find('.cahier-figure-lecture').exists()).toBe(true)
    // #860 (ruling) — la clé de référence de la figure porte la loi de nommage
    // (statistique + portée résolue), pas un « Groupe comparé » générique.
    expect(wrapper.find('.cahier-network-bar-chart__reference-key').text()).toContain('Médiane des communes de EPCI X')
    expect(wrapper.findAll('.cahier-network-bar-chart__reference-key')).toHaveLength(1)
    expect(wrapper.findAll('.cahier-comparison-note')).toHaveLength(0)
    await wrapper.find('.cahier-network-bar-row--bike').trigger('mouseenter')
    expect(wrapper.find('.plate-network-tooltip').exists()).toBe(true)
    expect(wrapper.find('.plate-network-tooltip').text()).toContain('Médiane des communes de EPCI X')
    expect(wrapper.find('.cahier-network-bar-row--car').classes()).toContain('cahier-network-bar-row--dimmed')
    await wrapper.find('.map-panel--bike').trigger('mouseenter')
    expect(wrapper.find('.map-panel--car').classes()).toContain('map-panel--dimmed')
    expect(wrapper.findAll('.map-gallery-source img')).toHaveLength(3)
    expect(wrapper.findAll('.map-gallery-source img').map((image) => image.attributes('src'))).toEqual([undefined, undefined, undefined])
    await wrapper.find('.map-panel img').trigger('error')
    await flushPromises()
    expect(wrapper.find('.map-panel--car img').exists()).toBe(false)
    expect(wrapper.find('.map-panel--car [role="status"]').text()).toBe('Carte indisponible')
    expect(wrapper.find('.map-panel--bike img').exists()).toBe(true)
    await wrapper.find('.map-panel--car .map-viewport').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.map-gallery-source img').map((image) => image.attributes('src'))).toEqual(['car', 'walk', 'bike'].map((mode) => `https://images.calumrobertson.fr/maps/v1/${content.territory.code}-${mode}-inspection.webp`))
    const viewer = document.querySelector('.lusk-map-gallery')
    expect(viewer).not.toBeNull()
    expect(viewer?.querySelector('.viewer-navbar')).not.toBeNull()
    expect(viewer?.querySelector('.viewer-list')).not.toBeNull()
    expect(viewer?.querySelector('.viewer-navigation')).not.toBeNull()
    expect(viewer?.querySelector('.viewer-button')).not.toBeNull()
  })

  it('keeps Andel’s inline bike map and omits zero-coverage inspection while opening car and walk', async () => {
    const content = resolveMobiliteThemeContent(factsForTarget())
    const sharing = content.units.find((unit) => unit.key === 'partage-de-lespace-public')?.sections.find((section) => section.key === 'reseaux')
    if (!sharing?.evidence || sharing.evidence.kind !== 'sharing-networks') throw new Error('Expected sharing-network evidence')
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    await router.isReady()
    document.querySelectorAll('.lusk-map-gallery').forEach((element) => element.remove())
    const andelEvidence = {
      ...sharing.evidence,
      networks: sharing.evidence.networks.map((network) => network.mode === 'bike'
        ? { ...network, length: { ...network.length, fact: { ...network.length.fact, value: 0 } } }
        : network),
    }
    const wrapper = mount(CartographicBreakoutPrototype, {
      props: { evidence: andelEvidence, territory: { code: '22002', name: 'Andel' } },
      global: { plugins: [router] },
    })
    await flushPromises()
    const bikeInline = wrapper.find('.map-panel--bike img')
    expect(bikeInline.attributes('src')).toBe('https://images.calumrobertson.fr/maps/v1/22002-bike-inline.webp')
    expect(wrapper.findAll('.map-gallery-source img')).toHaveLength(2)
    expect(wrapper.findAll('.map-gallery-source img').every((image) => image.attributes('src') === undefined)).toBe(true)
    await bikeInline.trigger('load')
    await wrapper.find('.map-panel--bike .map-viewport').trigger('click')
    await flushPromises()
    expect(document.querySelector('.lusk-map-gallery')).toBeNull()
    expect(wrapper.find('.inspection-unavailable').text()).toContain('Réseau cyclable sans réseau recensé')
    for (const mode of ['car', 'walk'] as const) {
      await wrapper.find(`.map-panel--${mode} .map-viewport`).trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.map-gallery-source img').map((image) => image.attributes('src'))).toEqual(['car', 'walk'].map((m) => `https://images.calumrobertson.fr/maps/v1/22002-${m}-inspection.webp`))
      expect(document.querySelector('.lusk-map-gallery .viewer-navbar')).not.toBeNull()
    }
    expect(wrapper.find('.inspection-unavailable').exists()).toBe(false)
    expect(wrapper.find('.map-panel--bike img').attributes('src')).toBe('https://images.calumrobertson.fr/maps/v1/22002-bike-inline.webp')
    expect(wrapper.find('.map-panel--bike [role="status"]').exists()).toBe(false)
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
