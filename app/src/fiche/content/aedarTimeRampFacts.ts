import type { FactAvailability, FactProvenance } from './territoryFacts'
import type { AedarFact } from './aedarApiClient'
import type { AedarTerritorySummary } from './aedarApiClient'
import type { AedarEquipmentHorizon } from './aedarEquipmentBuckets'
import type { AedarEquipmentQuantileStatistic, AedarRampMode, AedarTimeRampEvidence } from './themeContent'

const horizons = [5, 10, 15, 20] as const
export const AEDAR_EQUIPMENT_QUANTILE_STATISTICS: readonly AedarEquipmentQuantileStatistic[] = [
  { key: 'min', label: 'Minimum', axisLabel: 'Min' },
  ...Array.from({ length: 9 }, (_, index) => ({
    key: `decile${index + 1}`,
    label: `Décile ${index + 1}`,
    axisLabel: `D${index + 1}`,
  })),
  { key: 'max', label: 'Maximum', axisLabel: 'Max' },
]

/**
 * The five normal access modes rendered as ramp lines, in legend order.
 * `transit_gain` is a net-difference reading, not an ordinary access mode.
 */
export const AEDAR_RAMP_MODES: readonly AedarRampMode[] = ['car', 'bike_lts2', 'bike_lts4', 'transit', 'walk']

/** Existing, legible first-view selection shared by AEDAR time figures. */
export const AEDAR_DEFAULT_VISIBLE_RAMP_MODES: readonly AedarRampMode[] = ['car', 'transit', 'bike_lts2']

/** Exact per-TYPEQU columns consumed by the profile and selected-equipment detail views. */
export const AEDAR_CORE_MEASURE_KEYS = [...new Set([5, 10, 15, 20].flatMap((horizon) =>
  ['car', 'bike_lts2', 'bike_lts4', 'transit', 'walk'].flatMap((mode) =>
    ['share', 'mean'].map((statistic) => `count_${horizon}_${mode}_${statistic}`))))]
/** API-declared registry-wide comparison identities mapped to the existing ramp measure columns. */
export const AEDAR_AGGREGATE_READING_MEASURES = Object.fromEntries(['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car']
  .flatMap((mode) => [5, 10, 15, 20].flatMap((horizon) => ['diversity', 'volume'].map((kind) => {
    const id = mode === 'car' && horizon === 15 ? (kind === 'diversity' ? 'meanDiversity' : 'meanVolume')
      : `${mode}${horizon}${kind === 'diversity' ? 'Diversity' : 'Volume'}`
    return [id, `count_${horizon}_${mode}_${kind === 'diversity' ? 'share' : 'mean'}`]
  })))) as Readonly<Record<string, string>>
export const AEDAR_AGGREGATE_READING_KEYS = Object.keys(AEDAR_AGGREGATE_READING_MEASURES)
/** Quantile columns consumed by the selected TYPEQU sandbox's current figures. */
export const AEDAR_EXPLORER_DETAIL_MEASURE_KEYS = [5, 10, 15, 20].flatMap((horizon) =>
  ['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) =>
    ['min', ...Array.from({ length: 9 }, (_, index) => `decile${index + 1}`), 'max']
      .map((statistic) => `count_${horizon}_${mode}_${statistic}`)))

export function toggleAedarRampModeSelection(
  selectedModes: readonly AedarRampMode[],
  mode: AedarRampMode,
): AedarRampMode[] {
  const selected = new Set(selectedModes)
  if (selected.has(mode)) selected.delete(mode)
  else selected.add(mode)
  return AEDAR_RAMP_MODES.filter((candidate) => selected.has(candidate))
}

export function readAedarCountMeasure(
  fact: AedarFact | null,
  horizon: AedarEquipmentHorizon,
  mode: AedarRampMode,
  statistic: string,
): number | null {
  const value = fact?.measures[`count_${horizon}_${mode}_${statistic}`]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export const AEDAR_RAMP_MODE_LABELS: Readonly<Record<AedarRampMode, string>> = {
  car: 'Voiture',
  bike_lts2: 'Vélo (LTS2)',
  bike_lts4: 'Vélo (LTS4)',
  transit: 'Transports en commun',
  walk: 'À pied',
}

/** Per-rampKey, per-mode territory values derived from one validated AEDAR response. */
export interface AedarTimeRampValues {
  rampKey: AedarTimeRampEvidence['rampKey']
  xAxis: AedarTimeRampEvidence['xAxis']
  yAxis: AedarTimeRampEvidence['yAxis']
  territory: Record<AedarRampMode, readonly (number | null)[]>
  availability: FactAvailability
  provenance: FactProvenance
}

function summaryProvenance(summary: AedarTerritorySummary): FactProvenance {
  const source = summary.provenance.sources[0]
  return { sourceId: source?.source_id ?? '', source: source?.source_id ?? '', version: source?.vintage_id ?? '',
    referenceDate: source?.reference_date ?? null, publicationDate: source?.publication_date ?? null }
}

/** Map producer-published aggregate readings to the existing ramp presentation; never sum TYPEQU facts. */
export function aedarTimeRampSummary(summary: AedarTerritorySummary): AedarTimeRampValues[] {
  const readings = new Map(summary.readings.map((reading) => [reading.measure, reading]))
  const measureByReading = new Map(Object.entries(AEDAR_AGGREGATE_READING_MEASURES).map(([reading, measure]) => [measure, reading]))
  const valuesFor = (rampKey: AedarTimeRampEvidence['rampKey']): Record<AedarRampMode, readonly (number | null)[]> => {
    const statistic = rampKey === 'diversity' ? 'share' : 'mean'
    const result = {} as Record<AedarRampMode, readonly (number | null)[]>
    for (const mode of AEDAR_RAMP_MODES) {
      result[mode] = horizons.map((horizon) => {
        const sourceMeasure = `count_${horizon}_${mode}_${statistic}`
        const reading = readings.get(measureByReading.get(sourceMeasure) ?? '')
        return reading?.status === 'available' && typeof reading.value === 'number' && Number.isFinite(reading.value)
          ? reading.value : null
      })
    }
    return result
  }
  const build = (rampKey: AedarTimeRampEvidence['rampKey']): AedarTimeRampValues => {
    const territory = valuesFor(rampKey)
    return {
      rampKey,
      xAxis: { values: horizons, labels: horizons.map((value) => `${value} min`), unit: 'minutes', label: 'Temps d’accès' },
      yAxis: rampKey === 'diversity' ? { label: 'Diversité de l’offre', unit: '' } : { label: 'Volume de l’offre', unit: '' },
      territory,
      availability: AEDAR_RAMP_MODES.every((mode) => territory[mode].every((value) => value !== null)) ? 'complete' : 'incomplete',
      provenance: summaryProvenance(summary),
    }
  }
  return [build('diversity'), build('volume')]
}
