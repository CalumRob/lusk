import { describe, expect, it } from 'vitest'

import { libelleIndicateur } from '../fiche/libelles'
import { LIBELLES_INDICATEURS_APP } from '../fiche/content/libellesAffichage'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Theme } from '../payload/types'

/**
 * App editorial indicator wording (#827) — the mounted proof lives in
 * onglet-theme.spec.ts (real figure renders app wording despite stale producer
 * presentation; changed producer labels reach the rendered category text).
 * Here: the app map carries only the editorial set, never a fact-bearing key.
 */

describe('libelles éditoriaux app-owned — périmètre', () => {
  it('ne contient que le jeu éditorial attendu', () => {
    const editorial = Object.entries(LIBELLES_INDICATEURS_APP).flatMap(([theme, labels]) =>
      Object.keys(labels).map((clef) => `${theme}:${clef}`))
    expect(editorial.sort()).toEqual([
      'demographie:densite',
      'demographie:structure_age',
      'demographie:taille_menages',
      'economie:eco_activites',
      'habitat:age_du_bati',
      'habitat:mix_logements',
      'habitat:statut',
      'habitat:type',
      'programmes:couverture_programmes',
    ])
  })

  it('rend l’éditorial sans métadonnée et laisse le factuel au producteur', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.indicator_labels = {}
    expect(libelleIndicateur(metadata, 'densite')).toBe('Densité de population')
    expect(() => libelleIndicateur(metadata, 'evolution_1968')).toThrow(/n’a pas de libellé/)
  })

  it.each(['mobilite', 'milieux'] as Theme[])('ne possède aucun libellé d’indicateur pour %s', (theme) => {
    expect(Object.keys(LIBELLES_INDICATEURS_APP[theme])).toEqual([])
  })
})
