import { describe, expect, it } from 'vitest'

import { NOMS_INDICATEURS, NOMS_TRANCHES_AGE } from '../fiche/indicateurs'

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
