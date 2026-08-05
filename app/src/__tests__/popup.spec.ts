import { describe, expect, it } from 'vitest'

import { formaterValeurApercu, kpisPourPopup } from '../carte/popup'
import {
  apercuAvecNAFixture,
  apercuFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * The popup's KPI rows (ui-elements.md §Map shell): name + 2–3 KPIs joined by
 * territoire code. A KPI the payload cannot compute is skipped — never a
 * made-up number. Pure logic; the popup builder renders what this returns.
 */

function payloadAvecApercu(apercu = apercuFixture): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires: histoiresDemographieFixture,
    apercu,
    runReport: null,
    vintages: vintagesFixture,
  }
}

describe('formaterValeurApercu — French display of an Aperçu row', () => {
  it('formats a % unit as a whole number (fraction × 100)', () => {
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'part_65_plus', value: 0.15, unit: '%' })).toBe('15')
  })

  it('formats a raw value with thin-space thousands and a comma decimal', () => {
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'population', value: 2000, unit: 'hab.' })).toBe('2 000')
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'densite', value: 133.333, unit: 'hab/km²' })).toBe('133,33')
  })

  it('returns null for a null value (non calculable)', () => {
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'population', value: null, unit: 'hab.' })).toBeNull()
  })
})

describe('kpisPourPopup — the 2–3 KPI rows of a popup', () => {
  it('leads with the selected theme indicator, then the Aperçu basics, capped at 3', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie')

    expect(kpis).toHaveLength(3)
    expect(kpis[0]).toEqual({
      libelle: 'Densité de population',
      valeur: '200',
      unite: 'hab/km²',
    })
    expect(kpis[1].libelle).toBe('Population')
    expect(kpis[2].libelle).toBe('Part des 65 ans et plus')
  })

  it('never duplicates the density (theme twin of the Aperçu densité)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie')

    const densites = kpis.filter((k) => k.libelle.includes('Densité'))
    expect(densites).toHaveLength(1)
  })

  it('without a theme, shows the Aperçu basics (population, densité, part 65+)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '29001', null)

    expect(kpis.map((k) => k.libelle)).toEqual(['Population', 'Densité', 'Part des 65 ans et plus'])
  })

  it('skips an NA Aperçu row (value null = non calculable)', () => {
    const payload = payloadAvecApercu(apercuAvecNAFixture)
    const kpis = kpisPourPopup(payload, '22002', null)

    expect(kpis.map((k) => k.libelle)).toEqual(['Population', 'Densité'])
    expect(kpis).toHaveLength(2)
  })

  it('a territory with no payload rows gets an honest short popup', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '99999', 'demographie')

    expect(kpis).toHaveLength(0)
  })
})
