import type { AedarFact } from './aedarApiClient'

export const AEDAR_EQUIPMENT_BUCKET_THRESHOLD = 0.25
export const AEDAR_EQUIPMENT_BUCKET_HORIZONS = [5, 10, 15, 20] as const
export const AEDAR_EQUIPMENT_BUCKET_ORDER = ['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car', 'inaccessible'] as const

/** Canonical AEDAR mode semantics shared by classification and its figure. */
export const AEDAR_EQUIPMENT_MODES = [
  { key: 'walk', label: 'À pied', tableLabel: 'À pied' },
  { key: 'transit', label: 'Transports en commun', tableLabel: 'Transports en commun' },
  { key: 'bike_lts2', label: 'Vélo (LTS2)', tableLabel: 'Vélo LTS2' },
  { key: 'bike_lts4', label: 'Vélo (LTS4)', tableLabel: 'Vélo LTS4' },
  { key: 'car', label: 'Voiture', tableLabel: 'Voiture' },
] as const

export type AedarEquipmentModeKey = typeof AEDAR_EQUIPMENT_MODES[number]['key']
export function aedarEquipmentShareMeasureKey(horizonMinutes: number, mode: AedarEquipmentModeKey): string {
  return `count_${horizonMinutes}_${mode}_share`
}

export type AedarEquipmentBucketKey = typeof AEDAR_EQUIPMENT_BUCKET_ORDER[number]
export interface AedarEquipmentType { typequ: string; label: string }
export interface AedarEquipmentBucket {
  key: AedarEquipmentBucketKey
  label: string
  types: readonly AedarEquipmentType[]
  count: number
}
export interface AedarEquipmentBuckets {
  status: 'complete' | 'incomplete'
  horizonMinutes: typeof AEDAR_EQUIPMENT_BUCKET_HORIZONS[number]
  threshold: number
  buckets: readonly AedarEquipmentBucket[]
}

const labels: Readonly<Record<AedarEquipmentBucketKey, string>> = {
  ...Object.fromEntries(AEDAR_EQUIPMENT_MODES.map(({ key, label }) => [key, label])) as Record<AedarEquipmentModeKey, string>,
  inaccessible: 'Inaccessible',
}

/** Assign each source TYPEQU once, using first-match order and source-owned identity/labels. */
export function classifyAedarEquipmentTypes(
  facts: readonly AedarFact[],
  options: { horizonMinutes: typeof AEDAR_EQUIPMENT_BUCKET_HORIZONS[number]; threshold?: number },
): AedarEquipmentBuckets {
  const threshold = options.threshold ?? AEDAR_EQUIPMENT_BUCKET_THRESHOLD
  if (!AEDAR_EQUIPMENT_BUCKET_HORIZONS.includes(options.horizonMinutes) || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Horizon AEDAR ou seuil invalide')
  }
  if (facts.length === 0) return { status: 'incomplete', horizonMinutes: options.horizonMinutes, threshold, buckets: [] }

  const seen = new Set<string>()
  for (const fact of facts) {
    if (!fact.typequ || !fact.typequ_label || seen.has(fact.typequ)) throw new Error('Identité TYPEQU invalide ou dupliquée')
    seen.add(fact.typequ)
  }

  const assigned: Record<AedarEquipmentBucketKey, AedarEquipmentType[]> = {
    walk: [], transit: [], bike_lts2: [], bike_lts4: [], car: [], inaccessible: [],
  }
  for (const fact of facts) {
    const shares = AEDAR_EQUIPMENT_MODES.map(({ key }) => fact.measures[aedarEquipmentShareMeasureKey(options.horizonMinutes, key)])
    // Unknown evidence is not zero and must not be classified as inaccessible.
    if (shares.some((share) => typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1)) {
      return { status: 'incomplete', horizonMinutes: options.horizonMinutes, threshold, buckets: [] }
    }
    const match = AEDAR_EQUIPMENT_MODES.find((_, index) => (shares[index] as number) >= threshold)
    assigned[match?.key ?? 'inaccessible'].push({ typequ: fact.typequ, label: fact.typequ_label })
  }

  return {
    status: 'complete',
    horizonMinutes: options.horizonMinutes,
    threshold,
    buckets: AEDAR_EQUIPMENT_BUCKET_ORDER.map((key) => ({ key, label: labels[key], types: assigned[key], count: assigned[key].length })),
  }
}
