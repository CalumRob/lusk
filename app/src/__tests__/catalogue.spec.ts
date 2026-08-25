import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  entreesRechercheIndicateurs,
  groupesCatalogue,
} from '../indicateurs/catalogue'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { ThemeMetadata } from '../payload/types'
import { FAMILLES_FIGURE, THEMES_CANONIQUES } from '../payload/types'

/**
 * Le catalogue /indicateurs (#409) — la génération CONTRACT-DRIVEN : les
 * groupes lisent theme_<theme>.json (l'ordre canonique des thèmes, l'ordre
 * déclaré des sous-groupes) et NE contiennent que les Pages d'indicateur
 * PUBLIÉES (indicator_pages) — jamais un indicateur de fiche sans page, jamais
 * une page orpheline. Les libellés viennent des descripteurs canon (page.label),
 * jamais d'une clé brute ; thèmes et sous-groupes restent des RASSEMBLEMENTS
 * (des titres), jamais des pages analytiques.
 */

describe('groupesCatalogue — la génération contract-driven', () => {
  it('groupe par thème dans l’ordre canonique et par sous-groupe dans l’ordre déclaré', () => {
    const groupes = groupesCatalogue({
      programmes: metadonneesThemesFixtures.programmes,
      demographie: metadonneesThemesFixtures.demographie,
    })
    // L'ordre CANONIQUE des thèmes (mobilite … programmes), jamais l'ordre
    // d'insertion de l'objet passé.
    expect(groupes.map((groupe) => groupe.theme)).toEqual(
      THEMES_CANONIQUES.filter(
        (theme) => theme === 'demographie' || theme === 'programmes',
      ),
    )
    // Les sous-groupes gardent leur ordre DÉCLARÉ ; « couverture » n'a aucune
    // page publiée (couverture_programmes n'est pas une Page d'indicateur) —
    // jamais un titre sans contenu.
    expect(groupes[0]!.sousGroupes.map((sousGroupe) => sousGroupe.key)).toEqual([
      'trajectoire-demographique',
    ])
    expect(groupes[1]!.sousGroupes.map((sousGroupe) => sousGroupe.key)).toEqual(['subventions'])
  })

  it('liste chaque Page d’indicateur publiée — et SEULEMENT elle', () => {
    // Le fixture Programmes : couverture_programmes et subventions_par_domaine
    // sont des faits publiés SANS Page d'indicateur (la dette connue #458) —
    // ils ne sont JAMAIS des entrées du catalogue (aucune item qui mène
    // nulle part). subventions_annuelles seule a sa page.
    const groupes = groupesCatalogue({ programmes: metadonneesThemesFixtures.programmes })
    const entrees = groupes.flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) => sousGroupe.entrees),
    )
    expect(entrees.map((entree) => entree.indicateur)).toEqual(['subventions_annuelles'])
    const texte = JSON.stringify(entrees)
    expect(texte).not.toContain('couverture_programmes')
    expect(texte).not.toContain('subventions_par_domaine')
  })

  it('porte le libellé du DESCRIPTEUR canon — jamais une clé brute', () => {
    const groupes = groupesCatalogue({
      demographie: metadonneesThemesFixtures.demographie,
      programmes: metadonneesThemesFixtures.programmes,
    })
    const densite = groupes[0]!.sousGroupes[0]!.entrees[0]!
    expect(densite.label).toBe('Densité de population')
    expect(densite.label).not.toBe('densite')
    expect(densite.href).toBe('/indicateurs/demographie/densite')
    // Le titre du sous-groupe est payload-owned (jamais un vocabulaire app-side).
    expect(groupes[1]!.sousGroupes[0]!.label).toBe('Subventions attribuées')
  })

  it('ignore un thème absent des métadonnées — jamais un groupe fantôme', () => {
    const groupes = groupesCatalogue({ demographie: metadonneesThemesFixtures.demographie })
    expect(groupes.map((groupe) => groupe.theme)).toEqual(['demographie'])
  })

  it('ne crée pas de sous-groupe vide — un rassemblement sans page publiée reste silencieux', () => {
    // Économie : aucun indicator_pages → AUCUN groupe (le thème ne figure pas).
    const groupes = groupesCatalogue({ economie: metadonneesThemesFixtures.economie })
    expect(groupes).toEqual([])
  })
})

describe('entreesRechercheIndicateurs — le flat pour la recherche groupée', () => {
  it('miroir 1:1 du catalogue : même ordre, mêmes hrefs', () => {
    const metadata = Object.fromEntries(
      Object.entries(metadonneesThemesFixtures).filter(
        ([theme]) => theme === 'demographie' || theme === 'programmes',
      ),
    ) as Partial<Record<ThemeMetadata['theme'], ThemeMetadata>>
    const attendu = groupesCatalogue(metadata).flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) =>
        sousGroupe.entrees.map((entree) => ({ label: entree.label, href: entree.href })),
      ),
    )
    expect(
      entreesRechercheIndicateurs(metadata).map((entree) => ({
        label: entree.label,
        href: entree.href,
      })),
    ).toEqual(attendu)
  })
})

/**
 * Le garde « every and only » contre le payload RÉEL commis : la somme des
 * pages publiées des six thèmes EST le catalogue, à l'entrée près — aucune
 * page oubliée, aucune entrée sans page, aucune famille non supportée par
 * la grammaire Repères (AC #409 : aucune item publiée ne mène à une famille
 * de page non supportée).
 */
describe('catalogue × payload réel commis (public/data)', () => {
  const dataDir = join(process.cwd(), '..', 'public', 'data')

  function metadonneesReelles(): Partial<Record<(typeof THEMES_CANONIQUES)[number], ThemeMetadata>> {
    return Object.fromEntries(
      THEMES_CANONIQUES.map((theme) => [
        theme,
        JSON.parse(readFileSync(join(dataDir, `theme_${theme}.json`), 'utf-8')) as ThemeMetadata,
      ]),
    )
  }

  it('le catalogue contient TOUTES les pages publiées, chacune UNE fois, chacune vers sa route', () => {
    const metadata = metadonneesReelles()
    const publiees = THEMES_CANONIQUES.flatMap((theme) =>
      Object.keys(metadata[theme]?.indicator_pages ?? {}),
    )
    const entrees = entreesRechercheIndicateurs(metadata)

    expect(entrees.length).toBe(publiees.length)
    expect(new Set(entrees.map((entree) => `${entree.theme}/${entree.indicateur}`)).size).toBe(
      publiees.length,
    )
    for (const entree of entrees) {
      expect(metadata[entree.theme]?.indicator_pages?.[entree.indicateur]).toBeTruthy()
      expect(entree.href).toBe(`/indicateurs/${entree.theme}/${entree.indicateur}`)
    }
    for (const cle of publiees) {
      expect(entrees.some((entree) => entree.indicateur === cle), `page ${cle} absente`).toBe(true)
    }
  })

  it('chaque famille publiée est supportée par la grammaire Repères — aucune item vers une famille non rendue', () => {
    const metadata = metadonneesReelles()
    for (const theme of THEMES_CANONIQUES) {
      for (const page of Object.values(metadata[theme]?.indicator_pages ?? {})) {
        // Le JSON brut commis peut porter le descripteur pré-#401 sans
        // `family` — la règle du validateur (load) est la normalisation
        // « scalar » ; on lit la même normalisation ici.
        const family = page.family ?? 'scalar'
        expect(FAMILLES_FIGURE as readonly string[]).toContain(family)
      }
    }
  })
})
