import { describe, expect, it } from 'vitest'

import {
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import {
  formaterValeur,
  histoirePourTerritoire,
  indicateursGroupeesPourTerritoire,
  indicateursPourTerritoire,
  ratioOffreCyclable,
} from '../payload/selectors'
import type { Payload } from '../payload/types'

/**
 * The Mobilité block selectors — pure, French product strings out of the
 * payload. Slice 3 of #1048 retires the snapshot readings and their peer
 * cloud: the fiche's Mobilité block is now the 17 retained indicator keys and
 * no lecture. The ORDER is the metadata's indicator_keys (#318) — the fiche's
 * order, payload-owned, never an app-side dictionary.
 */

const payloadMobilite: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

/** L'ordre de la fiche — les clés retenues du registre Mobilité. */
const ORDRE_METADONNEES = [
  'voitures_menage',
  'reseaux',
  'reseaux_par_habitant',
  'surface_reseaux_routiers',
  'offre_tc',
  'bornes_recharge',
  'places_stationnement_velo_1000',
  'offre_cyclable',
]

describe('indicateursPourTerritoire — the Mobilité block in the metadata order', () => {
  it('returns the retained keys in the fiche order (the metadata indicator_keys, #318)', () => {
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
      expect(cles).toEqual(ORDRE_METADONNEES)
    }
  })

  it('never leaks another territory or theme into the block', () => {
    const lignes = indicateursPourTerritoire(payloadMobilite, 'mobilite', '22001')

    expect(lignes.every((l) => l.territoire === '22001' && l.theme === 'mobilite')).toBe(true)
  })

  it('carries only the retained facts — no snapshot isolation row', () => {
    const lignes = indicateursPourTerritoire(payloadMobilite, 'mobilite', '22001')

    expect(lignes.every((l) => !l.key.startsWith('iso_') && !l.key.startsWith('share_'))).toBe(true)
    expect(lignes.filter((l) => l.key === 'offre_tc').map((l) => formaterValeur(l))).toEqual(['0'])
  })

  it('keeps the multi-detail keys as one key (voitures_menage ×3, reseaux ×3, offre_cyclable ×5)', () => {
    const groupes = indicateursGroupeesPourTerritoire(payloadMobilite, 'mobilite', '22001')

    const voitures = groupes.find((g) => g.key === 'voitures_menage')
    expect(voitures?.lignes.map((l) => l.detail)).toEqual([
      'deux_plus',
      'sans_voiture',
      'une_voiture',
    ])
    const reseaux = groupes.find((g) => g.key === 'reseaux')
    expect(reseaux?.lignes.map((l) => l.detail)).toEqual([
      'b_longueur',
      'c_longueur',
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

describe('le thème Mobilité n’a plus de lecture résolue (#1048 slice 3)', () => {
  it('ne porte aucune ligne d’histoire dans la fixture', () => {
    expect(histoiresMobiliteFixture).toEqual([])
  })

  it('ne restitue aucune lecture pour un territoire du thème', () => {
    expect(histoirePourTerritoire(payloadMobilite, 'mobilite', '22001')).toBeNull()
    expect(histoirePourTerritoire(payloadMobilite, 'mobilite', '22002')).toBeNull()
  })
})

// #627 — les sélecteurs d'estampille et de nuage du snapshot ont été retirés
// avec le produit : la lecture AEDAR porte sa propre provenance.
