import type { TerritoryComparisonContext, TerritoryComparisonMode } from '@/payload/territoryReadModel'
import type { Territoire } from '@/payload/types'
import type { LocationQuery } from 'vue-router'
import type { InjectionKey } from 'vue'
import type { Ref } from 'vue'
import { buildingScopeLabel, COMPARISON_MODE_DESCRIPTIONS } from '@/fiche/content/comparisonWording'

export const PARAM_COMPARAISON = 'comparaison'

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
