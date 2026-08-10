/**
 * The choropleth's class breaks — pure logic (TDD's meat). ADR-0019's rule of
 * three, computed from the VALUES — never a per-indicator spec:
 *
 * - Signed (min < 0 && max > 0) → a diverging ramp (type 'divergente'): the
 *   theme anchor at the positive pole, one shared counter-hue (coral) at the
 *   negative pole, the light neutral at zero, per-side tail-test buckets —
 *   each side spaces itself (log when its own p99/median > 10, quantiles
 *   otherwise) and sizes itself (4 buckets heavy / 3 tame).
 * - Heavy tail (p99/median > 10) → log-spaced sequential buckets (8 classes).
 * - Tame → linear/quantile sequential buckets (5 classes).
 *
 * SEUILS_INDICATEURS (the fixed per-indicator ladders) is deleted: the break
 * VALUES are the data's own, so the legend reads the real distribution —
 * Rennes at 4 582 hab/km² no longer shares a 300+ bucket with the 176–538
 * range, the log spacing gives the tail its own classes.
 */

export type TypeEchelle = 'divergente' | 'log' | 'lineaire'

export interface Echelle {
  type: TypeEchelle
  /** MapLibre `step` upper bounds, ascending. For 'divergente': the negative
   *  side's breaks first (most negative first), then the positive side's —
   *  the zero class sits between the innermost pair. */
  seuils: number[]
}

const NOMBRE_CLASSES_LOG = 8
const NOMBRE_CLASSES_LINEAIRE = 5
const BUCKETS_COTE_LOURDE = 4
const BUCKETS_COTE_DOUCE = 3

/**
 * The R-7 quantile of a sorted array (linear interpolation) — the same
 * interpolation `seuilsQuantiles` walks.
 */
function quantile(triees: readonly number[], q: number): number {
  if (triees.length === 1) return triees[0]
  const position = q * (triees.length - 1)
  const inf = Math.floor(position)
  const sup = Math.min(inf + 1, triees.length - 1)
  const fraction = position - inf
  return triees[inf] + (triees[sup] - triees[inf]) * fraction
}

/** The heavy-tail test (ADR-0019): p99/médiane > 10 — the signature of a
 *  distribution whose tail needs its own log-spaced classes. */
function estQueueLourde(valeurs: readonly number[]): boolean {
  const triees = valeurs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (triees.length < 3) return false
  const mediane = quantile(triees, 0.5)
  if (mediane <= 0) return true // une masse de zéros + une queue longue
  return quantile(triees, 0.99) / mediane > 10
}

/**
 * The rule of three over the VALUES (ADR-0019). Signed → diverging (per-side
 * tail-test buckets); heavy tail → log-spaced sequential; tame → quantiles.
 * Null/NA values are excluded (they never take a bucket).
 */
export function echelleValeurs(valeurs: readonly number[]): Echelle {
  const finis = valeurs.filter((v) => Number.isFinite(v))
  if (finis.length === 0) return { type: 'lineaire', seuils: [] }
  const min = Math.min(...finis)
  const max = Math.max(...finis)
  if (min < 0 && max > 0) {
    const negatifs = finis.filter((v) => v < 0).map((v) => -v)
    const positifs = finis.filter((v) => v > 0)
    const aLesDeux = new Set(negatifs).size >= 2 && new Set(positifs).size >= 2
    if (aLesDeux) {
      const seuilsNegatifs = seuilsCote(negatifs)
      const seuilsPositifs = seuilsCote(positifs)
      return {
        type: 'divergente',
        seuils: [...seuilsNegatifs.map((s) => -s).reverse(), ...seuilsPositifs],
      }
    }
  }
  if (max > 0 && estQueueLourde(finis)) {
    return { type: 'log', seuils: seuilsLogarithmiques(finis, NOMBRE_CLASSES_LOG) }
  }
  return { type: 'lineaire', seuils: seuilsQuantiles(finis, NOMBRE_CLASSES_LINEAIRE) }
}

/** One diverging side's breaks over its magnitudes (strictly positive): the
 *  side's own tail test sizes it (4 buckets heavy / 3 tame) and spaces it
 *  (log / quantiles). */
function seuilsCote(magnitudes: readonly number[]): number[] {
  if (magnitudes.length < 2) return []
  const estLog = estQueueLourde(magnitudes)
  const buckets = estLog ? BUCKETS_COTE_LOURDE : BUCKETS_COTE_DOUCE
  return estLog
    ? seuilsLogarithmiques(magnitudes, buckets + 1)
    : seuilsQuantiles(magnitudes, buckets + 1)
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
  if (triees.length <= nombreClasses) return triees.slice(1)
  const nbSeuils = nombreClasses - 1
  const seuils: number[] = []
  for (let k = 1; k <= nbSeuils; k++) {
    seuils.push(quantile(triees, k / nombreClasses))
  }
  return seuils
}

/**
 * Log-spaced breaks for `nombreClasses` buckets over the strictly positive
 * values: `nombreClasses - 1` upper bounds, evenly spaced in log space from
 * the smallest to the largest value — the geometric spacing that gives a
 * heavy tail its own classes. Values ≤ 0 are excluded (they fall in the
 * first class); with fewer distinct positives than classes, each distinct
 * value gets its own class.
 */
export function seuilsLogarithmiques(valeurs: readonly number[], nombreClasses: number): number[] {
  if (nombreClasses < 2) return []
  const positifs = [...new Set(valeurs.filter((v) => Number.isFinite(v) && v > 0))].sort(
    (a, b) => a - b,
  )
  if (positifs.length === 0) return []
  if (positifs.length <= nombreClasses) return positifs.slice(1)
  const nbSeuils = nombreClasses - 1
  const lnMin = Math.log(positifs[0])
  const lnMax = Math.log(positifs[positifs.length - 1])
  const pas = (lnMax - lnMin) / nombreClasses
  const seuils: number[] = []
  for (let k = 1; k <= nbSeuils; k++) {
    seuils.push(Math.exp(lnMin + k * pas))
  }
  return seuils
}
