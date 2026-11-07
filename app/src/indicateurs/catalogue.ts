/**
 * Shared catalogue projection for /indicateurs and grouped global search.
 * Organization and page membership come from app-owned content; producer
 * discovery admits route identities and owns factual labels. Only neutral
 * editorial display wording can override those labels through libellesAffichage.
 */

import type { Theme } from '@/payload/types'
import { chargerCatalogueRessources } from '@/payload/semanticResourceClient'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import { LIBELLES_INDICATEURS_APP } from '@/fiche/content/libellesAffichage'
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

let discoveryFetcher: typeof fetch | null = null
let discoveryRequest: Promise<SemanticResourceDeclaration[]> | null = null

/** Share the existing producer discovery request between the catalogue and global search. */
export function chargerRessourcesCatalogueIndicateurs(): Promise<SemanticResourceDeclaration[]> {
  const fetcher = fetch
  if (discoveryFetcher !== fetcher) {
    discoveryFetcher = fetcher
    discoveryRequest = null
  }
  if (!discoveryRequest) {
    let pending: Promise<SemanticResourceDeclaration[]>
    pending = chargerCatalogueRessources().catch((error) => {
      if (discoveryFetcher === fetcher && discoveryRequest === pending) discoveryRequest = null
      throw error
    })
    discoveryRequest = pending
  }
  return discoveryRequest
}

function declarationForPage(
  resources: readonly SemanticResourceDeclaration[],
  theme: Theme,
  resourceKey: string,
): SemanticResourceDeclaration | undefined {
  return resources.find((resource) => resource.theme_id === theme &&
    resource.resource_id === resourceKey && resource.indicator_id === resourceKey &&
    resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts') &&
    resource.allowed_levels.length > 0)
}

/** Project app-owned organization after native discovery admits each route identity. */
export function groupesCatalogue(resources: readonly SemanticResourceDeclaration[]): GroupeThemeCatalogue[] {
  return CONTENU_CATALOGUE_INDICATEURS.map((groupe) => ({
    theme: groupe.theme,
    label: groupe.label,
    sousGroupes: groupe.sousGroupes.map((sousGroupe) => ({
      key: sousGroupe.key,
      label: sousGroupe.label,
      entrees: sousGroupe.pages.flatMap(({ resourceKey }) => {
        const declaration = declarationForPage(resources, groupe.theme, resourceKey)
        if (!declaration) return []
        return [{
          theme: groupe.theme,
          indicateur: resourceKey,
          label: LIBELLES_INDICATEURS_APP[groupe.theme][resourceKey] ?? declaration.label,
          href: hrefDe(groupe.theme, resourceKey),
        }]
      }),
    })),
  }))
}

/** Search receives the same admitted identities and resolved public labels as the page catalogue. */
export function entreesRechercheIndicateurs(
  resources: readonly SemanticResourceDeclaration[],
): EntreeRechercheIndicateur[] {
  return groupesCatalogue(resources).flatMap((groupe) =>
    groupe.sousGroupes.flatMap((sousGroupe) => sousGroupe.entrees.map((entree) => ({
      theme: entree.theme,
      themeLabel: groupe.label,
      label: entree.label,
      href: entree.href,
    }))),
  )
}
