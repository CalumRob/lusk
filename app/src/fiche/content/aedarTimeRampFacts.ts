import type { FactAvailability, FactProvenance } from './territoryFacts'
import type { AedarTimeRampEvidence } from './themeContent'

type Row = Record<string, unknown>
const horizons = [5, 10, 15, 20] as const
const modes = ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'] as const
const statistics = ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']
const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function invalid(): never { throw new Error('Réponse des agrégats AEDAR invalide') }

export interface AedarTimeRampOptions {
  territory: { type: string; id: string }
  mode: typeof modes[number]
  modeLabel: string
}

function rowProvenance(row: Row): FactProvenance {
  return { sourceId: row.source_id as string, source: row.source_id as string, version: row.vintage_id as string,
    referenceDate: row.reference_date as string | null, publicationDate: row.publication_date as string | null }
}

/** Validate the complete AEDAR type universe before deriving the two semantic time ramps. */
export function aedarTimeRampEvidence(response: unknown, options: AedarTimeRampOptions): AedarTimeRampEvidence[] {
  if (!isRecord(response) || !isRecord(response.territory) || !Array.isArray(response.facts) ||
      response.territory.territory_type !== options.territory.type || response.territory.territory_id !== options.territory.id ||
      !isText(response.content_version) || !isText(response.reference_content_version) ||
      !Number.isInteger(response.limit) || !Number.isInteger(response.offset) || response.offset !== 0 ||
      response.facts.length >= (response.limit as number) || !response.facts.length || !modes.includes(options.mode) || !isText(options.modeLabel)) invalid()
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
  const build = (rampKey: 'diversity' | 'count-per-type'): AedarTimeRampEvidence => {
    const statistic = rampKey === 'diversity' ? 'share' : 'mean'
    const territory = horizons.map((horizon) => {
      const values = parsed.map((row) => row.measures![`count_${horizon}_${options.mode}_${statistic}`])
      // Never publish a partial universe aggregate or silently coerce missing measures to zero.
      if (values.some((value) => value === null)) return null
      const numeric = values as number[]
      return rampKey === 'diversity'
        ? numeric.reduce((sum, value) => sum + value, 0)
        : numeric.reduce((sum, value) => sum + value, 0) / numeric.length
    })
    const availability: FactAvailability = territory.every((value) => value !== null) ? 'complete' : 'incomplete'
    return { kind: 'aedar-time-ramp', rampKey,
      xAxis: { values: horizons, labels: horizons.map((value) => `${value} min`), unit: 'minutes', label: 'Temps d’accès' },
      yAxis: rampKey === 'diversity' ? { label: 'Types d’équipements', unit: '' } : { label: 'Équipements par type', unit: 'équipements / type' },
      series: { territory, reference: null }, highlightedHorizon: 15, mode: options.mode, modeLabel: options.modeLabel,
      availability, provenance, sourceCoverage: 'complete' }
  }
  return [build('diversity'), build('count-per-type')]
}
