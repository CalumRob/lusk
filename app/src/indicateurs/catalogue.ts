/**
 * Shared catalogue projection for /indicateurs and grouped global search.
 * Stable wording and organization come from the app-owned content source;
 * resource keys remain the producer identities used in page URLs.
 */

import type { Theme } from '@/payload/types'
import type { EntreeRechercheIndicateur } from '@/search/recherche'

import { CONTENU_CATALOGUE_INDICATEURS } from './catalogueContent'

/** Une entrée du catalogue : une Page d'indicateur à sa route existante. */
export interface EntreeCatalogue {
  theme: Theme
  /** Identité ressource canonique, également le segment public existant. */
  indicateur: string
  label: string
  href: string
}

/** Un sous-groupe de fiche comme rassemblement du catalogue. */
export interface SousGroupeCatalogue {
  key: string
  label: string
  entrees: EntreeCatalogue[]
}

/** Un thème comme rassemblement du catalogue. */
export interface GroupeThemeCatalogue {
  theme: Theme
  label: string
  sousGroupes: SousGroupeCatalogue[]
}

const hrefDe = (theme: Theme, resourceKey: string): string => `/indicateurs/${theme}/${resourceKey}`

/** Projection pure du contenu partagé vers la grammaire de la liste groupée. */
export function groupesCatalogue(): GroupeThemeCatalogue[] {
  return CONTENU_CATALOGUE_INDICATEURS.map((groupe) => ({
    theme: groupe.theme,
    label: groupe.label,
    sousGroupes: groupe.sousGroupes.map((sousGroupe) => ({
      key: sousGroupe.key,
      label: sousGroupe.label,
      entrees: sousGroupe.pages.map(({ resourceKey, label }) => ({
        theme: groupe.theme,
        indicateur: resourceKey,
        label,
        href: hrefDe(groupe.theme, resourceKey),
      })),
    })),
  }))
}

/** Le flat du même contenu pour la recherche groupée. */
export function entreesRechercheIndicateurs(): EntreeRechercheIndicateur[] {
  return CONTENU_CATALOGUE_INDICATEURS.flatMap((groupe) =>
    groupe.sousGroupes.flatMap((sousGroupe) =>
      sousGroupe.pages.map(({ resourceKey, label }) => ({
        theme: groupe.theme,
        themeLabel: groupe.label,
        label,
        href: hrefDe(groupe.theme, resourceKey),
      })),
    ),
  )
}
