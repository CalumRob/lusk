import { describe, expect, it } from 'vitest'

import {
  NOMS_DETAILS_OFFRE_CYCLABLE,
  NOMS_INDICATEURS,
  NOMS_TRANCHES_AGE,
} from '../fiche/indicateurs'

/**
 * The indicator vocabulary (fiche contract): French labels for the standard
 * indicator keys per theme. Économie (issue #121, forme reshapée): the block
 * is 3 indicators — taille (effectifs_salaries, Flores A88), santé (chomage,
 * concept censitaire) and verdure (eco_activites, approximation EGSS) — never
 * a LQ figure (the LQ is the Story, issue #120).
 */

describe('NOMS_INDICATEURS — the Économie block vocabulary', () => {
  it('labels the 3 Économie indicators in French (taille · santé · verdure)', () => {
    expect(NOMS_INDICATEURS.economie).toEqual({
      effectifs_salaries: 'Effectifs salariés (lieu de travail)',
      chomage: 'Chômage (population active)',
      eco_activites: 'Part des éco-activités',
    })
  })

  it('keeps the other themes untouched', () => {
    expect(NOMS_INDICATEURS.demographie.densite).toBe('Densité de population')
    expect(NOMS_INDICATEURS.habitat).toEqual({})
  })

  it('labels the Mobilité indicators — « à pied ou en transports en commun », jamais « sans voiture » (issue #142)', () => {
    const mobilite = NOMS_INDICATEURS.mobilite

    expect(mobilite.iso_alimentation).toContain('à pied ou en transports en commun')
    expect(mobilite.iso_banque).toContain('à pied ou en transports en commun')
    expect(mobilite.nb_buildings).toBe('Bâtiments résidentiels analysés')
    for (const libelle of Object.values(mobilite)) {
      expect(libelle).not.toContain('sans voiture')
    }
  })

  it('keeps the structure_age tranche labels exhaustive', () => {
    expect(NOMS_TRANCHES_AGE['<15']).toBe('Moins de 15 ans')
    expect(NOMS_TRANCHES_AGE['80+']).toBe('80 ans et plus')
  })
})

describe('NOMS_INDICATEURS — la figure « L’offre cyclable » (issue #232)', () => {
  it('labels the key in the contract vocabulary', () => {
    expect(NOMS_INDICATEURS.mobilite.offre_cyclable).toBe('L’offre cyclable')
  })

  it('labels the protégé/partagé details of the figure', () => {
    expect(NOMS_DETAILS_OFFRE_CYCLABLE.protege_km_1000).toBe('Protégé')
    expect(NOMS_DETAILS_OFFRE_CYCLABLE.partage_km_1000).toBe('Partagé')
    expect(NOMS_DETAILS_OFFRE_CYCLABLE.total_longueur).toBe('Longueur totale')
    expect(NOMS_DETAILS_OFFRE_CYCLABLE.protege_longueur).toBe('Longueur protégée')
    expect(NOMS_DETAILS_OFFRE_CYCLABLE.partage_longueur).toBe('Longueur partagée')
  })

  it('never uses « à venir » for the figure (a commune at 0 km shows 0)', () => {
    expect(NOMS_DETAILS_OFFRE_CYCLABLE.protege_km_1000).not.toContain('à venir')
    expect(NOMS_DETAILS_OFFRE_CYCLABLE.partage_km_1000).not.toContain('à venir')
  })
})
