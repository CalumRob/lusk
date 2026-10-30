import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { libelleDetail, libelleIndicateur } from '../fiche/libelles'
import { LIBELLES_INDICATEURS_APP } from '../fiche/content/libellesAffichage'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import { validerThemeMetadata } from '../payload/validate'
import type { Theme, ThemeMetadata } from '../payload/types'

/**
 * Label ownership boundary (#827). App content carries ONLY genuine editorial
 * wording; every fact-bearing label — observation boundaries and periods,
 * employment/unemployment definitions, thresholds, units/scales, age/year/time
 * bands, reference scope, classification/domain vocabulary — resolves from the
 * verified producer declaration. These tests assert the boundary itself.
 */

const THEMES = Object.keys(LIBELLES_INDICATEURS_APP) as Theme[]

function publie(theme: Theme): ThemeMetadata {
  return validerThemeMetadata(
    JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8')),
    `theme_${theme}.json`,
  )
}

/** Fact-bearing labels the app must never own (producer declarations). */
const FACT_BEARING = [
  // observation boundary / period
  ['demographie', 'evolution_1968'],
  // employment location / unemployment population definitions
  ['economie', 'effectifs_salaries'],
  ['economie', 'chomage'],
  // transport thresholds / reach
  ['mobilite', 'offre_tc'],
  ['mobilite', 'raccordement_tc'],
  // unit / ratio scales
  ['habitat', 'prix_m2'],
  // reference scope
  ['mobilite', 'raccordement_reference'],
  // programme domain vocabulary
  ['programmes', 'subventions_par_domaine'],
] as const

function sansLibelles(theme: Theme): ThemeMetadata {
  const metadata = structuredClone(metadonneesThemesFixtures[theme])
  metadata.indicator_labels = {}
  metadata.detail_labels = {}
  return metadata
}

describe('libelles d’affichage — frontière éditorial / factuel', () => {
  it.each(THEMES)('ne porte aucun libellé factuel pour le thème %s', (theme) => {
    const appIndicateurs = Object.keys(LIBELLES_INDICATEURS_APP[theme])
    for (const [factTheme, clef] of FACT_BEARING) {
      if (factTheme !== theme) continue
      expect(appIndicateurs).not.toContain(clef)
    }
  })

  it('ne fige ni échelle, ni seuil, ni période, ni domaine dans le contenu app', () => {
    const valeurs = Object.values(LIBELLES_INDICATEURS_APP).flatMap((labels) => Object.values(labels))
    for (const valeur of valeurs) {
      expect(valeur).not.toMatch(/\d{4}|\d+\s?(m|mètres|minutes|min|hab|‰)/)
      expect(valeur).not.toMatch(/lieu de travail|population active|par an/)
    }
  })

  it('rend les libellés éditoriaux app-owned sans aucune métadonnée', () => {
    const metadata = sansLibelles('habitat')
    expect(libelleIndicateur(metadata, 'mix_logements')).toBe('Mix de logements')
  })

  it('ignore un libellé producteur périmé pour un libellé éditorial app-owned', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.indicator_labels.densite = 'Ancien libellé du catalogue'
    expect(libelleIndicateur(metadata, 'densite')).toBe('Densité de population')
  })

  it('résout un libellé factuel depuis la déclaration producteur vérifiée', () => {
    const metadata = publie('mobilite')
    expect(libelleIndicateur(metadata, 'offre_tc')).toBe(metadata.indicator_labels.offre_tc)
    expect(libelleDetail(metadata, 'raccordement_courbe', 't0090')).toBe(metadata.detail_labels.raccordement_courbe.t0090)
  })

  it('suit une déclaration producteur MODIFIÉE au lieu de figer une copie app', () => {
    const metadata = publie('mobilite')
    metadata.indicator_labels.offre_tc = 'Part des bâtiments près d’un arrêt (à 300 m)'
    expect(libelleIndicateur(metadata, 'offre_tc')).toBe('Part des bâtiments près d’un arrêt (à 300 m)')
    metadata.detail_labels.raccordement_courbe.t0090 = '1 h 45'
    expect(libelleDetail(metadata, 'raccordement_courbe', 't0090')).toBe('1 h 45')
  })

  it('échoue FORT quand aucune source ne porte le libellé — jamais une clé brute', () => {
    const metadata = sansLibelles('demographie')
    expect(() => libelleIndicateur(metadata, 'densite_inconnue')).toThrow(/n’a pas de libellé/)
    expect(() => libelleDetail(metadata, 'structure_age', '90+')).toThrow(/n’a pas de libellé/)
  })
})
