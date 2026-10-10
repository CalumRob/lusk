import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import AedarEquipmentWaffleCahier from '@/fiche/prototype/AedarEquipmentWaffleCahier.vue'
import type { AedarFact } from '@/fiche/content/aedarApiClient'
import type { AedarEquipmentProfileEvidence } from '@/fiche/content/themeContent'

function evidence(): AedarEquipmentProfileEvidence {
  const [header, ...lines] = readFileSync(resolve(process.cwd(), '../pipeline/inst/extdata/aedar-typequ-2025.csv'), 'utf8').trim().split(/\r?\n/)
  if (header !== '"TYPEQU","LIB_TYPEQU"') throw new Error('Unexpected canonical TYPEQU registry header')
  const facts = lines.map((line) => {
    const match = line.match(/^"([^"]+)","((?:[^"]|"")*)"$/)
    if (!match) throw new Error(`Malformed TYPEQU registry line: ${line}`)
    const measures = Object.fromEntries([5, 10, 15, 20].flatMap((horizon) =>
      ['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'].map((mode) => [`count_${horizon}_${mode}_share`, mode === 'car' ? 0.3 : 0]),
    ))
    return {
      typequ: match[1]!, typequ_label: match[2]!.replaceAll('""', '"'), measures,
    } as unknown as AedarFact
  })
  const firstFiveShares: Readonly<Record<string, number>>[] = [
    { walk: 0.5 },
    { transit: 0.4 },
    { bike_lts2: 0.3 },
    { bike_lts4: 0.3 },
    { car: 0.3 },
    { walk: 0.35 },
    { walk: 0.4 },
  ] as const
  for (const [index, shares] of firstFiveShares.entries()) {
    const fact = facts[index]!
    for (const horizon of [5, 10, 15, 20]) {
      for (const mode of ['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'] as const) {
        fact.measures[`count_${horizon}_${mode}_share`] = shares[mode] ?? 0
      }
    }
  }
  // At 10 minutes the last of the first five types drops below the car cutoff.
  facts[4]!.measures['count_10_car_share'] = 0.1
  return {
    kind: 'aedar-equipment-profile', facts, threshold: 0.25, initialHorizonMinutes: 15,
    figureTitle: 'Types d’équipements accessibles par premier mode',
    prose: [[{ kind: 'text', value: 'Classement au seuil de 25 %.' }]],
    source: { label: 'AEDAR', version: '2026-v1', url: 'https://example.test/aedar', credit: '© OpenStreetMap contributors' },
  }
}

function secondSectionEvidence(): AedarEquipmentProfileEvidence {
  const original = evidence()
  const facts = original.facts.slice(0, 2).map((fact, index) => ({
    ...fact,
    typequ: `ALT${index + 1}`,
    typequ_label: ['Bibliothèque', 'Atelier partagé'][index]!,
  }))
  return {
    ...original,
    facts,
    threshold: 0.5,
    initialHorizonMinutes: 10,
    figureTitle: 'Services de proximité par premier mode',
    prose: [[{ kind: 'text', value: 'Deux services, un autre titre et une autre lecture.' }]],
  }
}

describe('AedarEquipmentWaffleCahier', () => {
  it('keeps the same figure grammar when content, facts, threshold and initial horizon change', async () => {
    const content = secondSectionEvidence()
    const wrapper = mount(AedarEquipmentWaffleCahier, {
      props: { evidence: content, title: 'Services de proximité' },
    })

    expect(wrapper.find('.cahier-figure-title').text()).toBe('Services de proximité par premier mode')
    expect(wrapper.findAll('.aedar-waffle-tile')).toHaveLength(2)
    expect(wrapper.find('.aedar-waffle-grid').attributes('aria-label')).toContain('2 types')
    expect(wrapper.get('.aedar-waffle-grid').classes()).toContain('aedar-waffle-grid--five-rows')
    expect(wrapper.get('.aedar-waffle-horizon button[aria-pressed="true"]').attributes('value')).toBe('10')

    await wrapper.get('.aedar-waffle-explore').trigger('click')
    const dialog = wrapper.get('dialog[open]')
    expect(dialog.get('#aedar-waffle-dialog-title').text()).toBe('Services de proximité')
    expect(dialog.findAll('.aedar-waffle-dialog-row')).toHaveLength(2)
    expect(dialog.get('.aedar-waffle-table-explanation').text()).toContain(new Intl.NumberFormat('fr-FR', {
      style: 'percent', maximumFractionDigits: 1,
    }).format(content.threshold))
  })

  it('renders a centered waffle with a centered, interactive legend', async () => {
    const wrapper = mount(AedarEquipmentWaffleCahier, { props: { evidence: evidence() } })

    expect(wrapper.findAll('.aedar-waffle-tile')).toHaveLength(235)
    expect(wrapper.find('.cahier-figure-title').text()).toBe('Types d’équipements accessibles par premier mode')
    expect(wrapper.find('.aedar-waffle-grid').attributes('aria-label')).toContain('235 types')
    expect(wrapper.find('.aedar-waffle').classes()).toContain('aedar-waffle--centered')
    expect(wrapper.find('.aedar-waffle-grid').classes()).toContain('aedar-waffle-grid--five-rows')
    expect(wrapper.findAll('.aedar-waffle-tile').every((tile) => tile.element.tagName === 'BUTTON')).toBe(true)
    expect(wrapper.find('.cahier-figure-legend').exists()).toBe(true)
    expect(wrapper.find('.cahier-figure-legend').classes()).toContain('aedar-waffle-legend--centered')
    expect(wrapper.find('.aedar-waffle-horizon-label').text()).toBe('Temps de trajet')
    expect(wrapper.find('.aedar-waffle-threshold').exists()).toBe(false)
    expect(wrapper.find('.aedar-waffle-horizon-link').exists()).toBe(true)
  })

  it('opens full exploration from the nearby control, then filters all-mode results by search', async () => {
    const wrapper = mount(AedarEquipmentWaffleCahier, { props: { evidence: evidence() } })

    await wrapper.get('.aedar-waffle-explore').trigger('click')

    const dialog = wrapper.get('dialog[open]')
    expect(dialog.attributes('aria-labelledby')).toBeTruthy()
    expect(dialog.get('#aedar-waffle-dialog-title').text()).toBe('Types d’équipements accessibles par premier mode')
    expect(dialog.find('.cahier-dialog__kicker').exists()).toBe(false)
    expect(dialog.find('.cahier-dialog__header h2').exists()).toBe(false)
    expect(dialog.find('.cahier-dialog__header .aedar-waffle-search').exists()).toBe(true)
    expect(dialog.find('.aedar-waffle-search span').text()).toBe('Rechercher un équipement')
    expect(dialog.text()).toContain('Les catégories d’équipements BPE sont classées')
    expect(dialog.text()).toContain('Tous les modes')
    expect(dialog.findAll('.aedar-waffle-dialog-row')).toHaveLength(235)
    expect(dialog.findAll('.aedar-waffle-dialog-row').every((row) => row.findAll('td.is-classifying-bucket').length === 1)).toBe(true)
    expect(dialog.get('.aedar-waffle-mode-filter button[data-mode="inaccessible"]').attributes('style')).toContain('text-tertiary')
    expect(dialog.find('.aedar-waffle-mode-filter').text()).toContain('À pied')
    expect(dialog.find('.aedar-waffle-mode-filter').text()).toContain('Vélo (LTS2)')
    expect(dialog.text()).toContain('50')
    expect(dialog.text()).toContain('Transports en commun')
    expect(dialog.text()).toContain('Vélo LTS2')
    expect(dialog.text()).toContain('Vélo LTS4')
    expect(dialog.text()).toContain('Voiture')
    expect(dialog.find('input[type="search"]').exists()).toBe(true)
    expect(dialog.find('input[type="search"]').attributes('aria-label')).toBe('Nom ou code BPE')

    await dialog.get('input[type="search"]').setValue('A129')
    expect(dialog.findAll('.aedar-waffle-dialog-row')).toHaveLength(1)
    expect(dialog.text()).toContain('A129')
    await dialog.get('input[type="search"]').setValue('aucun-resultat')
    expect(dialog.findAll('.aedar-waffle-dialog-row')).toHaveLength(0)
    expect(dialog.text()).toContain('Aucun type ne correspond')

    await dialog.get('input[type="search"]').setValue('')
    await dialog.get('.aedar-waffle-mode-filter button[data-mode="walk"]').trigger('click')
    expect(dialog.findAll('.aedar-waffle-dialog-row')).toHaveLength(3)
    await dialog.get('button[aria-label="Fermer la fenêtre"]').trigger('click')
  })

  it('uses labeled segmented horizons and updates both the profile and open-modal shares', async () => {
    const wrapper = mount(AedarEquipmentWaffleCahier, { props: { evidence: evidence() } })
    await wrapper.findAll('.cahier-figure-legend-action').find((button) => button.text().includes('Voiture'))!.trigger('click')

    const horizons = wrapper.findAll('.aedar-waffle-horizon button')
    expect(horizons.map((button) => button.attributes('value'))).toEqual(['5', '10', '15', '20'])
    expect(wrapper.find('.aedar-waffle-clock[aria-hidden="true"]').exists()).toBe(true)
    const carCount = Number(wrapper.findAll('.cahier-figure-legend-action')
      .find((button) => button.text().includes('Voiture'))!
      .find('.cahier-figure-legend-count').text())
    expect(wrapper.get('dialog[open]').findAll('.aedar-waffle-dialog-row')).toHaveLength(carCount)

    await horizons.find((button) => button.attributes('value') === '10')!.trigger('click')
    expect(wrapper.find('.aedar-waffle-grid').attributes('aria-label')).toContain('10 minutes')
    const updatedCarCount = Number(wrapper.findAll('.cahier-figure-legend-action')
      .find((button) => button.text().includes('Voiture'))!
      .find('.cahier-figure-legend-count').text())
    expect(wrapper.get('dialog[open]').findAll('.aedar-waffle-dialog-row')).toHaveLength(updatedCarCount)
    expect(wrapper.get('dialog[open]').text()).toContain(new Intl.NumberFormat('fr-FR', {
      style: 'percent', maximumFractionDigits: 1,
    }).format(0.1))
    expect(wrapper.find('.aedar-waffle-horizon button[aria-pressed="true"]').attributes('value')).toBe('10')
  })

  it('opens the same modal focused on the equipment type represented by a clicked waffle tile', async () => {
    const wrapper = mount(AedarEquipmentWaffleCahier, { props: { evidence: evidence() } })
    const tile = wrapper.get('.aedar-waffle-tile[data-typequ="A129"]')

    await tile.trigger('click')

    const dialog = wrapper.get('dialog[open]')
    expect(dialog.text()).toContain('À pied')
    const selectedMode = tile.attributes('data-bucket')
    if (!selectedMode) throw new Error('The clicked equipment tile must declare its access bucket')
    expect(dialog.find(`.aedar-waffle-mode-filter button[data-mode="${selectedMode}"]`).attributes('aria-pressed')).toBe('true')
    const selectedRow = dialog.get('.aedar-waffle-dialog-row[data-typequ="A129"]')
    expect(selectedRow.classes()).toContain('is-highlighted')
    const expectedModeColor = selectedMode === 'walk' || selectedMode === 'transit'
      ? '--cahier-mode-foot'
      : selectedMode.startsWith('bike') ? '--cahier-mode-bike' : '--cahier-mode-car'
    expect(selectedRow.attributes('style')).toContain(`--mode-color: var(${expectedModeColor})`)
    expect(selectedRow.get(`td[data-mode="${selectedMode}"]`).classes()).toContain('is-classifying-bucket')
    expect(dialog.get('.aedar-waffle-dialog-horizon button[aria-pressed="true"]').attributes('aria-pressed')).toBe('true')
    const selectedBucketCount = Number(dialog.get(`.aedar-waffle-mode-filter [data-mode="${selectedMode}"] .aedar-waffle-mode-count`).text())
    expect(dialog.findAll('.aedar-waffle-dialog-row')).toHaveLength(selectedBucketCount)
    expect(dialog.text()).toContain('MAIRIE')
  })
})
