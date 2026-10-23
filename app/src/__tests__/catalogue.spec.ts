import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  entreesRechercheIndicateurs,
  groupesCatalogue,
} from '../indicateurs/catalogue'
import { CONTENU_CATALOGUE_INDICATEURS } from '../indicateurs/catalogueContent'
import { FAMILLES_FIGURE, THEMES_CANONIQUES } from '../payload/types'

const metadataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../pipeline/inst/extdata/theme-metadata')

interface DeclarationPage {
  sources?: string[]
  family?: string
}

interface DeclarationTheme {
  indicator_pages?: Record<string, DeclarationPage>
  source_records?: Record<string, { serving_disposition?: string }>
}

function declarationsProducteur() {
  return THEMES_CANONIQUES.map((theme) => {
    const metadata = JSON.parse(
      readFileSync(resolve(metadataDir, `theme_${theme}.json`), 'utf8'),
    ) as DeclarationTheme
    const pages = Object.entries(metadata.indicator_pages ?? {}).map(([resourceKey, page]) => {
      const sources = page.sources ?? []
      for (const source of sources) {
        expect(metadata.source_records?.[source], `${theme}/${resourceKey}: source record ${source}`).toBeDefined()
      }
      const retired = sources.some(
        (source) => metadata.source_records?.[source]?.serving_disposition === 'excluded_legacy_accessibility',
      )
      return { theme, resourceKey, page, retired }
    })
    return { theme, pages }
  })
}

describe('catalogue des Pages d’indicateur app-owned', () => {
  it('garde l’ordre des thèmes et sous-groupes ayant des pages, puis les pages déclarées dans leur ordre produit', () => {
    const groupes = groupesCatalogue()

    expect(groupes.map(({ theme }) => theme)).toEqual([...THEMES_CANONIQUES])
    expect(groupes[0]?.sousGroupes.map(({ key }) => key)).toEqual([
      'partage-de-lespace-public',
      'motorisation',
      'offre-transports-commun',
    ])
    expect(groupes[0]?.sousGroupes[0]?.entrees.map(({ indicateur }) => indicateur)).toEqual([
      'reseaux',
      'reseaux_par_habitant',
      'surface_reseaux_routiers',
      'places_stationnement_velo_1000',
      'places_stationnement_voiture_1000',
      'stationnement_velo_par_voiture',
      'offre_cyclable',
    ])
    expect(groupes.at(-1)?.sousGroupes.map(({ key }) => key)).toEqual(['subventions'])
  })

  it('porte les libellés éditoriaux et les URL publiques sans rendre les clés brutes', () => {
    const groupes = groupesCatalogue()
    const pages = groupes.flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) => sousGroupe.entrees),
    )
    const densite = pages.find(({ indicateur }) => indicateur === 'densite')!

    expect(groupes[0]?.label).toBe('Mobilité')
    expect(groupes[0]?.sousGroupes[0]?.label).toBe('Le partage de l’espace public')
    expect(densite.label).toBe('Densité de population')
    expect(densite.href).toBe('/indicateurs/demographie/densite')
    expect(pages.every(({ label, indicateur }) => label !== indicateur && !/^[a-z_]+$/.test(label))).toBe(true)
    expect(pages.some(({ href }) => href.endsWith('/raccordement_reference'))).toBe(false)
  })

  it('fournit les mêmes libellés, thèmes et ordre à la recherche groupée', () => {
    const attendu = groupesCatalogue().flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) =>
        sousGroupe.entrees.map((entree) => ({
          theme: entree.theme,
          themeLabel: groupe.label,
          label: entree.label,
          href: entree.href,
        })),
      ),
    )

    expect(entreesRechercheIndicateurs()).toEqual(attendu)
    expect(entreesRechercheIndicateurs().map(({ label }) => label)).toContain('Densité de population')
  })

  it('relie exactement les 31 pages conservées aux déclarations producteur retenues', () => {
    const declarations = declarationsProducteur()
    const pagesDeclarees = declarations.flatMap(({ pages }) => pages)
    const conservees = pagesDeclarees.filter(({ retired }) => !retired)
    const retirees = pagesDeclarees.filter(({ retired }) => retired)
    const pagesCatalogue = CONTENU_CATALOGUE_INDICATEURS.flatMap((groupe) =>
      groupe.sousGroupes.flatMap((sousGroupe) =>
        sousGroupe.pages.map(({ resourceKey }) => `${groupe.theme}/${resourceKey}`),
      ),
    )

    // Recomputed from canonical declarations via sources -> source_records;
    // editorial labels are deliberately not compared to producer metadata.
    expect(pagesDeclarees).toHaveLength(45)
    expect(retirees).toHaveLength(14)
    expect(conservees).toHaveLength(31)
    expect(new Set(pagesCatalogue).size).toBe(pagesCatalogue.length)
    expect(pagesCatalogue.sort()).toEqual(
      conservees.map(({ theme, resourceKey }) => `${theme}/${resourceKey}`).sort(),
    )

    for (const { theme, resourceKey } of conservees) {
      expect(entreesRechercheIndicateurs().some((entry) =>
        entry.theme === theme && entry.href === `/indicateurs/${theme}/${resourceKey}`,
      )).toBe(true)
    }
  })

  it('garde chaque famille de page producteur dans la grammaire Repères supportée', () => {
    for (const { theme, pages } of declarationsProducteur()) {
      for (const { resourceKey, page } of pages) {
        const family = page.family ?? 'scalar'
        expect(FAMILLES_FIGURE as readonly string[], `${theme}/${resourceKey}`).toContain(family)
      }
    }
  })
})
