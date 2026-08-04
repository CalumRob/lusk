/**
 * The choropleth's class breaks — pure logic (TDD's meat): quantile breaks so
 * the map's buckets carry roughly equal territory counts (the legacy map used
 * the same quantile philosophy). Each bucket's numeric range is also shown in
 * the legend — color is never the sole carrier (DESIGN.md §8).
 */

/**
 * Quantile breaks for `nombreClasses` buckets, as MapLibre `step` upper
 * bounds: value < seuils[0] → classe 1, seuils[0] ≤ value < seuils[1] →
 * classe 2, etc. Null/NA values are excluded (they never take a bucket).
 * With fewer distinct values than classes, each distinct value gets its own
 * class (the honest maximum granularity).
 */
export function seuilsQuantiles(valeurs: readonly number[], nombreClasses: number): number[] {
  if (nombreClasses < 2) return []
  const triees = [...new Set(valeurs.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b)
  if (triees.length === 0) return []
  // Distinct values ≤ classes → one class per value.
  if (triees.length <= nombreClasses) return triees.slice(1)
  const nbSeuils = nombreClasses - 1
  const seuils: number[] = []
  for (let k = 1; k <= nbSeuils; k++) {
    const position = (k / nombreClasses) * (triees.length - 1)
    const inf = Math.floor(position)
    const sup = Math.min(inf + 1, triees.length - 1)
    const fraction = position - inf
    seuils.push(triees[inf] + (triees[sup] - triees[inf]) * fraction)
  }
  return seuils
}
