import type { Territoire, TerritoireType } from '@/payload/types'
import type { LocationQuery } from 'vue-router'
import type { InjectionKey } from 'vue'
import type { Ref } from 'vue'
import { buildingScopeLabel, COMPARISON_MODE_DESCRIPTIONS } from '@/fiche/content/comparisonWording'
import { comparisonScopeLabel } from '@/fiche/content/comparisonScopeLabel'

export const PARAM_COMPARAISON = 'comparaison'

/**
 * Comparison-mode vocabulary, app-owned since the static runtime retirement
 * (#868): the per-territory model no longer publishes precomputed comparison
 * projections. The mode and its scope label are derived from the validated
 * territory reference (producer-published names and density labels); the
 * comparison meaning and evidence itself come from the native API contracts.
 */
export type TerritoryComparisonMode = 'densite' | 'epci' | 'bretagne'

export interface TerritoryComparisonFact {
  key: string
  detail: string | null
  sex: string | null
  dimension: string | null
  origin: 'indicator' | 'derived'
  direction: 'plus-est-mieux' | 'moins-est-mieux'
  rank: { position: number; size: number } | null
  reference: { kind: 'mean' | 'median'; value: number } | null
}

export interface TerritoryComparisonContext {
  mode: TerritoryComparisonMode
  scope: {
    kind:
      | 'communes-densite'
      | 'communes-epci'
      | 'communes-bretagne'
      | 'epcis-bretagne'
      | 'departements-bretagne'
    label: string
  }
  facts: TerritoryComparisonFact[]
  buildingDistribution: {
    label: string
    totalBuildings: number
    cells: Array<{
      breadthBucket: string
      depthBucket: string
      buildingCount: number
      share: number
    }>
  } | null
  accessRamp: {
    label: string
    totalBuildings: number
    points: Array<{
      mode: 'c' | 'b' | 't'
      quantile: number
      accessibleTypes: number
    }>
  } | null
}

/**
 * The comparison contexts a territory can select, derived from the validated
 * reference alone (#868): the density-class label is the commune's published
 * public label, the EPCI scope names its reference EPCI, and the Bretagne
 * scopes keep their canonical labels. No numerical fact is reconstructed here
 * — `facts` stays empty and all evidence comes from the native API reads.
 */
export function contextesDepuisReference(
  territoire: Territoire | null,
  territoires: readonly Territoire[],
): Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> {
  if (!territoire) return {}
  const contextes: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> = {}
  const vide = (): Pick<TerritoryComparisonContext, 'facts' | 'buildingDistribution' | 'accessRamp'> =>
    ({ facts: [], buildingDistribution: null, accessRamp: null })

  if (territoire.type === 'commune') {
    const labelDensite = territoire.classe_densite_libelle_public ?? territoire.classe_densite_libelle_insee ?? null
    if (labelDensite) {
      contextes.densite = { mode: 'densite', scope: { kind: 'communes-densite', label: labelDensite }, ...vide() }
    }
    if (territoire.epci) {
      const epci = territoires.find((candidate) => candidate.type === 'epci' && candidate.territoire === territoire.epci)
      const labelEpci = comparisonScopeLabel('communes-epci', null, epci?.nom ?? null)
      if (labelEpci) {
        contextes.epci = { mode: 'epci', scope: { kind: 'communes-epci', label: labelEpci }, ...vide() }
      }
    }
    const labelBretagne = comparisonScopeLabel('communes-bretagne', null, null)
    if (labelBretagne) {
      contextes.bretagne = { mode: 'bretagne', scope: { kind: 'communes-bretagne', label: labelBretagne }, ...vide() }
    }
    return contextes
  }
  if (territoire.type === 'epci' || territoire.type === 'departement') {
    const kind = territoire.type === 'epci' ? 'epcis-bretagne' : 'departements-bretagne'
    const label = comparisonScopeLabel(kind, null, null)
    if (label) {
      contextes.bretagne = { mode: 'bretagne', scope: { kind, label }, ...vide() }
    }
  }
  return contextes
}

export interface ResolutionContexteComparaison {
  /** Effective communal mode; other territory levels keep their own policy. */
  mode: TerritoryComparisonMode | null
  contexte: TerritoryComparisonContext | null
  /** Whether the invalid or unavailable query value must be removed. */
  canonicaliser: boolean
}

const MODES: readonly TerritoryComparisonMode[] = ['densite', 'epci', 'bretagne']

export interface OptionContexteComparaison {
  mode: TerritoryComparisonMode
  label: string
  description: string | null
}

export type PrésentationPortéeComparaison = 'territoires' | 'bâtiments'

export function libelleComparaisonBâtiments(
  rawLabel: string | null,
): string | null {
  if (!rawLabel) return null
  return buildingScopeLabel(rawLabel)
}

export const OPTIONS_COMPARAISON_KEY: InjectionKey<Readonly<Ref<readonly OptionContexteComparaison[]>>> =
  Symbol('options-contexte-comparaison')

/**
 * Expose the published comparison projections that a commune can select.
 * Availability belongs to the territory/read-model seam, not to the selector.
 */
export function optionsContexteComparaison(options: {
  territoire: Territoire | null
  contextes: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>>
}): readonly OptionContexteComparaison[] {
  const territoire = options.territoire
  if (!territoire || territoire.type !== 'commune') return []

  return MODES.flatMap((mode) => {
    const contexte = options.contextes[mode]
    if (!contexte || (mode === 'epci' && territoire.epci === null)) return []
    return [{
      mode,
      label: contexte.scope.label,
      description: COMPARISON_MODE_DESCRIPTIONS[mode] ?? null,
    }]
  })
}

/** Preserve the evidence's population grammar while reusing the canonical scope. */
export function libelleOptionComparaison(
  option: OptionContexteComparaison,
  présentation: PrésentationPortéeComparaison = 'territoires',
): string {
  if (présentation !== 'bâtiments') return option.label
  return libelleComparaisonBâtiments(option.label) ?? option.label
}

/** Keep the selected comparison mode when a graph opens another territory. */
export function queryTerritoireAvecComparaison(query: LocationQuery, theme: string): LocationQuery {
  return typeof query[PARAM_COMPARAISON] === 'string'
    ? { theme, [PARAM_COMPARAISON]: query[PARAM_COMPARAISON] }
    : { theme }
}

export interface TerritoireReferenceComparaison {
  type: TerritoireType
  id: string
  nom: string
}

/**
 * Resolve the single published reference territory behind a comparison mode.
 * AEDAR aggregates declare territories, never cohorts: 'epci' selects the
 * commune's EPCI and 'bretagne' the region, while a density-class cohort has
 * no single-territory reference and stays honestly unavailable. EPCI and
 * département levels keep the fixed Bretagne universe; the région has none.
 */
export function territoireReferencePourComparaison(options: {
  territoire: Territoire | null
  mode: TerritoryComparisonMode | null
  territoires: readonly Territoire[]
}): TerritoireReferenceComparaison | null {
  const { territoire, mode, territoires } = options
  if (!territoire) return null
  if (territoire.type === 'region') return null
  const referenceRegion = (): TerritoireReferenceComparaison | null => {
    const region = territoires.find((candidate) => candidate.type === 'region')
    return region ? { type: 'region', id: region.territoire, nom: region.nom } : null
  }
  if (territoire.type === 'commune') {
    if (mode === 'epci') {
      const epci = territoire.epci
        ? territoires.find((candidate) => candidate.type === 'epci' && candidate.territoire === territoire.epci)
        : undefined
      return epci ? { type: 'epci', id: epci.territoire, nom: epci.nom } : null
    }
    if (mode === 'bretagne') return referenceRegion()
    return null
  }
  return referenceRegion()
}

/**
 * Resolve the URL's comparison mode against the destination commune.
 *
 * The URL carries a mode, never a frozen peer list. The read model therefore
 * supplies the destination-relative projection and this seam only decides
 * which already-published projection is allowed to cross into content.
 */
export function resoudreContexteComparaison(options: {
  territoire: Territoire | null
  demande: unknown
  contextes: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>>
}): ResolutionContexteComparaison {
  const { territoire, demande, contextes } = options
  if (!territoire) {
    return { mode: null, contexte: null, canonicaliser: demande !== undefined }
  }
  if (territoire.type === 'epci' || territoire.type === 'departement') {
    // These levels keep one fixed Bretagne comparison universe. They do not
    // accept a communal URL mode, but their read models still publish the
    // precomputed context needed to render comparison references.
    return {
      mode: null,
      contexte: contextes.bretagne ?? null,
      canonicaliser: demande !== undefined,
    }
  }
  if (territoire.type === 'region') {
    return { mode: null, contexte: null, canonicaliser: demande !== undefined }
  }

  const densite = contextes.densite ?? null
  if (demande === undefined) {
    return { mode: 'densite', contexte: densite, canonicaliser: false }
  }

  if (typeof demande !== 'string' || !MODES.includes(demande as TerritoryComparisonMode)) {
    return { mode: 'densite', contexte: densite, canonicaliser: true }
  }

  const mode = demande as TerritoryComparisonMode
  const contexte = contextes[mode] ?? null
  const disponible = mode !== 'epci' || territoire.epci !== null

  // Density is the canonical mode even when an individual projection is
  // incomplete. Other unavailable modes must not silently fall back to the
  // legacy EPCI/Bretagne calculation: they resolve to the published density
  // projection and are removed from the URL.
  if (mode !== 'densite' && (!disponible || contexte === null)) {
    return { mode: 'densite', contexte: densite, canonicaliser: true }
  }

  return { mode, contexte, canonicaliser: false }
}
