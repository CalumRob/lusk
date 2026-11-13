/**
 * App-owned comparison demand identities for the Mobilité page-2 network
 * figure (#954/#960) and its owner-approved equal-weight mean statistic
 * (#979/#996/#997, ADR-0045).
 *
 * These are presentation choices, never producer facts: the listed detail
 * points are the ones the network figure draws, and the same resources are the
 * detail-backed declared profiles whose compared values are served as
 * equal-weight commune means. Every other figure/theme keeps its own declared
 * statistic (median by default).
 */
export const DECLARED_DETAIL_COMPARISON_RESOURCES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  mobilite: {
    reseaux_par_habitant: ['t_km_1000', 'b_km_1000', 'c_km_1000'],
    reseaux: ['t_longueur', 'b_longueur', 'c_longueur'],
    offre_cyclable: ['protege_longueur', 'partage_longueur', 'protege_km_1000', 'partage_km_1000'],
  },
}

/**
 * The detail-backed declared profiles whose selected comparison is requested
 * with `statistic: "mean"`. Derived from the one network detail map so a new
 * drawn detail point cannot silently keep a median comparison.
 */
export function meanComparisonResources(theme: string): readonly string[] {
  return Object.keys(DECLARED_DETAIL_COMPARISON_RESOURCES[theme] ?? {})
}
