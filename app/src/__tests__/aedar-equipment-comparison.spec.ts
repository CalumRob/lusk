import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AedarEquipmentComparisonCahier from '@/fiche/prototype/AedarEquipmentComparisonCahier.vue'
import AedarEquipmentQuantileFigureCahier from '@/fiche/prototype/AedarEquipmentQuantileFigureCahier.vue'
import CahierGroupedVerticalBarChart from '@/fiche/prototype/CahierGroupedVerticalBarChart.vue'
import type { AedarFact } from '@/fiche/content/aedarApiClient'
import { aedarEquipmentExplorerSection } from '@/fiche/content/aedarAccessSection'

const fact: AedarFact = { territory_type: 'commune', territory_id: 'sel-c1', typequ: 'A104', typequ_label: 'Équipement',
  identity: {}, n_addresses: 10, n_observed: 8, coverage_status: 'covered', measures: { count_5_walk_mean: 5, count_5_walk_decile1: 1 },
  source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test', licence: 'ODbL', attribution: 'AEDAR',
  reference_date: null, publication_date: null }
const cell = { ...fact, measure: 'count_5_walk_mean', statistic: 'pooled' as const, group_coverage_status: 'covered',
  group_n_addresses: 50, group_n_observed: 42,
  group_value: 7.4, rank: 3, rank_size: 3, rank_ties: 1, direction: 'high' as const }
const comparison = { label: 'Moyenne de la sélection', contentVersion: 'a', referenceContentVersion: 'b',
  cells: [cell, { ...cell, measure: 'count_5_walk_decile1', group_value: 2.2, rank: null, rank_size: null, rank_ties: null }] }

describe('Bac à sable et Groupe comparé AEDAR', () => {
  it('place le rang API à côté de la moyenne TYPEQU et le nomme sans répéter la portée visible', () => {
    const wrapper = mount(AedarEquipmentComparisonCahier, { props: { fact, comparison, referenceFact: null,
      label: comparison.label, horizonMinutes: 5, selectedModes: ['walk'] } })
    expect(wrapper.text()).toContain('Groupe comparé : 7,4')
    expect(wrapper.text()).toContain('↑ 3e/3')
    expect(wrapper.text()).not.toContain('Moyenne de la sélection')
    const accessibleName = wrapper.get('[role="img"]').attributes('aria-label')!
    expect(accessibleName).toContain('Moyenne de la sélection : 7,4. Rang du territoire : 3e/3, plus est mieux')
    expect(accessibleName).not.toContain('Groupe comparé')
    wrapper.unmount()
  })
  it.each([null, 'pending_review'])('montre la référence indisponible sans puce pour une couverture inconnue (%s)', (coverage) => {
    const wrapper = mount(AedarEquipmentComparisonCahier, { props: { fact,
      comparison: { ...comparison, cells: [{ ...cell, group_coverage_status: coverage }] }, referenceFact: null,
      label: comparison.label, horizonMinutes: 5, selectedModes: ['walk'] } })
    expect(wrapper.text()).toContain('Groupe comparé : Indisponible')
    expect(wrapper.find('.aedar-equipment-comparison-rank').exists()).toBe(false)
    wrapper.unmount()
  })
  it('garde la moyenne pour un membre unique sans puce', () => {
    const wrapper = mount(AedarEquipmentComparisonCahier, { props: { fact,
      comparison: { ...comparison, cells: [{ ...cell, rank: 1, rank_size: 1 }] }, referenceFact: null,
      label: comparison.label, horizonMinutes: 5, selectedModes: ['walk'] } })
    expect(wrapper.text()).toContain('Groupe comparé : 7,4')
    expect(wrapper.find('.aedar-equipment-comparison-rank').exists()).toBe(false)
    wrapper.unmount()
  })
  it('apparie les quantiles focaux avec les moyennes par cellule API, jamais avec des rangs', () => {
    const evidence = aedarEquipmentExplorerSection({ status: 'ready', facts: [fact], contentVersion: 'a', referenceContentVersion: 'b',
      provenance: { contentVersion: 'a', sources: [] } }).evidence!
    const wrapper = mount(AedarEquipmentQuantileFigureCahier, { props: { fact, comparison,
      comparisonLabel: comparison.label, horizonMinutes: 5, selectedModes: ['walk'], evidence } })
    const figure = wrapper.findComponent(CahierGroupedVerticalBarChart).props('figure')
    expect(figure.series[0]!.values[1]).toBe(1)
    expect(figure.series[1]!.values[1]).toBe(2.2)
    expect(figure.series[1]!.values[0]).toBeNull()
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('Moyenne de la sélection')
    expect(wrapper.text()).not.toContain('Moyenne de la sélection')
    expect(wrapper.text()).toContain('À droite de chaque paire de barres : Groupe comparé')
    expect(wrapper.find('.aedar-equipment-comparison-rank').exists()).toBe(false)
    wrapper.unmount()
  })
})
