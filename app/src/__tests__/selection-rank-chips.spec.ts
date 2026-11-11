import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CahierComparisonValue from '../fiche/prototype/CahierComparisonValue.vue'
import type { NumericFact } from '../fiche/content/territoryFacts'
import { detailsRangEnContexte, rangEnContexte } from '../payload/selectors'
import { indicateursHabitatFixture } from '../payload/fixtures'
import IndicatorFigure from '../components/fiche/IndicatorFigure.vue'
import ValeurComparaison from '../components/fiche/ValeurComparaison.vue'
import { lignesAvecComparaisonApi } from '../payload/themeFactsAdapter'
import CahierRoadSurfaceFigure from '../fiche/prototype/CahierRoadSurfaceFigure.vue'
import { createMemoryHistory, createRouter } from 'vue-router'

function fact(): NumericFact {
  return {
    key: 'emprise', detail: null, value: .2, unit: '%', availability: 'complete', provenance: null,
    comparisonBasis: 'territory-median', reason: null,
    comparison: { direction: 'moins-est-mieux', scope: { kind: 'communes-epci', label: 'communes de Rennes Métropole' },
      rank: { position: 2, size: 41 }, reference: { kind: 'median', value: .3 } },
  }
}

describe('Rang de la sélection — valeur du Groupe comparé', () => {
  it('porte aussi le rang dans le nom du scalaire qui englobe la référence', () => {
    const wrapper = mount(CahierRoadSurfaceFigure, { props: { targets: [], evidence: {
      kind: 'sharing-networks', figureTitle: 'Réseaux', frameTitle: 'Réseaux', networkReadingsLabel: 'Longueurs',
      territoryName: 'Commune', roadSurface: { fact: fact(), label: 'Emprise' }, roadSurfaceLecture: [],
      networks: [], absoluteNetworks: [], comparisonLabel: 'communes de Rennes Métropole', figureLecture: [],
    } } })
    expect(wrapper.get('.road-surface-scalar').attributes('aria-label')).toContain('2e/41')
    expect(wrapper.get('.road-surface-scalar').attributes('aria-label')).toContain('moins = mieux')
  })
  it.each(['scalar', 'profile'] as const)('rend la référence et le rang API de la famille %s sans répéter la portée', (family) => {
    const row = { ...indicateursHabitatFixture[0]!, key: 'part_passoires', detail: family === 'profile' ? 'A' : null }
    const result = { indicator_id: row.key, indicator: row.key, status: 'available', direction: 'low',
      median: .3, rank: 2, rank_size: 4,
      ...(family === 'profile' ? { facet: { detail: 'A', sex: null } } : {}),
    }
    const lignes = lignesAvecComparaisonApi([row], { results: family === 'profile' ? [] : [result],
      profile_comparisons: family === 'profile' ? [result] : [] }, 'communes de la sélection')
    const wrapper = mount(IndicatorFigure, { props: { lignes, clef: row.key, theme: 'habitat', libelle: 'Passoires' } })
    const mark = wrapper.get('.figure-indicateur-comparaison')
    expect(mark.text()).toContain('Groupe comparé : 30 %')
    expect(mark.text()).toContain('2e/4')
    expect(mark.get('[role="img"]').attributes('aria-label')).toContain('Médiane des communes de la sélection')
    expect(mark.findAll('[aria-label]')).toHaveLength(1)
    expect(mark.get('.puce-rang').attributes('aria-hidden')).toBe('true')
    expect(wrapper.text()).not.toContain('communes de la sélection')
  })
  it('ne rend aucun rang API pour un groupe de zéro ou un membre, sans restaurer les colonnes statiques', () => {
    const row = indicateursHabitatFixture[0]!
    for (const taille of [0, 1]) {
      const singleton = { ...row, comparaisonApi: { rang: 1, taille, portee: 'de la sélection' } }
      expect(rangEnContexte(singleton)).toBeNull()
      expect(detailsRangEnContexte(singleton)).toBeNull()
    }
    expect(rangEnContexte({ ...row, comparaisonApi: undefined, rang_epci: 2, rang_epci_n: 41 })).toBeNull()
  })
  it('garde la valeur du membre unique, même si le focal est hors sélection et donc sans rang', () => {
    const row = { ...indicateursHabitatFixture[0]!, key: 'part_passoires', detail: null }
    const lignes = lignesAvecComparaisonApi([row], { results: [{ indicator_id: row.key, status: 'available',
      direction: 'low', median: .2, rank: null, rank_size: null }], profile_comparisons: [] }, 'communes de la sélection')
    const wrapper = mount(IndicatorFigure, { props: { lignes, clef: row.key, theme: 'habitat', libelle: 'Passoires' } })
    expect(wrapper.get('.figure-indicateur-comparaison').text()).toBe('Groupe comparé : 20 %')
    expect(wrapper.find('.puce-rang').exists()).toBe(false)
  })

  it.each([
    ['communes de son EPCI', 2, 41],
    ['EPCI de Bretagne', 14, 61],
    ['départements de Bretagne', 4, 4],
  ] as const)('nomme la portée native %s sans la répéter sur la page', (label, position, size) => {
    const native = fact()
    native.comparison!.scope.label = label
    native.comparison!.rank = { position, size }
    const wrapper = mount(CahierComparisonValue, { props: { fact: native } })
    expect(wrapper.get('.cahier-rank').text()).toContain(`${position}e/${size}`)
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain(label)
    expect(wrapper.text()).not.toContain(label)
  })
  it('place le rang mint sous la valeur, sans glyphe visible et avec un nom accessible complet', () => {
    const wrapper = mount(CahierComparisonValue, { props: { fact: fact() } })
    const mark = wrapper.get('.cahier-comparison-value__reference')
    expect(mark.element.childNodes[0]?.textContent).not.toContain('2e/41')
    expect(mark.find('.cahier-rank').text()).toContain('2e/41')
    expect(mark.get('.cahier-rank').classes()).toContain('cahier-rank--comparison')
    expect(mark.text()).not.toMatch(/[▲▼↑↓]/)
    expect(wrapper.text()).not.toMatch(/Rennes|Médiane|communes/)
    expect(mark.attributes('aria-label')).toContain('2e/41')
    expect(mark.attributes('aria-label')).toContain('Médiane des communes de Rennes Métropole')
    const chip = wrapper.get('.cahier-rank')
    expect(chip.attributes('title')).toContain('moins = mieux')
    expect(getComputedStyle(chip.element).color).toBe(getComputedStyle(document.documentElement).getPropertyValue('--brand-200').trim())
    expect(chip.attributes('aria-label')).toBeUndefined()
    expect(chip.attributes('aria-hidden')).toBe('true')
  })

  it('garde la case comparaison stable pendant le chargement et expose une explication hover/focus/tap distincte du retry', async () => {
    const wrapper = mount(CahierComparisonValue, { props: { comparisonStatus: 'loading' } })
    const pendingBox = wrapper.get('.cahier-comparison-value__state').element.getBoundingClientRect()
    expect(wrapper.get('.cahier-comparison-value__spinner').element.closest('[aria-hidden="true"]')).not.toBeNull()
    await wrapper.setProps({ comparisonStatus: 'error', comparisonError: 'lecture refusée' })
    const failedBox = wrapper.get('.cahier-comparison-value__state').element.getBoundingClientRect()
    expect(failedBox.width).toBe(pendingBox.width)
    expect(failedBox.height).toBe(pendingBox.height)
    const warning = wrapper.get('.cahier-comparison-value__warning')
    expect(warning.attributes('aria-label')).toContain('Afficher l’explication')
    await warning.trigger('focus')
    expect(wrapper.get('[role="tooltip"]').text()).toContain('lecture refusée')
    expect(warning.attributes('aria-describedby')).toBe(wrapper.get('[role="tooltip"]').attributes('id'))
    await warning.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false)
    await warning.trigger('click')
    expect(wrapper.get('[role="tooltip"]').text()).toContain('lecture refusée')
    await wrapper.setProps({ comparisonStatus: 'ready' })
    expect(wrapper.text()).toBe('')
  })

  it('renders a compact unavailable explanation in the comparison slot without a retry affordance', async () => {
    const wrapper = mount(ValeurComparaison, { props: {
      ligne: { comparaisonApi: null, unit: '%' } as any,
      status: 'unavailable',
    } })
    const cue = wrapper.get('.comparison-unavailable-cue__trigger')
    expect(wrapper.find('.comparison-unavailable').exists()).toBe(false)
    expect(wrapper.find('.comparison-section-retry').exists()).toBe(false)
    expect(wrapper.find('.comparison-warning').exists()).toBe(false)
    await cue.trigger('focus')
    expect(wrapper.get('[role="tooltip"]').text()).toContain('identité du groupe comparé')
    expect(cue.attributes('aria-expanded')).toBe('true')
  })

  it.each([false, true])('donne un seul nom complet au repère Cahier (lien : %s)', async (linked) => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/')
    const wrapper = mount(CahierComparisonValue, { props: { fact: fact(), to: linked ? '/' : null },
      global: { plugins: [router] } })
    const mark = wrapper.get('.cahier-comparison-value__reference')
    expect(mark.attributes('aria-label')).toContain('Groupe comparé : 30 %')
    expect(mark.attributes('aria-label')).toContain('2e/41 — moins = mieux')
    expect(mark.attributes('aria-label')).toContain('Médiane des communes de Rennes Métropole')
    expect(mark.findAll('[aria-label]')).toHaveLength(0)
    expect(mark.get('.cahier-rank').attributes('aria-hidden')).toBe('true')
    expect(mark.findAll('a')).toHaveLength(0)
    if (linked) {
      expect(mark.element.tagName).toBe('A')
      expect(mark.attributes('href')).toBe('/')
      expect(mark.attributes('target')).toBe('_blank')
    }
  })

  it('marque un rang partagé servi d’un « = » dans la puce Cahier et dit « ex æquo » en aria', async () => {
    const tied = fact()
    tied.comparison = { ...tied.comparison!, rank: { position: 1, size: 41, ties: 3 } }
    const wrapper = mount(CahierComparisonValue, { props: { fact: tied } })
    expect(wrapper.get('.cahier-rank').text()).toBe('=1er/41')
    const mark = wrapper.get('.cahier-comparison-value__reference')
    expect(mark.attributes('aria-label')).toContain('1er/41 (ex æquo)')
    expect(mark.attributes('aria-label')).not.toContain('=1er')
    const untied = fact()
    untied.comparison = { ...untied.comparison!, rank: { position: 1, size: 41, ties: 1 } }
    await wrapper.setProps({ fact: untied })
    expect(wrapper.get('.cahier-rank').text()).toBe('1er/41')
  })

  it('porte le « = » jusqu’à la puce de page depuis le rang servi par l’API', () => {
    const row = { ...indicateursHabitatFixture[0]!, key: 'part_passoires', detail: null }
    const lignes = lignesAvecComparaisonApi([row], { results: [{ indicator_id: row.key, status: 'available',
      direction: 'low', median: .3, rank: 1, rank_size: 41, rank_ties: 3 }], profile_comparisons: [] },
    'communes de la sélection')
    expect(lignes[0]!.comparaisonApi?.ties).toBe(3)
    const wrapper = mount(IndicatorFigure, { props: { lignes, clef: row.key, theme: 'habitat', libelle: 'Passoires' } })
    const mark = wrapper.get('.figure-indicateur-comparaison')
    expect(mark.text()).toContain('=1er/41')
    expect(mark.get('[role="img"]').attributes('aria-label')).toContain('=1er/41')
  })

  it('actualise le rang et sa portée sans conserver la sélection précédente, puis masque le rang du singleton', async () => {
    const wrapper = mount(CahierComparisonValue, { props: { fact: fact() } })
    const selected = fact()
    selected.comparison = { direction: 'plus-est-mieux', scope: { kind: 'communes-bretagne', label: 'territoires de la sélection' },
      rank: { position: 1, size: 3 }, reference: { kind: 'median', value: .4 } }
    await wrapper.setProps({ fact: selected })
    expect(wrapper.text()).toContain('1er/3')
    expect(wrapper.text()).not.toMatch(/[▲▼↑↓]/)
    expect(wrapper.get('.cahier-comparison-value__reference').attributes('aria-label')).toContain('sélection')
    expect(wrapper.html()).not.toContain('Rennes Métropole')
    await wrapper.setProps({ fact: { ...selected, comparison: { ...selected.comparison!, rank: { position: 1, size: 1 } } } })
    expect(wrapper.find('.cahier-rank').exists()).toBe(false)
    expect(wrapper.text()).toContain('Groupe comparé : 40 %')
    await wrapper.setProps({ fact: { ...selected, comparison: null } })
    expect(wrapper.text()).toBe('')
  })
})
