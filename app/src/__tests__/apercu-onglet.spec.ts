import { mount } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import ApercuOnglet from '../components/fiche/ApercuOnglet.vue'
import { LIEN_SUBVENTIONS } from '../fiche/apercu'
import type { Programme } from '../fiche/apercu'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * ApercuOnglet — the Aperçu tab (ADR-0007, layouts.md §2): the territory's
 * basic stats rendered through apercuPourTerritoire (NA values skipped by the
 * selector, never a phantom figure) and the Programmes & financements element.
 * Runs on the general brand ramp — the figures wear the brand class, never a
 * theme ramp. The programmes payload seam does not exist yet: the section
 * shows its real presentation with an honest empty state when the array is
 * empty (never « under construction »).
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

const programmesFixture: Programme[] = [
  { sigle: 'ACV', nom: 'Action Cœur de Ville' },
  { sigle: 'PVD', nom: 'Petites Villes de Demain' },
]

function monter(
  territoire: string,
  programmes: Programme[] = [],
): ReturnType<typeof mount> {
  return mount(ApercuOnglet, {
    props: { payload: payloadDemographie, territoire, programmes },
  })
}

describe('ApercuOnglet — les statistiques de base', () => {
  it('renders the KPI figures for the territory, in payload order, via the selector', () => {
    const wrapper = monter('22001')

    const valeurs = wrapper.findAll('.kpi-valeur').map((v) => v.text())
    expect(valeurs).toEqual(['2\u202F000 hab.', '200 hab/km²', '15 %'])

    const libelles = wrapper.findAll('.kpi-libelle').map((v) => v.text())
    expect(libelles).toEqual([
      'Population',
      'Densité de population',
      'Part des 65 ans et plus',
    ])
  })

  it('skips NA values — a KPI not computable for the territory never renders', () => {
    // 22002's part_65_plus is null in the fixture (apercuAvecNAFixture)
    const wrapper = monter('22002')

    expect(wrapper.findAll('.kpi-valeur').map((v) => v.text())).toEqual([
      '400 hab.',
      '50 hab/km²',
    ])
    expect(wrapper.text()).not.toContain('Part des 65 ans et plus')
  })

  it('wears the brand ramp class on its figures — the general theme, never a theme ramp', () => {
    const wrapper = monter('22001')

    const figures = wrapper.findAll('.kpi')
    expect(figures.length).toBeGreaterThan(0)
    for (const figure of figures) {
      expect(figure.classes()).toContain('kpi--marque')
    }
  })
})

describe("ApercuOnglet — l'élément Programmes & financements", () => {
  it('shows the honest empty state when no programme is referenced (the seam has no data yet)', () => {
    const wrapper = monter('22001')

    expect(wrapper.find('.apercu-programmes').text()).toContain('Programmes & financements')
    expect(wrapper.find('.apercu-programmes').text()).toContain('Aucun programme référencé.')
    expect(wrapper.findAll('.puce-programme')).toHaveLength(0)
    // jamais un « under construction » (principles.md §1)
    expect(wrapper.text()).not.toContain('À venir')
  })

  it('keeps the Région subventions link in the empty state — the actionable half', () => {
    const wrapper = monter('22001')

    const lien = wrapper.find('.programmes-lien')
    expect(lien.exists()).toBe(true)
    expect(lien.attributes('href')).toBe(LIEN_SUBVENTIONS.href)
    expect(lien.attributes('target')).toBe('_blank')
    expect(lien.attributes('rel')).toContain('noopener')
    expect(lien.text()).toContain('Subventions de la Région Bretagne')
  })

  it('renders programme membership as badge chips when the array is populated', () => {
    const wrapper = monter('22001', programmesFixture)

    const puces = wrapper.findAll('.puce-programme').map((p) => p.text())
    expect(puces).toEqual(['ACV', 'PVD'])
    expect(wrapper.find('.apercu-programmes').text()).not.toContain('Aucun programme référencé.')
  })

  it('gives each badge an accessible expansion — sigle + nom, never a bare acronym', () => {
    const wrapper = monter('22001', programmesFixture)

    const premierBadge = wrapper.findAll('.puce-programme')[0]
    expect(premierBadge.attributes('aria-label')).toBe('ACV — Action Cœur de Ville')
  })
})

describe("ApercuOnglet — l'état vide (territoire sans statistiques)", () => {
  it('shows an honest empty state when the territory has no apercu rows, and keeps the programmes section', () => {
    const wrapper = monter('99999', programmesFixture)

    expect(wrapper.find('.apercu-stats').exists()).toBe(false)
    expect(wrapper.text()).toContain('Aucune donnée disponible pour ce territoire.')
    expect(wrapper.findAll('.puce-programme').map((p) => p.text())).toEqual(['ACV', 'PVD'])
  })
})
