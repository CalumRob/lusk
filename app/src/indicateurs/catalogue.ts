/**
 * Shared catalogue projection for /indicateurs and grouped global search.
 * Organization and page membership come from app-owned content; producer
 * discovery admits route identities and owns factual labels. Only neutral
 * editorial display wording can override those labels through libellesAffichage.
 */

import { inject, ref, type InjectionKey, type Ref } from 'vue'

import type { Theme } from '@/payload/types'
import { chargerCatalogueRessources } from '@/payload/semanticResourceClient'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import { LIBELLES_INDICATEURS_APP } from '@/fiche/content/libellesAffichage'
import type { EntreeRechercheIndicateur } from '@/search/recherche'

import { CONTENU_CATALOGUE_INDICATEURS } from './catalogueContent'
import { presentationPageDepuisRessource } from './pagePresentation'

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

export type StatutDecouverteIndicateurs = 'loading' | 'error' | 'ready'

/** Per-Vue-app discovery state shared by the persistent shell and catalogue route. */
export interface EtatDecouverteIndicateurs {
  readonly ressources: Ref<SemanticResourceDeclaration[] | null>
  readonly statut: Ref<StatutDecouverteIndicateurs>
  readonly chargement: Ref<boolean>
  charger(): Promise<SemanticResourceDeclaration[]>
}

export const ETAT_DECOUVERTE_INDICATEURS_KEY: InjectionKey<EtatDecouverteIndicateurs> =
  Symbol('etat-decouverte-indicateurs')

export function creerEtatDecouverteIndicateurs(): EtatDecouverteIndicateurs {
  const ressources = ref<SemanticResourceDeclaration[] | null>(null)
  const statut = ref<StatutDecouverteIndicateurs>('loading')
  const chargement = ref(false)
  let requete: Promise<SemanticResourceDeclaration[]> | null = null
  let fetcherRequete: typeof fetch | null = null
  let generation = 0

  function charger(): Promise<SemanticResourceDeclaration[]> {
    if (statut.value === 'ready' && ressources.value) return Promise.resolve(ressources.value)

    const fetcher = fetch
    if (requete && fetcherRequete === fetcher) return requete
    if (requete && fetcherRequete !== fetcher) {
      // A newer app/test transport owns subsequent requests; ignore stale completion.
      generation += 1
      requete = null
    }

    const requestGeneration = ++generation
    fetcherRequete = fetcher
    chargement.value = true
    // Retain the error state while a user-initiated retry is pending so the
    // retry control remains mounted and its disabled/pending announcement works.
    if (statut.value !== 'error') statut.value = 'loading'

    const pending = chargerCatalogueRessources().then((resources) => {
      if (generation === requestGeneration) {
        ressources.value = resources
        statut.value = 'ready'
      }
      return resources
    }).catch((error: unknown) => {
      if (generation === requestGeneration) {
        ressources.value = null
        statut.value = 'error'
      }
      throw error
    }).finally(() => {
      if (generation === requestGeneration) {
        chargement.value = false
        requete = null
        fetcherRequete = null
      }
    })
    requete = pending
    return pending
  }

  return { ressources, statut, chargement, charger }
}

/** Components outside the app shell get an isolated state rather than a module singleton. */
export function useEtatDecouverteIndicateurs(): EtatDecouverteIndicateurs {
  return inject(ETAT_DECOUVERTE_INDICATEURS_KEY, null) ?? creerEtatDecouverteIndicateurs()
}

function declarationForPage(
  resources: readonly SemanticResourceDeclaration[],
  theme: Theme,
  resourceKey: string,
): SemanticResourceDeclaration | undefined {
  return resources.find((resource) => presentationPageDepuisRessource(theme, resourceKey, resource) !== null)
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
