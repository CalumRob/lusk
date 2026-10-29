import { describe, expect, it } from 'vitest'

import { libelleDetail, libelleIndicateur } from '../fiche/libelles'
import { LIBELLES_DETAILS_APP, LIBELLES_INDICATEURS_APP } from '../fiche/content/libellesAffichage'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Theme, ThemeMetadata } from '../payload/types'

/**
 * Ordinary display labels are app-owned presentation (#827): the shared map
 * carries them keyed to real resource/detail identities, so a stale or absent
 * producer catalogue never blanks or renames a figure. Native contract labels
 * stay first priority at the component seam; this file proves the fallback.
 */

const THEMES = Object.keys(LIBELLES_INDICATEURS_APP) as Theme[]

function sansLibelles(theme: Theme): ThemeMetadata {
  const metadata = structuredClone(metadonneesThemesFixtures[theme])
  metadata.indicator_labels = {}
  metadata.detail_labels = {}
  return metadata
}

describe('libelles d’affichage app-owned — repli stable, jamais une clé brute', () => {
  it.each(THEMES)('rend les libellés d’indicateur du thème %s sans aucune métadonnée', (theme) => {
    const metadata = sansLibelles(theme)
    for (const [clef, libelle] of Object.entries(LIBELLES_INDICATEURS_APP[theme])) {
      expect(libelleIndicateur(metadata, clef)).toBe(libelle)
    }
  })

  it.each(THEMES)('rend les libellés de détail du thème %s sans aucune métadonnée', (theme) => {
    const metadata = sansLibelles(theme)
    for (const [clef, details] of Object.entries(LIBELLES_DETAILS_APP[theme])) {
      for (const [detail, libelle] of Object.entries(details)) {
        expect(libelleDetail(metadata, clef, detail)).toBe(libelle)
      }
    }
  })

  it('ignore un libellé producteur périmé pour une ressource app-owned', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.indicator_labels.densite = 'Ancien libellé du catalogue'
    metadata.detail_labels.structure_age['<15'] = 'Ancienne tranche'
    expect(libelleIndicateur(metadata, 'densite')).toBe('Densité de population')
    expect(libelleDetail(metadata, 'structure_age', '<15')).toBe('Moins de 15 ans')
  })

  it('garde la métadonnée comme repli pour une ressource que l’app ne possède pas encore', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.indicator_labels.future_resource = 'Ressource future'
    expect(libelleIndicateur(metadata, 'future_resource')).toBe('Ressource future')
  })

  it('échoue FORT quand aucune source ne porte le libellé — jamais une clé brute', () => {
    const metadata = sansLibelles('demographie')
    expect(() => libelleIndicateur(metadata, 'densite_inconnue')).toThrow(/n’a pas de libellé/)
    expect(() => libelleDetail(metadata, 'structure_age', '90+')).toThrow(/n’a pas de libellé/)
  })
})
