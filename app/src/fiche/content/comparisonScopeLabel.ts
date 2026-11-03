import type { ComparisonScopeKind } from './territoryFacts'
import type { Territoire } from '@/payload/types'

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
    // neutre : un EPCI transfrontalier n'est pas entièrement breton (CONTEXT
    // « Partie bretonne d'un EPCI ») — jamais « EPCI bretons »
    case 'epcis-bretagne': return 'EPCI du périmètre de comparaison'
    case 'departements-bretagne': return 'départements bretons'
  }
}

const TYPE_NEUTRAL: Record<string, string> = {
  commune: 'communes',
  epci: 'EPCI',
  departement: 'départements',
  region: 'région',
}

/**
 * Presentation for an API-declared same-level scope; the type and scope kind
 * come from that read. The fallback wording is NEUTRAL and names the declared
 * scope only — never a spatial claim like « EPCI bretons », avoided by
 * CONTEXT.md (« Partie bretonne d'un EPCI » : un EPCI transfrontalier n'est
 * pas entièrement breton).
 */
export function semanticComparisonScopeLabel(
  scope: { kind?: unknown; territory_type?: unknown } | null,
  targetType: string,
  publishedLabel?: string | null,
): string | null {
  if (publishedLabel) return publishedLabel
  if (scope?.kind !== 'same_level' || scope.territory_type !== targetType) return null
  const typeWording = TYPE_NEUTRAL[targetType]
  return typeWording ? `même niveau territorial (${typeWording})` : null
}

/** Producer-declared scope of a native API comparison read (fixed_comparison /
 *  selected_comparison). The PUBLISHED label wins when the producer sends one;
 *  a density_class scope resolves through the validated territory reference's
 *  public density label ONLY when the codes match the acquired focal (a
 *  mismatch is rejected at the acquisition seam — never claimed here);
 *  same_level gets a NEUTRAL declared-scope wording (no spatial claim like
 *  « EPCI bretons », avoided by CONTEXT.md « Partie bretonne d'un EPCI »);
 *  an explicit_selection keeps the URL-scope fallback (the selection IS the
 *  listed universe). Null/missing target or unknown kind → null, never an
 *  invented label. */
export function apiComparisonScopeLabel(
  scope: {
    kind?: unknown
    territory_type?: unknown
    density_class_code?: unknown
    label?: unknown
    member_count?: unknown
  } | null | undefined,
  target: Pick<Territoire, 'type' | 'classe_densite_code' | 'classe_densite_libelle_public'> | null,
  selectionFallback: string | null,
): string | null {
  if (!scope) return null
  if (typeof scope.label === 'string' && scope.label) return scope.label
  if (scope.kind === 'explicit_selection') return selectionFallback
  if (!target) return null
  if (scope.kind === 'density_class' && scope.territory_type === 'commune' &&
      typeof scope.density_class_code === 'string' &&
      scope.density_class_code === target.classe_densite_code) {
    return target.classe_densite_libelle_public ?? null
  }
  // same_level : libellé neutre partagé (semanticComparisonScopeLabel), sans
  // aucune revendication spatiale
  return semanticComparisonScopeLabel(scope, target.type)
}
