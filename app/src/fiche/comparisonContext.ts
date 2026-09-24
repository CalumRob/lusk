import type { TerritoryComparisonContext, TerritoryComparisonMode } from '@/payload/territoryReadModel'
import type { Territoire } from '@/payload/types'
import type { LocationQuery } from 'vue-router'

export const PARAM_COMPARAISON = 'comparaison'

export interface ResolutionContexteComparaison {
  /** Effective communal mode; other territory levels keep their own policy. */
  mode: TerritoryComparisonMode | null
  contexte: TerritoryComparisonContext | null
  /** Whether the invalid or unavailable query value must be removed. */
  canonicaliser: boolean
}

const MODES: readonly TerritoryComparisonMode[] = ['densite', 'epci', 'bretagne']

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
  if (!territoire || territoire.type !== 'commune') {
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
