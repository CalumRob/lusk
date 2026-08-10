import { describe, expect, it } from 'vitest'

import { contenuTooltip, formaterValeurApercu, kpisPourPopup } from '../carte/popup'
import type { Couche } from '../carte/coucheModel'
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
 * The rows resolve from the ACTIVE layer (ADR-0019 — the couche the view
 * passed down), never a carte-side config.
 */

/** The Démographie densité layer — the previous config's equivalent, as a Couche. */
const coucheDensite: Couche = {
  source: 'indicateur',
  clef: 'densite',
  detail: null,
  libelle: 'Densité de population',
  parDefaut: false,
}

/** The Démographie default layer — the first story scalar (ADR-0019 α rule). */
const coucheTauxSoldeNaturel: Couche = {
  source: 'histoire',
  clef: 'taux_solde_naturel',
  detail: null,
  libelle: 'taux_solde_naturel',
  parDefaut: true,
}

/** The multi-detail layer of a grouped key (ADR-0019). */
const coucheTrancheMoin15: Couche = {
  source: 'indicateur',
  clef: 'structure_age',
  detail: '<15',
  libelle: 'Moins de 15 ans',
  parDefaut: false,
}

function payloadAvecApercu(apercu = apercuFixture): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires: histoiresDemographieFixture,
    apercu,
    runReport: null,
    vintages: vintagesFixture,
    programmes: null,
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
  it('leads with the active layer, then the Aperçu basics, capped at 3', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie', coucheDensite)

    expect(kpis).toHaveLength(3)
    expect(kpis[0]).toEqual({
      libelle: 'Densité de population',
      valeur: '200',
      unite: 'hab/km²',
    })
    expect(kpis[1].libelle).toBe('Population')
    expect(kpis[2].libelle).toBe('Part des 65 ans et plus')
  })

  it('leads with a story-scalar layer (source histoire) — its value, no unit invented', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie', coucheTauxSoldeNaturel)

    expect(kpis).toHaveLength(3)
    expect(kpis[0]).toEqual({
      libelle: 'taux_solde_naturel',
      valeur: '5,98',
      unite: '',
    })
    expect(kpis[1].libelle).toBe('Population')
    expect(kpis[2].libelle).toBe('Densité')
  })

  it('reads a grouped detail layer by clef + detail (ADR-0019)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie', coucheTrancheMoin15)

    expect(kpis[0]).toEqual({ libelle: 'Moins de 15 ans', valeur: '30', unite: '%' })
  })

  it('never duplicates the density (theme twin of the Aperçu densité)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie', coucheDensite)

    const densites = kpis.filter((k) => k.libelle.includes('Densité'))
    expect(densites).toHaveLength(1)
  })

  it('without a layer, shows the Aperçu basics (population, densité, part 65+)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '29001', null, null)

    expect(kpis.map((k) => k.libelle)).toEqual(['Population', 'Densité', 'Part des 65 ans et plus'])
  })

  it('skips an NA Aperçu row (value null = non calculable)', () => {
    const payload = payloadAvecApercu(apercuAvecNAFixture)
    const kpis = kpisPourPopup(payload, '22002', null, null)

    expect(kpis.map((k) => k.libelle)).toEqual(['Population', 'Densité'])
    expect(kpis).toHaveLength(2)
  })

  it('a territory with no payload rows gets an honest short popup', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '99999', 'demographie', coucheDensite)

    expect(kpis).toHaveLength(0)
  })
})

describe('contenuTooltip — the hover tooltip (audit #208 item 57)', () => {
  it('names the territory and shows the active layer value', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '22001', 'demographie', coucheDensite)).toEqual({
      nom: 'Commune A1',
      valeur: '200',
    })
  })

  it('shows a story scalar for a story layer (source histoire)', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '22001', 'demographie', coucheTauxSoldeNaturel)).toEqual({
      nom: 'Commune A1',
      valeur: '5,98',
    })
  })

  it('shows the name only without a layer (no theme drives the map)', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '22001', null, null)).toEqual({ nom: 'Commune A1', valeur: null })
  })

  it('falls back to the territoire code when the payload has no name row', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '99999', 'demographie', coucheDensite)).toEqual({
      nom: '99999',
      valeur: null,
    })
  })
})
