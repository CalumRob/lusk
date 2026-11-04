import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AedarEquipmentQuantileFigureCahier from '@/fiche/prototype/AedarEquipmentQuantileFigureCahier.vue'
import CahierGroupedVerticalBarChart from '@/fiche/prototype/CahierGroupedVerticalBarChart.vue'
import { aedarEquipmentExplorerSection } from '@/fiche/content/aedarAccessSection'

describe('Quantiles AEDAR du Bac à sable', () => {
  it('apparie les quantiles focaux avec les moyennes par cellule API, jamais avec des rangs', () => {
    const fact = { territory_type: 'commune' as const, territory_id: 'sel-c1', typequ: 'A104', typequ_label: 'Équipement',
      identity: {}, n_addresses: 10, n_observed: 8, coverage_status: 'covered' as const, measures: { count_5_walk_mean: 5, count_5_walk_decile1: 1 },
      source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test', licence: 'ODbL', attribution: 'AEDAR',
      reference_date: null, publication_date: null }
    const comparison = { label: 'Moyenne de la sélection', contentVersion: 'a', referenceContentVersion: 'b', cells: [
      { ...fact, measure: 'count_5_walk_mean', statistic: 'pooled' as const, group_coverage_status: 'covered',
        group_n_addresses: 50, group_n_observed: 42, group_value: 7.4, rank: 3, rank_size: 3, rank_ties: 1, direction: 'high' as const },
      { ...fact, measure: 'count_5_walk_decile1', statistic: 'pooled' as const, group_coverage_status: 'covered',
        group_n_addresses: 50, group_n_observed: 42, group_value: 2.2, rank: null, rank_size: null, rank_ties: null, direction: 'high' as const },
    ] }
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
    wrapper.unmount()
  })
})
