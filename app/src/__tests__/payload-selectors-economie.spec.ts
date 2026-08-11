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
  histoireEconomiePourTerritoire,
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
  programmes: null,
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

describe('histoireEconomiePourTerritoire — the resolved reading, top-5 replié', () => {
  it('returns the commune’s specialisation reading, the top-5 in its folded params', () => {
    const histoire = histoireEconomiePourTerritoire(payloadEconomie, '22001')

    expect(histoire).not.toBeNull()
    expect(histoire?.groupe).toBe('sante-et-taille')
    expect(histoire?.salience_reason).toBe('defaut')
    expect(histoire?.story_key).toBe('ce-que-la-commune-abrite')
    // le top-5 replié : le rang est l'index (top1_*..top5_*)
    expect(histoire?.top1_activity_code).toBe('01.47Z')
    expect(histoire?.top2_activity_code).toBe('46.23Z')
    expect(histoire?.top3_activity_code).toBe('36.00Z')
    expect(histoire?.top4_activity_code).toBe('77.29Z')
    expect(histoire?.top5_activity_code).toBe('78.30Z')
    // le label d'activité vient du payload — jamais codé en dur dans l'app
    expect(histoire).toMatchObject({
      story_key: 'ce-que-la-commune-abrite',
      top1_activity_label: 'Élevage de volailles',
      top1_lq: 23.6794426899885,
      top1_n: 12,
    })
  })

  it('returns the EPCI’s and the département’s reading as well', () => {
    expect(histoireEconomiePourTerritoire(payloadEconomie, '200000001')?.top1_activity_code).toBe(
      '08.93Z',
    )
    expect(histoireEconomiePourTerritoire(payloadEconomie, '200000001')?.top5_activity_code).toBe(
      '25.92Z',
    )
    expect(histoireEconomiePourTerritoire(payloadEconomie, '22')).toMatchObject({
      story_key: 'ce-que-la-commune-abrite',
      top1_activity_code: '01.22Z',
      top1_lq: 5.51753307681677,
    })
  })

  it('gives the région its presence Story (ce-que-la-bretagne-abrite), lq dégénérée', () => {
    const histoire = histoireEconomiePourTerritoire(payloadEconomie, '53')

    expect(histoire).not.toBeNull()
    expect(histoire?.groupe).toBe('structure-verte')
    expect(histoire?.story_key).toBe('ce-que-la-bretagne-abrite')
    expect(histoire?.top1_lq).toBeNull()
    expect(histoire?.top2_lq).toBeNull()
    expect(histoire).toMatchObject({
      top1_activity_label: "Location de terrains et d'autres biens immobiliers",
      top1_n: 124881,
      top1_part_parc: 0.16462751477456836,
    })
  })

  it('is deterministic — two calls return the same row', () => {
    const une = histoireEconomiePourTerritoire(payloadEconomie, '22001')
    const deux = histoireEconomiePourTerritoire(payloadEconomie, '22001')

    expect(une?.top1_activity_code).toBe(deux?.top1_activity_code)
  })

  it('returns null for a territory without an Économie Story (never invents a reading)', () => {
    expect(histoireEconomiePourTerritoire(payloadEconomie, '29002')).toBeNull()
    expect(histoireEconomiePourTerritoire(payloadEconomie, '99999')).toBeNull()
  })

  it('exposes the Story’s vintage — the same stamp pattern as the indicators (issue #74)', () => {
    const histoire = histoireEconomiePourTerritoire(payloadEconomie, '22001') as HistoireEconomie

    expect(formaterVintage(histoire)).toBe(
      'data.bretagne.bzh — Base SIRENE - Région Bretagne (sirene-v3-consolidee) · 2026-04 · réf. 31 mars 2026 · publ. 1 mai 2026',
    )
  })
})
