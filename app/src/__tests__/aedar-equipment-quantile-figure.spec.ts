import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { AedarFact } from '@/fiche/content/aedarApiClient'
import { AEDAR_EQUIPMENT_QUANTILE_STATISTICS } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'
import AedarEquipmentQuantileFigureCahier from '@/fiche/prototype/AedarEquipmentQuantileFigureCahier.vue'

function fact(): AedarFact {
  const measures: Record<string, number | null> = {}
  for (const mode of ['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car']) {
    measures[`count_15_${mode}_min`] = 0
    for (let decile = 1; decile <= 9; decile += 1) measures[`count_15_${mode}_decile${decile}`] = decile
    measures[`count_15_${mode}_max`] = 10
  }
  return {
    territory_id: '22001',
    territory_type: 'commune',
    typequ: 'B207',
    typequ_label: 'BOULANGERIE-PÂTISSERIE',
    identity: {},
    n_addresses: 100,
    n_observed: 100,
    coverage_status: 'complete',
    measures,
    source_id: 'aedar_bretagne',
    vintage_id: '2026-v1',
    source_url: 'https://example.test/aedar',
    licence: 'ODbL',
    attribution: 'AEDAR',
    reference_date: null,
    publication_date: null,
  }
}

function explorerEvidence(overrides: Partial<AedarEquipmentExplorerEvidence> = {}): AedarEquipmentExplorerEvidence {
  return {
    kind: 'aedar-equipment-explorer',
    contentVersion: 'test-content-v1',
    referenceContentVersion: 'test-reference-v1',
    facts: [],
    initialTypequ: 'B207',
    initialHorizonMinutes: 15,
    introduction: [],
    volumeFigureTitle: 'Établissements accessibles',
    volumeYAxisTitle: 'Volume de l’offre',
    distributionFigureTitle: 'Distribution des établissements accessibles par décile',
    distributionStatistics: AEDAR_EQUIPMENT_QUANTILE_STATISTICS,
    distributionAxisTitle: 'Décile',
    distributionYAxisTitle: 'Nombre d’établissements',
    distributionDescription: 'Les barres montrent les valeurs des seuils publiés.',
    distributionUnavailableDescription: 'Distribution indisponible.',
    source: null,
    ...overrides,
  }
}

describe('AEDAR equipment decile distribution figure', () => {
  it('uses statistic categories and explanatory copy from its semantic evidence', () => {
    const evidence = explorerEvidence({
      distributionStatistics: [
        { key: 'min', label: 'Borne basse', axisLabel: 'Bas' },
        { key: 'decile2', label: 'Décile 2 contractuel', axisLabel: 'D2' },
        { key: 'max', label: 'Borne haute', axisLabel: 'Haut' },
      ],
      distributionAxisTitle: 'Seuil publié',
      distributionDescription: 'Description issue du contrat sémantique.',
      distributionUnavailableDescription: 'Indisponibilité issue du contrat sémantique.',
    })
    const wrapper = mount(AedarEquipmentQuantileFigureCahier, {
      props: {
        fact: fact(),
        horizonMinutes: 15,
        selectedModes: ['car'],
        evidence,
      },
    })

    const plot = wrapper.get('.cahier-grouped-vertical-bar-chart__plot')
    const categories = plot.findAll('button.cahier-grouped-vertical-bar-chart__category-hitbox')
    expect(categories).toHaveLength(3)
    expect(plot.get('svg[role="img"]').attributes('aria-label')).toContain('Description issue du contrat sémantique.')
    expect(plot.get('svg[role="img"]').attributes('aria-label')).not.toContain('neuf déciles')
    expect(plot.get('svg[role="img"]').attributes('aria-label')).toContain('Axe horizontal : Seuil publié')
    expect(categories[0]?.attributes('aria-label')).toContain('Borne basse')
    expect(categories[1]?.attributes('aria-label')).toContain('Décile 2 contractuel')
    expect(categories[2]?.attributes('aria-label')).toContain('Borne haute')
  })

  it('groups the published minimum, decile, and maximum cutpoints by selected mode', async () => {
    const wrapper = mount(AedarEquipmentQuantileFigureCahier, {
      props: { fact: fact(), horizonMinutes: 15, selectedModes: ['car'], evidence: explorerEvidence() },
    })

    const plot = wrapper.get('.cahier-grouped-vertical-bar-chart__plot')
    const chart = plot.get('svg[role="img"]')
    expect(chart.attributes('aria-label')).toContain('BOULANGERIE-PÂTISSERIE (B207)')
    expect(chart.attributes('aria-label')).toContain('Les barres montrent les valeurs des seuils publiés.')
    expect(plot.findAll('rect.cahier-grouped-vertical-bar-chart__bar')).toHaveLength(11)

    const categories = plot.findAll('button.cahier-grouped-vertical-bar-chart__category-hitbox')
    expect(categories).toHaveLength(11)
    expect(categories[0]?.attributes('aria-label')).toContain('Minimum : Voiture : 0 établissement')
    expect(categories[1]?.attributes('aria-label')).toContain('Décile 1 : Voiture : 1 établissement')
    expect(categories[9]?.attributes('aria-label')).toContain('Décile 9 : Voiture : 9 établissements')
    expect(categories[10]?.attributes('aria-label')).toContain('Maximum : Voiture : 10 établissements')

    await categories[1]!.trigger('focus')
    expect(wrapper.get('.cahier-grouped-vertical-bar-chart__tooltip').text()).toContain('1 établissement')
  })

  it('keeps repeated cutpoints as equal-height bars and groups one bar per selected mode', () => {
    const equipment = fact()
    equipment.measures.count_15_car_decile1 = 0
    equipment.measures.count_15_car_decile2 = 0
    const wrapper = mount(AedarEquipmentQuantileFigureCahier, {
      props: { fact: equipment, horizonMinutes: 15, selectedModes: ['car', 'transit'], evidence: explorerEvidence() },
    })

    expect(wrapper.findAll('rect.cahier-grouped-vertical-bar-chart__bar')).toHaveLength(22)
    const firstDecile = wrapper.get('button[aria-label^="Décile 1"]')
    expect(firstDecile.attributes('aria-label')).toContain('Voiture : 0 établissement')
    expect(firstDecile.attributes('aria-label')).toContain('Transports en commun : 1 établissement')
    expect(wrapper.get('button[aria-label^="Décile 2"]').attributes('aria-label')).toContain('Voiture : 0 établissement')
  })
})
