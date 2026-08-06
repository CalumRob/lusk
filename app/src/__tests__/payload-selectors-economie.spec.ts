import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresEconomieFixture,
  indicateursEconomieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import {
  formaterValeur,
  formaterVintage,
  histoiresEconomiePourTerritoire,
  indicateursGroupeesPourTerritoire,
  indicateursPourTerritoire,
} from '../payload/selectors'
import type { HistoireEconomie, Payload } from '../payload/types'

/**
 * The Économie block selectors — pure, French product strings out of the
 * payload (issue #120, forme reshapée). Fixtures extracted from the REAL
 * committed payload: one commune (22001), one EPCI, the département 22 and the
 * région 53. The block's seam: the component consumes these, never raw JSON.
 */

const payloadEconomie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursEconomieFixture,
  histoires: histoiresEconomieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
}

describe('indicateursPourTerritoire — the Économie block in contract order', () => {
  it('returns the 3 indicators, one line each, in the contract order effectifs → chomage → éco-activités', () => {
    const lignes = indicateursPourTerritoire(payloadEconomie, 'economie', '22001')

    expect(lignes.map((l) => l.key)).toEqual([
      'effectifs_salaries',
      'chomage',
      'eco_activites',
    ])
    expect(lignes.every((l) => l.detail === null)).toBe(true)
  })

  it('keeps the same contract order at every level (EPCI, département, région)', () => {
    for (const territoire of ['200000001', '22', '53']) {
      const cles = indicateursPourTerritoire(payloadEconomie, 'economie', territoire).map(
        (l) => l.key,
      )
      expect(cles).toEqual(['effectifs_salaries', 'chomage', 'eco_activites'])
    }
  })

  it('never leaks another territory or theme into the block', () => {
    const lignes = indicateursPourTerritoire(payloadEconomie, 'economie', '22001')

    expect(lignes.every((l) => l.territoire === '22001' && l.theme === 'economie')).toBe(true)
  })

  it('carries the real payload values (Taille 31 salariés, chômage 7,1 %, éco-activités 54,1 %)', () => {
    const lignes = indicateursPourTerritoire(payloadEconomie, 'economie', '22001')

    expect(lignes[0]).toMatchObject({ value: 31, unit: 'salariés' })
    expect(formaterValeur(lignes[1])).toBe('7')
    expect(formaterValeur(lignes[2])).toBe('54')
  })
})

describe('indicateursGroupeesPourTerritoire — one figure per indicator key', () => {
  it('groups the 3 one-line indicators into 3 figures, contract order', () => {
    const groupes = indicateursGroupeesPourTerritoire(payloadEconomie, 'economie', '22001')

    expect(groupes.map((g) => g.key)).toEqual([
      'effectifs_salaries',
      'chomage',
      'eco_activites',
    ])
    expect(groupes.every((g) => g.lignes.length === 1)).toBe(true)
  })
})

describe('histoiresEconomiePourTerritoire — the multi-line Story, grouped and sorted', () => {
  it('returns the commune’s top-5 specialisations sorted by rang, labels from the payload', () => {
    const lignes = histoiresEconomiePourTerritoire(payloadEconomie, '22001')

    expect(lignes).not.toBeNull()
    expect(lignes?.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5])
    expect(lignes?.map((l) => l.activity_code)).toEqual([
      '01.47Z',
      '46.23Z',
      '36.00Z',
      '77.29Z',
      '78.30Z',
    ])
    // le label d'activité vient du payload — jamais codé en dur dans l'app
    expect(lignes?.[0]).toMatchObject({
      story_key: 'ce-que-la-commune-abrite',
      activity_label: 'Élevage de volailles',
      lq: 23.6794426899885,
      n: 12,
    })
  })

  it('returns the EPCI’s and the département’s top-5 as well', () => {
    expect(histoiresEconomiePourTerritoire(payloadEconomie, '200000001')?.map((l) => l.activity_code))
      .toEqual(['08.93Z', '15.11Z', '11.02B', '50.30Z', '25.92Z'])
    expect(histoiresEconomiePourTerritoire(payloadEconomie, '22')?.[0]).toMatchObject({
      story_key: 'ce-que-la-commune-abrite',
      activity_code: '01.22Z',
      lq: 5.51753307681677,
    })
  })

  it('gives the région its presence Story (ce-que-la-bretagne-abrite), lq dégénérée', () => {
    const lignes = histoiresEconomiePourTerritoire(payloadEconomie, '53')

    expect(lignes?.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5])
    expect(lignes?.every((l) => l.story_key === 'ce-que-la-bretagne-abrite')).toBe(true)
    expect(lignes?.every((l) => l.lq === null)).toBe(true)
    expect(lignes?.[0]).toMatchObject({
      activity_label: "Location de terrains et d'autres biens immobiliers",
      n: 124881,
      part_parc: 0.16462751477456836,
    })
  })

  it('is deterministic — two calls return the same order', () => {
    const une = histoiresEconomiePourTerritoire(payloadEconomie, '22001')
    const deux = histoiresEconomiePourTerritoire(payloadEconomie, '22001')

    expect(une?.map((l) => l.activity_code)).toEqual(deux?.map((l) => l.activity_code))
  })

  it('returns null for a territory without an Économie Story (never invents a reading)', () => {
    expect(histoiresEconomiePourTerritoire(payloadEconomie, '29002')).toBeNull()
    expect(histoiresEconomiePourTerritoire(payloadEconomie, '99999')).toBeNull()
  })

  it('exposes the Story’s vintage — the same stamp pattern as the indicators (issue #74)', () => {
    const histoire = histoiresEconomiePourTerritoire(payloadEconomie, '22001')?.[0] as HistoireEconomie

    expect(formaterVintage(histoire)).toBe(
      'data.bretagne.bzh — Base SIRENE - Région Bretagne (sirene-v3-consolidee) · 2026-04 · réf. 31 mars 2026 · publ. 1 mai 2026',
    )
  })
})
