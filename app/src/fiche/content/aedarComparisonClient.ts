import type { AedarFact, AedarTerritoryType } from './aedarApiClient'
import type { MembreSelection } from '../comparisonContext'

export type AedarComparisonIntent =
  | { kind: 'selected_comparison'; members: readonly MembreSelection[] }
  | { kind: 'fixed_comparison'; context: 'density_class' | 'epci' | 'bretagne' | 'same_level' }

export interface AedarComparisonCell extends Omit<Pick<AedarFact, 'typequ' | 'source_id' | 'vintage_id' | 'reference_date' | 'publication_date'>, 'typequ'> {
  typequ: string | null
  measure: string
  group_value: number | null
  group_coverage_status: string | null
  group_n_addresses: number | null
  group_n_observed: number | null
  statistic: 'direct' | 'pooled'
  rank?: number | null
  rank_size?: number | null
  rank_ties?: number | null
  direction?: 'high' | 'low'
}
export interface AedarComparisonEvidence {
  label: string
  contentVersion: string
  referenceContentVersion: string
  cells: readonly AedarComparisonCell[]
}
export interface AedarComparisonRequest {
  intent: AedarComparisonIntent
  label: string
}
export type AedarComparisonResult = { status: 'ready'; evidence: AedarComparisonEvidence }
  | { status: 'error'; message: string }
type ComparisonReadOptions = AedarComparisonRequest & { typequ: readonly string[]; measures: readonly string[];
  expectedContentVersion: string; expectedReferenceContentVersion: string; signal?: AbortSignal }
const successfulReads = new WeakMap<typeof fetch, Map<string, Extract<AedarComparisonResult, { status: 'ready' }>>>()
const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const nonempty = (x: unknown): x is string => typeof x === 'string' && x.length > 0
function invalid(): never { throw new Error('Comparaison AEDAR incompatible ou incomplète') }

/** Read only comparison evidence. Focal observations remain owned by the facts read.
 * Small cell partitions bound both selected-member work and serialized output;
 * all partitions must bind to the displayed facts and the same comparison publication.
 */
export async function fetchAedarComparison(type: AedarTerritoryType, id: string,
  options: ComparisonReadOptions,
): Promise<AedarComparisonResult> {
  const fetcher = globalThis.fetch
  let cache = successfulReads.get(fetcher)
  if (!cache) { cache = new Map(); successfulReads.set(fetcher, cache) }
  const key = JSON.stringify([type, id, options.intent, options.label, options.typequ, options.measures,
    options.expectedContentVersion, options.expectedReferenceContentVersion])
  const cached = cache.get(key)
  if (cached) { cache.delete(key); cache.set(key, cached); return cached }
  const result = await readAedarComparison(fetcher, type, id, options)
  if (result.status === 'ready' && !options.signal?.aborted) {
    cache.set(key, result)
    while (cache.size > 8) cache.delete(cache.keys().next().value!)
  }
  return result
}

async function readAedarComparison(fetcher: typeof fetch, type: AedarTerritoryType, id: string,
  options: ComparisonReadOptions,
): Promise<AedarComparisonResult> {
  try {
    const selected = options.intent.kind === 'selected_comparison'
    const members = options.intent.kind === 'selected_comparison' ? options.intent.members : null
    const aggregate = options.typequ.length === 0 && options.measures.every((measure) => measure === 'meanDiversity' || measure === 'meanVolume'
      || /^(?:walk|transit|bike_lts2|bike_lts4|car)(?:5|10|15|20)(?:Diversity|Volume)$/.test(measure))
    if (!options.measures.length || (!aggregate && !options.typequ.length) || members?.length === 0) invalid()
    const intent = options.intent.kind === 'selected_comparison'
      ? { kind: 'selected_comparison', members: options.intent.members.map((m) => ({ type: m.territory_type, id: m.territory_id })) }
      : options.intent
    // Selected reads support a matrix; fixed reads declare one cell per item.
    const cellBudget = selected && !aggregate ? Math.max(1, Math.min(100, Math.floor(400 / options.measures.length),
      Math.floor(20000 / Math.max(1, members!.length)))) : 1
    const items: Array<{ id: string; resource: string; target: { kind: string; type: AedarTerritoryType; id: string };
      coordinates: { typequ?: string[]; measure: string[] }; intent: typeof intent; fields: string[] }> = []
    const measureGroups = selected ? [options.measures] : options.measures.map((measure) => [measure])
    for (const measures of measureGroups) for (let start = 0; start < (aggregate ? 1 : options.typequ.length); start += cellBudget) {
      items.push({ id: `aedar-comparison-${items.length}`, resource: 'aedar_territorial_aggregate',
        target: { kind: 'territory', type, id }, coordinates: { ...(aggregate ? {} : { typequ: options.typequ.slice(start, start + cellBudget) }), measure: [...measures] },
        intent, fields: aggregate ? ['group_value', 'rank', 'rank_size', 'rank_ties'] : selected ? ['group_value', 'rank', 'rank_size', 'rank_ties'] : ['group_value'] })
    }
    const cells: AedarComparisonCell[] = []
    let comparisonVersion: string | undefined
    // Keep batches small enough even for large selections (preflight work counts
    // members × cells). Read-batch items are stateless, so issue every batch
    // concurrently and publish only after the complete set validates.
    const batchSize = aggregate ? items.length : selected ? Math.max(1, Math.min(8, Math.floor(80000 / Math.max(1, members!.length * cellBudget)))) : 12
    const batches = Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) =>
      items.slice(index * batchSize, (index + 1) * batchSize))
    const responses = await Promise.all(batches.map(async (batch) => {
      const response = await fetcher('/api/resources/read-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }), signal: options.signal })
      if (!response.ok) {
        const error: unknown = await response.json().catch(() => null)
        throw new Error(record(error) && typeof error.detail === 'string' ? error.detail : 'Comparaison AEDAR indisponible')
      }
      const body: unknown = await response.json()
      if (!record(body) || body.contract !== 'semantic-read-batch-v1' || !Array.isArray(body.results) || body.results.length !== batch.length) invalid()
      return { batch, body: body as Record<string, unknown> }
    }))
    for (const { batch, body } of responses) {
      const seen = new Set<string>()
      for (const result of body.results as unknown[]) {
        if (!record(result) || typeof result.id !== 'string' || seen.has(result.id)) invalid()
        seen.add(result.id)
        const item = batch.find((item) => item.id === result.id)
        const data = result.data
        if (!item || !record(data) || data.resource !== item.resource || !record(data.target)
          || data.target.kind !== 'territory' || data.target.type !== type || data.target.id !== id
          || !nonempty(data.content_version) || data.aedar_content_version !== options.expectedContentVersion
          || data.reference_content_version !== options.expectedReferenceContentVersion
          || (comparisonVersion !== undefined && data.content_version !== comparisonVersion)) invalid()
        comparisonVersion = data.content_version
        if (members && (!record(data.scope) || data.scope.kind !== 'explicit_selection' || data.scope.member_count !== members.length
          || JSON.stringify(data.selection) !== JSON.stringify(members))) invalid()
        const rows = selected ? data.comparisons : [data.comparison]
          const expectedRows = (item.coordinates.typequ?.length ?? 1) * item.coordinates.measure.length
          if (!Array.isArray(rows) || rows.length !== expectedRows) invalid()
        const returned = new Set<string>()
        for (const row of rows) {
           if (!record(row) || (aggregate ? row.typequ !== null : typeof row.typequ !== 'string' || !item.coordinates.typequ!.includes(row.typequ as string))
             || typeof row.measure !== 'string' || !item.coordinates.measure.includes(row.measure) || returned.has(`${row.typequ ?? ''}/${row.measure}`)
            || row.comparison_context !== (options.intent.kind === 'selected_comparison' ? 'selected_comparison' : options.intent.context)
            || (row.statistic !== 'direct' && row.statistic !== 'pooled') || (selected && row.statistic !== 'pooled')
            || !(row.group_value === null || finite(row.group_value))
             || (aggregate
               ? !((row.group_n_addresses === null || (Number.isInteger(row.group_n_addresses) && (row.group_n_addresses as number) >= 0))
                 && (row.group_n_observed === null || (Number.isInteger(row.group_n_observed) && (row.group_n_observed as number) >= 0))
                 && (row.group_value === null || (Number.isInteger(row.group_n_addresses) && (row.group_n_addresses as number) > 0)))
               : !Number.isInteger(row.group_n_addresses) || (row.group_n_addresses as number) <= 0
                 || !Number.isInteger(row.group_n_observed) || (row.group_n_observed as number) < 0
                 || (row.group_n_observed as number) > (row.group_n_addresses as number))
            || !(row.group_coverage_status === null || typeof row.group_coverage_status === 'string')
            || !nonempty(row.source_id) || !nonempty(row.vintage_id)
            || !(row.reference_date === null || typeof row.reference_date === 'string')
            || !(row.publication_date === null || typeof row.publication_date === 'string')) invalid()
          if (selected || aggregate) {
            const rank = [row.rank, row.rank_size, row.rank_ties]
            if (selected && row.direction !== 'high' && row.direction !== 'low') invalid()
            if (aggregate && rank.some((x) => x !== null && !Number.isInteger(x))) invalid()
            if (!rank.every((x) => x === null) && (!rank.every((x) => Number.isInteger(x) && (x as number) > 0)
              || (row.rank as number) + (row.rank_ties as number) - 1 > (row.rank_size as number)
              || (selected && ((row.rank_size as number) > members!.length
              || !members!.some((m) => m.territory_type === type && m.territory_id === id))))) invalid()
          }
           returned.add(`${row.typequ ?? ''}/${row.measure}`)
          cells.push(row as unknown as AedarComparisonCell)
        }
      }
    }
    return { status: 'ready', evidence: { label: options.label, contentVersion: options.expectedContentVersion,
      referenceContentVersion: options.expectedReferenceContentVersion, cells } }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Comparaison AEDAR indisponible' }
  }
}

/** A missing/unknown coverage or a mismatched source clock is not comparable evidence. */
const cellIndexes = new WeakMap<AedarComparisonEvidence, Map<string, AedarComparisonCell>>()
export function aedarComparisonCell(evidence: AedarComparisonEvidence | null | undefined, typequ: string | undefined,
  measure: string): AedarComparisonCell | undefined {
  if (!evidence) return undefined
  let index = cellIndexes.get(evidence)
  if (!index) {
    index = new Map(evidence.cells.map((cell) => [`${cell.typequ ?? ''}/${cell.measure}`, cell]))
    cellIndexes.set(evidence, index)
  }
  return index.get(`${typequ ?? ''}/${measure}`)
}
export function aedarGroupValue(evidence: AedarComparisonEvidence | null | undefined, fact: AedarFact | null | undefined,
  measure: string): number | null {
  const cell = aedarComparisonCell(evidence, fact?.typequ, measure)
  return cell && fact && cell.group_coverage_status === 'covered'
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const).every((key) => cell[key] === fact[key])
    ? cell.group_value : null
}

/** Registry-wide aggregate evidence is returned by the producer without a TYPEQU coordinate. */
export function aedarAggregateComparisonCell(evidence: AedarComparisonEvidence | null | undefined,
  measure: string): AedarComparisonCell | undefined {
  return aedarComparisonCell(evidence, undefined, measure)
}
