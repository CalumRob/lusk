/**
 * The fiche's lean identity/reference bootstrap (#868).
 *
 * The fiche no longer fetches the bulky per-territory numerical read model
 * (`/data/modeles-lecture/territoires/{type}/{id}.json`). Its validated
 * identity and navigation come from the compact generated territory reference
 * (`/data/territoires.json`) — the target row plus the full reference table,
 * which keeps enough identities for hierarchy, navigation and comparison
 * joins. Every numerical fact is API-only (acquisition par thème, #627/#851);
 * this module owns no theme facts, no comparisons and no metadata.
 *
 * Identity failure (unknown type, or a target absent from the reference, or a
 * type mismatch) is a page-level typed `PayloadError` — never a silent empty
 * fiche. The reference is fetched once per session and validated as one
 * atomic unit.
 */

import { computed, inject, ref, watch } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import type { Territoire, TerritoireType } from './types'
import { PayloadError, validerTerritoires } from './validate'

export const TYPES_TERRITOIRE: readonly TerritoireType[] = [
  'commune',
  'epci',
  'departement',
  'region',
]

/** The minimal Response surface the reference charger needs (fetch() satisfies it). */
export interface ReponseFetchReference {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface OptionsReference {
  /** Base of the /data/ hosting — defaults to '/data/' (nginx alias, self-hosting.md). */
  baseUrl?: string
  /** Injected for tests; defaults to the real fetch. */
  fetchImpl?: (url: string) => Promise<ReponseFetchReference>
}

export type ChargerReferenceTerritoires = (options?: OptionsReference) => Promise<Territoire[]>

export const TERRITORY_REFERENCE_CHARGER_KEY: InjectionKey<ChargerReferenceTerritoires> =
  Symbol('territory-reference-charger')

export const FICHIER_REFERENCE = 'territoires.json'

let referenceEnCours: Promise<Territoire[]> | null = null
let referenceFetcher: ((url: string) => Promise<ReponseFetchReference>) | null = null

/**
 * Fetch + validate the compact generated territory reference. One fetch per
 * session per fetcher identity — the same session-cache rule as the semantic
 * catalogue, so a test that installs a different fetch never reuses another
 * test's reference.
 */
export const chargerReferenceTerritoires: ChargerReferenceTerritoires = (options = {}) => {
  const baseUrl = options.baseUrl ?? '/data/'
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url))
  if (fetchImpl !== referenceFetcher) {
    referenceFetcher = fetchImpl
    referenceEnCours = null
  }
  if (!referenceEnCours) {
    const url = `${baseUrl}${FICHIER_REFERENCE}`
    referenceEnCours = (async () => {
      let reponse: ReponseFetchReference
      try {
        reponse = await fetchImpl(url)
      } catch (cause) {
        throw new PayloadError(
          'fetch',
          FICHIER_REFERENCE,
          `Impossible de charger ${url} : ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
      if (!reponse.ok) {
        throw new PayloadError('fetch', FICHIER_REFERENCE, `Réponse HTTP ${reponse.status} pour ${url}`)
      }
      let brut: unknown
      try {
        brut = await reponse.json()
      } catch {
        throw new PayloadError('fetch', FICHIER_REFERENCE, `JSON illisible dans ${url}`)
      }
      return validerTerritoires(brut, FICHIER_REFERENCE)
    })().catch((error: unknown) => {
      referenceEnCours = null
      throw error
    })
  }
  return referenceEnCours
}

/**
 * Resolve the requested route identity against the validated reference.
 * Throws the typed page-level error when the type is unknown or the target
 * is absent / mistyped — identity failure is never an empty render.
 */
export function territoireDemande(
  reference: readonly Territoire[],
  type: string,
  territoire: string,
): Territoire {
  if (!TYPES_TERRITOIRE.includes(type as TerritoireType)) {
    throw new PayloadError(
      'validation',
      FICHIER_REFERENCE,
      `Type de territoire inconnu « ${type} »`,
    )
  }
  const cible = reference.find(
    (candidate) => candidate.territoire === territoire && candidate.type === (type as TerritoireType),
  )
  if (!cible) {
    throw new PayloadError(
      'validation',
      FICHIER_REFERENCE,
      `Territoire « ${type}/${territoire} » absent de la référence`,
    )
  }
  return cible
}

export interface EtatReferenceTerritoire {
  /** The validated compact reference — identity, hierarchy, navigation, comparison joins. */
  reference: Ref<readonly Territoire[] | null>
  /** The requested territory once the reference has validated it. */
  territory: Ref<Territoire | null>
  erreur: Ref<PayloadError | null>
  chargement: Ref<boolean>
  recharger: () => void
}

/**
 * Route-scoped bootstrap: load the reference once, validate the requested
 * territory against it, and stay inert when the route is inactive. Mirrors the
 * former read-model composable's shape — same atomic identity boundary, minus
 * every numerical projection.
 */
export function useTerritoryReference(
  type: Ref<string>,
  territoire: Ref<string>,
  actif: Ref<boolean>,
): EtatReferenceTerritoire {
  const charger = inject(TERRITORY_REFERENCE_CHARGER_KEY, chargerReferenceTerritoires)
  const reference = ref<readonly Territoire[] | null>(null)
  const territory = ref<Territoire | null>(null)
  const erreur = ref<PayloadError | null>(null)
  const chargement = ref(false)
  let sequence = 0

  async function chargerCourant(): Promise<void> {
    const currentSequence = ++sequence
    reference.value = null
    territory.value = null
    erreur.value = null
    if (!actif.value) {
      chargement.value = false
      return
    }

    const currentType = type.value
    const currentTerritoire = territoire.value
    chargement.value = true
    try {
      const loaded = await charger()
      if (currentSequence !== sequence) return
      reference.value = loaded
      territory.value = territoireDemande(loaded, currentType, currentTerritoire)
    } catch (cause) {
      if (currentSequence !== sequence) return
      erreur.value =
        cause instanceof PayloadError
          ? cause
          : new PayloadError(
              'fetch',
              FICHIER_REFERENCE,
              'Impossible de charger la référence des territoires.',
            )
    } finally {
      if (currentSequence === sequence) chargement.value = false
    }
  }

  watch([type, territoire, actif], chargerCourant, { immediate: true })

  return {
    reference,
    territory,
    erreur,
    chargement: computed(() => chargement.value),
    recharger: () => void chargerCourant(),
  }
}
