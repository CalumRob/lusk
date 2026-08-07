import { describe, expect, it } from 'vitest'

import { idOnglet, idPanneau, NOMS_THEMES, NOMS_TYPES } from '../fiche/onglets'

/**
 * The ThemeTabs vocabulary (ADR-0007 + ui-elements.md): the French labels and
 * the stable a11y ids shared between the tabs (ThemeTabs) and the active
 * panel (the fiche view). These are the shell's contract with C2/C3 — the
 * content slots in behind the same ids and labels.
 */

describe('onglets — the ThemeTabs vocabulary (ADR-0007)', () => {
  it('labels every canonical theme in French', () => {
    expect(NOMS_THEMES).toEqual({
      mobilite: 'Mobilité',
      demographie: 'Démographie',
      habitat: 'Habitat',
      economie: 'Économie',
      milieux: 'Milieux',
    })
  })

  it('labels every territory type in French', () => {
    expect(NOMS_TYPES).toEqual({
      commune: 'Commune',
      epci: 'EPCI',
      departement: 'Département',
      region: 'Région',
    })
  })

  it('gives the Aperçu tab a stable id (null slug = Aperçu)', () => {
    expect(idOnglet(null)).toBe('onglet-apercu')
    expect(idPanneau(null)).toBe('panneau-apercu')
  })

  it('gives each theme tab a stable id matching its panel', () => {
    expect(idOnglet('demographie')).toBe('onglet-demographie')
    expect(idPanneau('habitat')).toBe('panneau-habitat')
  })
})
