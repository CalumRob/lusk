/**
 * Le catalogue /indicateurs (#409) — la génération CONTRACT-DRIVEN des
 * entrées : les groupes lisent theme_<theme>.json (l'ordre canonique des
 * thèmes, l'ordre déclaré des sous-groupes) et ne contiennent que les Pages
 * d'indicateur PUBLIÉES (`indicator_pages`). Un fait de fiche sans page n'est
 * JAMAIS une entrée (aucune item qui mène nulle part — la couverture des
 * pages est l'affaire de l'audit #458, pas du catalogue). Les libellés
 * viennent des descripteurs canon (`page.label`), jamais d'une clé brute ;
 * thèmes et sous-groupes restent des rassemblements titrés, jamais des pages.
 *
 * Fonctions pures — testées en isolation (__tests__/catalogue.spec.ts),
 * consommées par la vue IndicateursView et par la recherche groupée
 * (entreesRechercheIndicateurs).
 */

import type { Theme, ThemeMetadata } from '@/payload/types'
import { THEMES_CANONIQUES } from '@/payload/types'

/** Une entrée du catalogue : une Page d'indicateur publiée, à sa route. */
export interface EntreeCatalogue {
  theme: Theme
  /** La clé canon de l'indicateur (l'autorité du descripteur publié). */
  indicateur: string
  /** Le libellé public du DESCRIPTEUR — jamais une clé brute. */
  label: string
  href: string
}

/** Un sous-groupe de fiche comme rassemblement du catalogue (un titre, pas une page). */
export interface SousGroupeCatalogue {
  key: string
  label: string
  entrees: EntreeCatalogue[]
}

/** Un thème comme rassemblement du catalogue (un titre, pas une page). */
export interface GroupeThemeCatalogue {
  theme: Theme
  label: string
  sousGroupes: SousGroupeCatalogue[]
}

const hrefDe = (theme: Theme, indicateur: string): string => `/indicateurs/${theme}/${indicateur}`

/**
 * Les groupes du catalogue : chaque thème canonique présent dans les
 * métadonnées, ses sous-groupes DANS L'ORDRE DÉCLARÉ, et dans chacun ses
 * indicateurs publiés (l'ordre déclaré du sous-groupe). Un thème sans AUCUNE
 * page publiée ne figure pas — jamais un groupe fantôme ni un sous-groupe vide.
 */
export function groupesCatalogue(
  metadata: Partial<Record<Theme, ThemeMetadata>>,
): GroupeThemeCatalogue[] {
  const groupes: GroupeThemeCatalogue[] = []
  for (const theme of THEMES_CANONIQUES) {
    const meta = metadata[theme]
    if (!meta) continue
    const sousGroupes: SousGroupeCatalogue[] = []
    for (const sousGroupe of meta.subgroups) {
      const entrees: EntreeCatalogue[] = []
      for (const clef of sousGroupe.indicators) {
        const page = meta.indicator_pages?.[clef]
        if (!page) continue
        entrees.push({ theme, indicateur: clef, label: page.label, href: hrefDe(theme, clef) })
      }
      if (entrees.length > 0) {
        sousGroupes.push({ key: sousGroupe.key, label: sousGroupe.label, entrees })
      }
    }
    if (sousGroupes.length > 0) {
      groupes.push({ theme, label: meta.label, sousGroupes })
    }
  }
  return groupes
}

/** Le flat du catalogue pour la recherche groupée — miroir 1:1 des groupes. */
export function entreesRechercheIndicateurs(
  metadata: Partial<Record<Theme, ThemeMetadata>>,
): (EntreeCatalogue & { /** Le libellé publié du thème, pour la puce de groupe. */ themeLabel: string })[] {
  return groupesCatalogue(metadata).flatMap((groupe) =>
    groupe.sousGroupes.flatMap((sousGroupe) =>
      sousGroupe.entrees.map((entree) => ({ ...entree, themeLabel: groupe.label })),
    ),
  )
}
