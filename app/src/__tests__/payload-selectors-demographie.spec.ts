import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
} from '../payload/fixtures'
import {
  formaterSolde,
  formaterValeur,
  formaterVintage,
  histoirePourTerritoire,
  indicateursGroupeesPourTerritoire,
  indicateursPourTerritoire,
  rangEnContexte,
} from '../payload/selectors'
import type { Payload } from '../payload/types'

/**
 * The Démographie block selectors — pure, French product strings out of the
 * payload. The block's seam: the component consumes these, never raw JSON.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
}

describe('indicateursPourTerritoire — the standard block in contract order', () => {
  it('returns only the theme + territoire rows, ordered densite → structure_age → evolution → menages', () => {
    const lignes = indicateursPourTerritoire(payloadDemographie, 'demographie', '22001')

    expect(lignes[0]).toMatchObject({ key: 'densite' })
    expect(lignes[1]).toMatchObject({ key: 'structure_age', detail: '<15' })
    expect(lignes[7]).toMatchObject({ key: 'structure_age', detail: '80+' })
    expect(lignes[8]).toMatchObject({ key: 'evolution_1968' })
    expect(lignes[9]).toMatchObject({ key: 'taille_menages' })
    expect(lignes).toHaveLength(10)
  })

  it('never leaks another territory or theme into the block', () => {
    const lignes = indicateursPourTerritoire(payloadDemographie, 'demographie', '29002')

    expect(lignes.every((l) => l.territoire === '29002' && l.theme === 'demographie')).toBe(true)
  })
})

describe('indicateursGroupeesPourTerritoire — one figure per indicator key', () => {
  it('groups the 7 structure_age tranches into ONE figure, keeping the contract order', () => {
    const groupes = indicateursGroupeesPourTerritoire(payloadDemographie, 'demographie', '22001')

    expect(groupes.map((g) => g.key)).toEqual([
      'densite',
      'structure_age',
      'evolution_1968',
      'taille_menages',
    ])
    expect(groupes[1].lignes).toHaveLength(7)
  })
})

describe('histoirePourTerritoire — the Story row', () => {
  it('finds the story and its classification for the territory', () => {
    const histoire = histoirePourTerritoire(payloadDemographie, 'demographie', '22001')

    expect(histoire).toMatchObject({ story_key: 'attractive-ou-fertile', classification: 'fertile' })
    if (histoire?.theme !== 'demographie') throw new Error('attendu : story Démographie')
    expect(histoire.solde_naturel).toBe(70)
    expect(histoire.solde_migratoire).toBe(30)
  })

  it('returns null for a territory without a story (handled honestly)', () => {
    expect(histoirePourTerritoire(payloadDemographie, 'demographie', '99999')).toBeNull()
  })
})

describe('rangEnContexte — the rank chip of the nearest comparison group', () => {
  it('shows the EPCI rank for a commune (nearest group first)', () => {
    const densite22001 = indicateursDemographieFixture.find(
      (l) => l.territoire === '22001' && l.key === 'densite',
    )!

    expect(rangEnContexte(densite22001)).toBe("P50 de l'EPCI")
  })

  it('falls back to the département rank when the EPCI rank is null', () => {
    const densiteEpci = indicateursDemographieFixture.find(
      (l) => l.territoire === '200000001' && l.key === 'densite',
    )!

    expect(rangEnContexte(densiteEpci)).toBe('P0 du département')
  })

  it('returns null when every rank is null (the région ranks nowhere)', () => {
    const densiteRegion = indicateursDemographieFixture.find(
      (l) => l.territoire === '53' && l.key === 'densite',
    )!

    expect(rangEnContexte(densiteRegion)).toBeNull()
  })
})

describe('formaterValeur — the display value, French', () => {
  function ligne(key: string, territoire = '22001'): ReturnType<typeof indicateursDemographieFixture.find> {
    return indicateursDemographieFixture.find(
      (l) => l.territoire === territoire && l.key === key && l.detail === null,
    )
  }

  it('renders an absolute value as-is (densité 200 hab/km²)', () => {
    expect(formaterValeur(ligne('densite')!)).toBe('200')
  })

  it('multiplies a "%" fraction by 100 (0.3 → "30")', () => {
    const tranche = indicateursDemographieFixture.find(
      (l) => l.territoire === '22001' && l.key === 'structure_age' && l.detail === '<15',
    )!

    expect(formaterValeur(tranche)).toBe('30')
  })

  it('keeps the minus sign of a negative evolution', () => {
    expect(formaterValeur(ligne('evolution_1968', '22002')!)).toBe('-33')
  })

  it('formats a household size with a French decimal comma', () => {
    expect(formaterValeur(ligne('taille_menages')!)).toBe('2,29')
  })

  it('returns null for a null value (non calculable — the figure shows "—")', () => {
    const sansValeur = { ...ligne('densite')!, value: null }

    expect(formaterValeur(sansValeur)).toBeNull()
  })
})

describe('formaterVintage — the always-present freshness stamp', () => {
  it('carries source · version · reference date · publication date', () => {
    const densite22001 = indicateursDemographieFixture.find(
      (l) => l.territoire === '22001' && l.key === 'densite',
    )!

    expect(formaterVintage(densite22001)).toBe(
      'INSEE — Série historique du recensement · 2023 · réf. 1 janv. 2023 · publ. 30 juin 2026',
    )
  })
})

describe('formaterSolde — the signed story numbers', () => {
  it('prefixes a "+" for positive soldes, "−" for negative, none for zero', () => {
    expect(formaterSolde(70)).toBe('+70')
    expect(formaterSolde(-380)).toBe('-380')
    expect(formaterSolde(0)).toBe('0')
  })
})
