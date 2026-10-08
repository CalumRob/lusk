import type { FactAvailability, FactProvenance } from './territoryFacts'
import type { AedarRampMode, AedarTimeRampEvidence } from './themeContent'

type Row = Record<string, unknown>
const horizons = [5, 10, 15, 20] as const
const modes = ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'] as const
const statistics = ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']
const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function invalid(): never { throw new Error('Réponse des agrégats AEDAR invalide') }

/**
 * The five normal access modes rendered as ramp lines, in legend order.
 * `transit_gain` is a net-difference reading, not an ordinary access mode.
 */
export const AEDAR_RAMP_MODES: readonly AedarRampMode[] = ['car', 'bike_lts4', 'bike_lts2', 'transit', 'walk']

export const AEDAR_RAMP_MODE_LABELS: Readonly<Record<AedarRampMode, string>> = {
  car: 'Voiture',
  bike_lts4: 'Vélo (LTS4)',
  bike_lts2: 'Vélo (LTS2)',
  transit: 'Transports en commun',
  walk: 'À pied',
}

export interface AedarTimeRampOptions {
  territory: { type: string; id: string }
}

/** Per-rampKey, per-mode territory values derived from one validated AEDAR response. */
export interface AedarTimeRampValues {
  rampKey: 'diversity' | 'count-per-type'
  xAxis: AedarTimeRampEvidence['xAxis']
  yAxis: AedarTimeRampEvidence['yAxis']
  territory: Record<AedarRampMode, readonly (number | null)[]>
  availability: FactAvailability
  provenance: FactProvenance
}

function rowProvenance(row: Row): FactProvenance {
  return { sourceId: row.source_id as string, source: row.source_id as string, version: row.vintage_id as string,
    referenceDate: row.reference_date as string | null, publicationDate: row.publication_date as string | null }
}

/** Validate the complete AEDAR type universe before deriving the two semantic time ramps, per mode. */
export function aedarTimeRampEvidence(response: unknown, options: AedarTimeRampOptions): AedarTimeRampValues[] {
  if (!isRecord(response) || !isRecord(response.territory) || !Array.isArray(response.facts) ||
      response.territory.territory_type !== options.territory.type || response.territory.territory_id !== options.territory.id ||
      !isText(response.content_version) || !isText(response.reference_content_version) ||
      !Number.isInteger(response.limit) || !Number.isInteger(response.offset) || response.offset !== 0 ||
      response.facts.length >= (response.limit as number) || !response.facts.length) invalid()
  const rows = response.facts as unknown[]
  const parsed: (Row & { measures: Record<string, unknown> })[] = []
  const typeIds = new Set<string>()
  for (const value of rows) {
    if (!isRecord(value) || value.territory_id !== options.territory.id || value.territory_type !== options.territory.type ||
        !isText(value.typequ) || typeIds.has(value.typequ) || !isText(value.source_id) || !isText(value.vintage_id) ||
        !isText(value.typequ_label) || !Number.isInteger(value.n_addresses) || !Number.isInteger(value.n_observed) ||
        value.coverage_status !== 'covered' || !isRecord(value.measures) ||
        !(value.reference_date === null || typeof value.reference_date === 'string') ||
        !(value.publication_date === null || typeof value.publication_date === 'string')) invalid()
    const keys = horizons.flatMap((horizon) => modes.flatMap((mode) => statistics.map((stat) => `count_${horizon}_${mode}_${stat}`)))
    const measures = value.measures
    if (Object.keys(measures).length !== 312 || keys.some((key) => !(key in measures)) ||
        keys.some((key) => measures[key] !== null && !isFinite(measures[key]))) invalid()
    typeIds.add(value.typequ)
    parsed.push(value as Row & { measures: Record<string, unknown> })
  }
  const first = parsed[0]!
  if (parsed.some((row) => row.source_id !== first.source_id || row.vintage_id !== first.vintage_id ||
      row.reference_date !== first.reference_date || row.publication_date !== first.publication_date)) invalid()
  const provenance = rowProvenance(first)
  const build = (rampKey: 'diversity' | 'count-per-type'): AedarTimeRampValues => {
    const statistic = rampKey === 'diversity' ? 'share' : 'mean'
    const seriesFor = (mode: AedarRampMode): readonly (number | null)[] => horizons.map((horizon) => {
      const cells = parsed.map((row) => row.measures![`count_${horizon}_${mode}_${statistic}`])
      // Never publish a partial universe aggregate or silently coerce missing measures to zero.
      if (cells.some((value) => value === null)) return null
      const numeric = cells as number[]
      return rampKey === 'diversity'
        ? numeric.reduce((sum, value) => sum + value, 0)
        : numeric.reduce((sum, value) => sum + value, 0) / numeric.length
    })
    const territory: Record<AedarRampMode, readonly (number | null)[]> = {
      car: seriesFor('car'),
      bike_lts4: seriesFor('bike_lts4'),
      bike_lts2: seriesFor('bike_lts2'),
      transit: seriesFor('transit'),
      walk: seriesFor('walk'),
    }
    const availability: FactAvailability = AEDAR_RAMP_MODES.every((mode) => territory[mode].every((value) => value !== null))
      ? 'complete'
      : 'incomplete'
    return {
      rampKey,
      xAxis: { values: horizons, labels: horizons.map((value) => `${value} min`), unit: 'minutes', label: 'Temps d’accès' },
      yAxis: rampKey === 'diversity' ? { label: 'Types d’équipements', unit: '' } : { label: 'Équipements par type', unit: 'équipements / type' },
      territory,
      availability,
      provenance,
    }
  }
  return [build('diversity'), build('count-per-type')]
}
