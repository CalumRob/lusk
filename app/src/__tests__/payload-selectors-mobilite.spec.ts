import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import {
  estampilleSnapshot,
  formaterValeur,
  histoireMobilitePourTerritoire,
  indicateursGroupeesPourTerritoire,
  indicateursPourTerritoire,
  nuageMobilite,
  ratioOffreCyclable,
} from '../payload/selectors'
import type { Payload } from '../payload/types'

/**
 * The Mobilité block selectors — pure, French product strings out of the
 * payload (issue #142, ADR-0012). Fixtures extracted from the REAL committed
 * payload: la commune 22001 (le défaut non-saillant), la commune 22002 (les
 * lignes réelles de la commune saillante 22055 — le vélo remplace le défaut),
 * l'EPCI, le département 22 et la région 53. The block's seam: the component
 * consumes these, never raw JSON. The ORDER is the metadata's indicator_keys
 * (#318) — the fiche's order, payload-owned, never an app-side dictionary.
 */

const payloadMobilite: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

/** L'ordre de la fiche — le registre indicator_keys de la métadonnée Mobilité. */
const ORDRE_METADONNEES = [
  'nb_buildings',
  'voitures_menage',
  'reseaux',
  'offre_tc',
  'bornes_recharge',
  'places_stationnement_velo_1000',
  'offre_cyclable',
  'iso_alimentation',
  'iso_sante',
  'iso_administration',
  'iso_ecole',
  'iso_banque',
]

describe('indicateursPourTerritoire — the Mobilité block in the metadata order', () => {
  it('returns the 12 keys in the fiche order (the metadata indicator_keys, #318)', () => {
    const groupes = indicateursGroupeesPourTerritoire(payloadMobilite, 'mobilite', '22001')

    expect(groupes.map((g) => g.key)).toEqual(ORDRE_METADONNEES)
  })

  it('keeps the same fiche order at every level (EPCI, département, région)', () => {
    for (const territoire of ['200000001', '22', '53']) {
      const cles = indicateursGroupeesPourTerritoire(
        payloadMobilite,
        'mobilite',
        territoire,
      ).map((g) => g.key)
      expect(cles[0]).toBe('nb_buildings')
      expect(cles.slice(1, 4)).toEqual(['voitures_menage', 'reseaux', 'offre_tc'])
      expect(cles.slice(4, 7)).toEqual([
        'bornes_recharge',
        'places_stationnement_velo_1000',
        'offre_cyclable',
      ])
      expect(cles.slice(7)).toEqual([
        'iso_alimentation',
        'iso_sante',
        'iso_administration',
        'iso_ecole',
        'iso_banque',
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
    const grille = lignes.filter((l) => l.key.startsWith('iso_'))
    expect(grille.map((l) => formaterValeur(l))).toEqual(['100', '100', '64', '100', '100'])
  })

  it('keeps the multi-detail keys as one key (voitures_menage ×2, reseaux ×6, offre_cyclable ×5)', () => {
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
    const cyclable = groupes.find((g) => g.key === 'offre_cyclable')
    expect(cyclable?.lignes.map((l) => l.detail)).toEqual([
      'protege_longueur',
      'protege_km_1000',
      'partage_longueur',
      'partage_km_1000',
      'total_longueur',
    ])
  })
})

describe("ratioOffreCyclable — le headline « X % de l'infrastructure routière » (issue #232)", () => {
  const groupes = (territoire: string) =>
    indicateursGroupeesPourTerritoire(payloadMobilite, 'mobilite', territoire)

  it('derives the ratio app-side: total_longueur ÷ reseaux.c_longueur (the ADR-0015 seam)', () => {
    const cyclable = groupes('53').find((g) => g.key === 'offre_cyclable')?.lignes ?? []
    const reseaux = groupes('53').find((g) => g.key === 'reseaux')?.lignes ?? []

    // 4 913,233 km ÷ 101 353,736 km ≈ 0,0485 — le chiffre verrouillé de l'e2e #231
    expect(ratioOffreCyclable(cyclable, reseaux)).toBeCloseTo(0.0485, 4)
  })

  it('returns 0 for a commune at 0 km — the figure shows 0, never suppressed', () => {
    const cyclable = groupes('22001').find((g) => g.key === 'offre_cyclable')?.lignes ?? []
    const reseaux = groupes('22001').find((g) => g.key === 'reseaux')?.lignes ?? []

    expect(ratioOffreCyclable(cyclable, reseaux)).toBe(0)
  })

  it('returns null when the c network row is absent (honest « — », never an invented ratio)', () => {
    const cyclable = groupes('22001').find((g) => g.key === 'offre_cyclable')?.lignes ?? []

    expect(ratioOffreCyclable(cyclable, [])).toBeNull()
  })

  it('returns null when the offre_cyclable rows are absent', () => {
    const reseaux = groupes('22001').find((g) => g.key === 'reseaux')?.lignes ?? []

    expect(ratioOffreCyclable([], reseaux)).toBeNull()
  })
})

describe('histoireMobilitePourTerritoire — la lecture RÉSOLUE (issue #312)', () => {
  it('returns the default reading for a non-saillant commune, with its real matter', () => {
    const histoire = histoireMobilitePourTerritoire(payloadMobilite, '22001')

    expect(histoire).not.toBeNull()
    expect(histoire?.story_key).toBe('vingt-minutes-sans-voiture')
    expect(histoire?.groupe).toBe('acces-aux-services')
    expect(histoire?.salience_reason).toBe('defaut')
    expect(histoire).toMatchObject({
      div_loss_t: 38,
      div_loss_b: 38,
      delta: 0,
      classification_saillance: 'non-saillant',
    })
  })

  it('gives a saillant territory the vélo reading ALONE — la saillance a remplacé le défaut (ADR-0002, #312)', () => {
    const histoire = histoireMobilitePourTerritoire(payloadMobilite, '22002')

    expect(histoire).not.toBeNull()
    expect(histoire?.story_key).toBe('ce-que-le-velo-preserve')
    expect(histoire?.salience_reason).toBe('delta-velo-saillant')
    expect(histoire?.delta).toBe(11)
  })

  it('returns null for a territory without a Mobilité Story (never invents a reading)', () => {
    expect(histoireMobilitePourTerritoire(payloadMobilite, '29002')).toBeNull()
    expect(histoireMobilitePourTerritoire(payloadMobilite, '99999')).toBeNull()
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
