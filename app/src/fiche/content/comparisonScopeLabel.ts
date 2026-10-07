import type { ComparisonScopeKind } from './territoryFacts'

/** Canonical public label for a comparison scope when the publication omits one. */
export function comparisonScopeLabel(
  kind: ComparisonScopeKind,
  publishedLabel: string | null | undefined,
  epciName: string | null | undefined,
): string | null {
  if (publishedLabel) return publishedLabel
  switch (kind) {
    case 'communes-densite': return null
    case 'communes-epci': return epciName ? `communes de ${epciName}` : 'communes de l’EPCI'
    case 'communes-bretagne': return 'communes bretonnes'
    case 'epcis-bretagne': return 'EPCI bretons'
    case 'departements-bretagne': return 'départements bretons'
  }
}
