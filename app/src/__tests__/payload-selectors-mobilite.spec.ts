import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import {
  estampilleSnapshot,
  formaterValeur,
  histoiresMobilitePourTerritoire,
  indicateursGroupeesPourTerritoire,
  indicateursPourTerritoire,
  nuageMobilite,
} from '../payload/selectors'
import type { HistoireMobilite, Payload } from '../payload/types'

/**
 * The Mobilité block selectors — pure, French product strings out of the
 * payload (issue #142, ADR-0012). Fixtures extracted from the REAL committed
 * payload: la commune 22001 (le défaut non-saillant), la commune 22002 (les
 * lignes réelles de la commune saillante 22055 — le vélo remplace le défaut),
 * l'EPCI, le département 22 et la région 53. The block's seam: the component
 * consumes these, never raw JSON.
 */

const payloadMobilite: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
}

describe('indicateursPourTerritoire — the Mobilité block in contract order', () => {
  it('returns the 11 keys in the block order (Taille → grille → demande/réseaux → sous-bloc)', () => {
    const groupes = indicateursGroupeesPourTerritoire(payloadMobilite, 'mobilite', '22001')

    expect(groupes.map((g) => g.key)).toEqual([
      'nb_buildings',
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
      'voitures_menage',
      'reseaux',
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
    ])
  })

  it('keeps the same contract order at every level (EPCI, département, région)', () => {
    for (const territoire of ['200000001', '22', '53']) {
      const cles = indicateursGroupeesPourTerritoire(
        payloadMobilite,
        'mobilite',
        territoire,
      ).map((g) => g.key)
      expect(cles[0]).toBe('nb_buildings')
      expect(cles.slice(1, 6)).toEqual([
        'iso_alimentation',
        'iso_sante',
        'iso_administration',
        'iso_ecole',
        'iso_banque',
      ])
      expect(cles.slice(6, 8)).toEqual(['voitures_menage', 'reseaux'])
      expect(cles.slice(8)).toEqual([
        'offre_tc',
        'bornes_recharge',
        'places_stationnement_velo_1000',
      ])
    }
  })

  it('never leaks another territory or theme into the block', () => {
    const lignes = indicateursPourTerritoire(payloadMobilite, 'mobilite', '22001')

    expect(lignes.every((l) => l.territoire === '22001' && l.theme === 'mobilite')).toBe(true)
  })

  it('carries the real payload values — the 5 parts d’isolation en % de bâtiments sans accès', () => {
    const lignes = indicateursPourTerritoire(payloadMobilite, 'mobilite', '22001')

    expect(lignes[0]).toMatchObject({ value: 168, unit: 'bâtiments' })
    const grille = lignes.slice(1, 6)
    expect(grille.map((l) => formaterValeur(l))).toEqual(['100', '100', '64', '100', '100'])
  })

  it('keeps the multi-detail keys as one key (voitures_menage ×2, reseaux ×6)', () => {
    const groupes = indicateursGroupeesPourTerritoire(payloadMobilite, 'mobilite', '22001')

    const voitures = groupes.find((g) => g.key === 'voitures_menage')
    expect(voitures?.lignes.map((l) => l.detail)).toEqual(['deux_plus', 'sans_voiture'])
    const reseaux = groupes.find((g) => g.key === 'reseaux')
    expect(reseaux?.lignes.map((l) => l.detail)).toEqual([
      'b_densite',
      'b_longueur',
      'c_densite',
      'c_longueur',
      't_densite',
      't_longueur',
    ])
  })
})

describe('histoiresMobilitePourTerritoire — le défaut et la saillance vélo', () => {
  it('returns the default story row for a non-saillant commune, with its real matter', () => {
    const lignes = histoiresMobilitePourTerritoire(payloadMobilite, '22001')

    expect(lignes).not.toBeNull()
    expect(lignes).toHaveLength(1)
    const defaut = lignes?.[0] as HistoireMobilite
    expect(defaut).toMatchObject({
      story_key: 'vingt-minutes-sans-voiture',
      div_loss_t: 38,
      div_loss_b: 38,
      delta: 0,
      classification_saillance: 'non-saillant',
    })
  })

  it('gives a saillant territory BOTH rows — le vélo remplace le défaut (ADR-0002)', () => {
    const lignes = histoiresMobilitePourTerritoire(payloadMobilite, '22002')

    expect(lignes).not.toBeNull()
    expect(lignes?.map((l) => l.story_key)).toEqual([
      'vingt-minutes-sans-voiture',
      'ce-que-le-velo-preserve',
    ])
  })

  it('returns null for a territory without a Mobilité Story (never invents a reading)', () => {
    expect(histoiresMobilitePourTerritoire(payloadMobilite, '29002')).toBeNull()
    expect(histoiresMobilitePourTerritoire(payloadMobilite, '99999')).toBeNull()
  })
})

describe('nuageMobilite — le nuage même-échelle des pairs (ADR-0011)', () => {
  it('gives a commune its EPCI’s communes (self included, comme la Démographie)', () => {
    const nuage = nuageMobilite(payloadMobilite, '22001')

    expect(nuage?.map((p) => p.territoire).sort()).toEqual(['22001', '22002'])
    expect(nuage?.find((p) => p.territoire === '22002')).toMatchObject({
      nom: 'Commune D',
      divLoss: 24,
    })
  })

  it('gives the région all its communes (same scale, ADR-0011)', () => {
    const nuage = nuageMobilite(payloadMobilite, '53')

    // seules les communes avec une ligne défaut du fixture apparaissent
    expect(nuage?.map((p) => p.territoire).sort()).toEqual(['22001', '22002'])
  })

  it('returns null for an unknown territory', () => {
    expect(nuageMobilite(payloadMobilite, '99999')).toBeNull()
  })
})

describe('estampilleSnapshot — le flagship est un snapshot, et le dit (ADR-0012)', () => {
  it('formats the stamp from the shared vintages table (mobilite_snapshot)', () => {
    expect(estampilleSnapshot(payloadMobilite)).toBe(
      'Analyse calculée le 6 août 2026 — se rafraîchit sur un rythme lent',
    )
  })

  it('never uses the weekly-refresh language', () => {
    expect(estampilleSnapshot(payloadMobilite)).not.toContain('semaine')
    expect(estampilleSnapshot(payloadMobilite)).not.toContain('actualis')
  })

  it('falls back to a Story row’s own stamp when the vintages table is absent', () => {
    const payload = { ...payloadMobilite, vintages: null }

    expect(estampilleSnapshot(payload)).toBe(
      'Analyse calculée le 6 août 2026 — se rafraîchit sur un rythme lent',
    )
  })

  it('returns null only when the payload carries no Mobilité at all', () => {
    const payload = { ...payloadMobilite, histoires: [], vintages: null }

    expect(estampilleSnapshot(payload)).toBeNull()
  })
})
