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

/** Presentation for an API-declared same-level scope; the type and scope kind come from that read. */
export function semanticComparisonScopeLabel(
  scope: { kind?: unknown; territory_type?: unknown } | null,
  targetType: string,
  publishedLabel?: string | null,
): string | null {
  if (publishedLabel) return publishedLabel
  if (scope?.kind !== 'same_level' || scope.territory_type !== targetType) return null
  if (targetType === 'epci') return comparisonScopeLabel('epcis-bretagne', null, null)
  if (targetType === 'departement') return comparisonScopeLabel('departements-bretagne', null, null)
  return null
}
