/**
 * The choropleth's class breaks — pure logic (TDD's meat). Two sources:
 *
 * - Per-indicator FIXED scales (SEUILS_INDICATEURS) — the audit's item 58:
 *   each indicator carries its OWN sensible class breaks in its own unit
 *   (densité in hab/km², part de passoires as a fraction), never a shared
 *   default. The break VALUES are the map's contract — they read in the
 *   legend, so color is never the sole carrier (DESIGN.md §8).
 *
 * - Quantile breaks (seuilsQuantiles) — the honest generic fallback for an
 *   indicator without a locked scale yet (the legacy map used the same
 *   quantile philosophy).
 */

export const SEUILS_INDICATEURS: Readonly<Record<string, readonly number[]>> = {
  // Densité (hab/km²) — the INSEE density ladder, rounded to read in the legend.
  densite: [30, 60, 100, 300],
  // Part de passoires thermiques — a fraction in [0,1] (unit %) — the DPE
  // passoire line: 10 %, 17 % (seuil passoire F/G), 25 %, 35 %.
  part_passoires: [0.1, 0.17, 0.25, 0.35],
}

/**
 * The choropleth breaks for an indicator: its fixed scale when the indicator
 * has one locked, otherwise quantiles over the actual values (the generic
 * fallback). MapLibre `step` upper bounds — value < seuils[0] → classe 1, etc.
 */
export function seuilsIndicateur(indicateur: string, valeurs: readonly number[], nombreClasses: number): number[] {
  const fixes = SEUILS_INDICATEURS[indicateur]
  if (fixes) return [...fixes]
  return seuilsQuantiles(valeurs, nombreClasses)
}

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
