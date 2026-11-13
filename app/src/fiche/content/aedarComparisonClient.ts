import type { AedarFact, AedarTerritoryType } from './aedarApiClient'
import type { MembreSelection, PresetComparaison, SelectionComparaison } from '../comparisonContext'
import type { ComparisonRank } from './territoryFacts'
import { producerCatalogue } from '@/payload/themeAcquisition'
import { readSemanticOutcomes, SemanticReadDeferredError } from '@/payload/semanticResourceClient'
import type { SemanticReadItem } from '@/payload/semanticResourceClient'
import { RANK_DISPLAY_MIN_SIZE } from '../figureGrammaire'
import { AEDAR_AGGREGATE_READING_KEYS } from './aedarTimeRampFacts'

export type AedarComparisonIntent =
  | { kind: 'selected_comparison'; members: readonly MembreSelection[] }
  | { kind: 'fixed_comparison'; context: 'density_class' | 'epci' | 'bretagne' | 'same_level' }

/**
 * Resolve one typed AEDAR comparison intent from the resolved Sélection. The
 * API declares `epci` and `bretagne` for communes only; for an EPCI or a
 * département the direct Bretagne universe is the existing `same_level`
 * context (the published Région aggregate over peer populations of the focal
 * level). The Région has no comparison, and explicit typed members are always
 * preserved verbatim. No default group or new policy is invented here.
 */
export function aedarComparisonIntent(options: {
  territoryType: AedarTerritoryType
  selection: SelectionComparaison | null | undefined
  presetDefaut: PresetComparaison | null | undefined
}): AedarComparisonIntent | null {
  const { territoryType, selection, presetDefaut } = options
  if (!selection || selection.etat === 'vide') return null
  if (selection.etat === 'membres') {
    return selection.membres.length
      ? { kind: 'selected_comparison', members: selection.membres } : null
  }
  const preset = selection.etat === 'preset' ? selection.preset : presetDefaut
  if (!preset || territoryType === 'region') return null
  if (territoryType === 'commune') {
    const context = preset === 'densite' ? 'density_class'
      : preset === 'epci' ? 'epci' : 'bretagne'
    return { kind: 'fixed_comparison', context }
  }
  return preset === 'bretagne' ? { kind: 'fixed_comparison', context: 'same_level' } : null
}

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
  /** Present only for aggregate comparisons served from the summary publication. */
  summaryContentVersion?: string
  aedarContentVersion?: string
  cells: readonly AedarComparisonCell[]
}
export interface AedarComparisonRequest {
  intent: AedarComparisonIntent
  label: string
}
export type AedarComparisonResult = { status: 'ready'; evidence: AedarComparisonEvidence }
  | { status: 'error'; message: string }
  /** #1002 — the read was intentionally not started: the chapter demand left. */
  | { status: 'deferred' }
type ComparisonReadOptions = AedarComparisonRequest & { typequ: readonly string[]; measures: readonly string[];
  expectedContentVersion: string; expectedReferenceContentVersion: string; signal?: AbortSignal;
  /** Aggregate comparisons bind to all three summary/source/reference clocks. */
  expectedSummaryContentVersion?: string
  /**
   * Explicit retry: never replay a settled read for this demand. A newer
   * generation is opened, so a late reply from the abandoned read can never
   * repopulate it.
   */
  fresh?: boolean }

const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const nonempty = (x: unknown): x is string => typeof x === 'string' && x.length > 0
const RANK_FIELD_NAMES = ['rank', 'rank_size', 'rank_ties'] as const
function invalid(): never { throw new Error('Comparaison AEDAR incompatible ou incomplète') }
/** Producer-served ranks are all-or-nothing: three integers, or three nulls for
 * an unranked facet or an unavailable focal. Nothing is derived from the value.
 *
 * A singleton eligible population is valid evidence: when only the focal
 * publishes a cell the producer serves 1/1, so `rank_size` is bounded below by
 * 1 here. Hiding a rank that has nothing to position against is the display
 * helper's job, not a reason to fail the whole read.
 */
function servedRank(row: Record<string, unknown>): readonly [number, number, number] | null {
  const values = RANK_FIELD_NAMES.map((field) => row[field])
  if (values.some((value) => value === undefined)) invalid()
  if (values.every((value) => value === null)) return null
  if (!values.every((value) => Number.isInteger(value))) invalid()
  const [position, size, ties] = values as [number, number, number]
  if (position < 1 || size < 1 || ties < 1 || position + ties - 1 > size) invalid()
  return [position, size, ties]
}

/** Read only comparison evidence. Focal observations remain owned by the facts read.
 * Small cell partitions bound both selected-member work and serialized output;
 * all partitions must bind to the displayed facts and the same comparison publication.
 *
 * #1002 — one comparison is a set of semantic items; the shared client owns
 * their identity, coalescing, settled reuse and generation fences. The
 * presentation `label` is deliberately NOT part of that identity: naming the
 * same published group differently is the same numerical read, while a changed
 * territory, group, coordinates or publication clock is a different one.
 */
export async function fetchAedarComparison(type: AedarTerritoryType, id: string,
  options: ComparisonReadOptions,
): Promise<AedarComparisonResult> {
  const result = await readAedarComparison(globalThis.fetch, type, id, options)
  // The evidence always carries the label the reader displays now; a settled
  // read is renamed, never re-acquired.
  return result.status === 'ready' && result.evidence.label !== options.label
    ? { status: 'ready', evidence: { ...result.evidence, label: options.label } } : result
}

async function readAedarComparison(fetcher: typeof fetch, type: AedarTerritoryType, id: string,
  options: ComparisonReadOptions,
): Promise<AedarComparisonResult> {
  try {
    const selected = options.intent.kind === 'selected_comparison'
    const members = options.intent.kind === 'selected_comparison' ? options.intent.members : null
    const aggregate = options.typequ.length === 0 && options.measures.every((measure) => AEDAR_AGGREGATE_READING_KEYS.includes(measure))
    if (!options.measures.length || (!aggregate && !options.typequ.length) || members?.length === 0) invalid()
    if (aggregate && !options.expectedSummaryContentVersion) invalid()
    const aggregateFacets = aggregate
      ? (await producerCatalogue()).find((resource) => resource.resource_id === 'aedar_territorial_aggregate')?.measure_facets
      : undefined
    if (aggregate && (!aggregateFacets || options.measures.some((measure) => !aggregateFacets[measure]))) invalid()
    const intent: SemanticReadItem['intent'] = options.intent.kind === 'selected_comparison'
      ? { kind: 'selected_comparison', members: options.intent.members.map((m) => ({ type: m.territory_type, id: m.territory_id })) }
      : options.intent
    // Selected reads support a matrix; fixed reads declare one cell per item.
    const cellBudget = selected && !aggregate ? Math.max(1, Math.min(100, Math.floor(400 / options.measures.length),
      Math.floor(20000 / Math.max(1, members!.length)))) : 1
    const items: SemanticReadItem[] = []
    // A selection reads its measures as one matrix; every other shape declares
    // one cell per item.
    const measureGroups = selected ? [options.measures] : options.measures.map((measure) => [measure])
    for (const measures of measureGroups) for (let start = 0; start < (aggregate ? 1 : options.typequ.length); start += cellBudget) {
      // Every shape asks for the same projection: the cahier tooltip renders
      // whatever ordinal the producer serves, and the API answers a cell it
      // cannot rank with a null triple rather than an omission.
      items.push({ resource: 'aedar_territorial_aggregate',
        target: { kind: 'territory', type, id }, coordinates: { ...(aggregate ? {} : { typequ: options.typequ.slice(start, start + cellBudget) }), measure: [...measures] },
        intent, fields: ['group_value', ...RANK_FIELD_NAMES] })
    }
    const cells: AedarComparisonCell[] = []
    let comparisonVersion: string | undefined
    // Keep batches small enough even for large selections (preflight work counts
    // members × cells). The shared acquisition scheduler bounds the HTTP reads
    // to two at a time; every batch result is still validated before publishing.
    const batchSize = aggregate ? items.length : selected ? Math.max(1, Math.min(8, Math.floor(80000 / Math.max(1, members!.length * cellBudget)))) : 12
    const batches = Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) =>
      items.slice(index * batchSize, (index + 1) * batchSize))
    const responses = await Promise.all(batches.map(async (batch) => {
      // #1002 — settled outcomes are reused only under this exact publication
      // identity, so an identical demand (pending or already settled, whatever
      // its presentation label) shares one read, and a resumed demand reads the
      // genuinely missing items only. An explicit retry (`fresh`) re-probes
      // every item over HTTP and its generation fences the abandoned reply.
      const outcomes = await readSemanticOutcomes(batch, { fetcher, fresh: options.fresh === true,
        ...(options.signal ? { signal: options.signal } : {}),
        expectedFamilies: new Map([['aedar_territorial_aggregate', 'aedar']]),
        coherence: JSON.stringify([options.expectedContentVersion, options.expectedReferenceContentVersion,
          options.expectedSummaryContentVersion]) })
      return { batch, outcomes }
    }))
    for (const { batch, outcomes } of responses) {
      for (let position = 0; position < batch.length; position += 1) {
        const item = batch[position]!
        const outcome = outcomes[position]!
        if (outcome.status === 'publication_unavailable') {
          throw new Error(`Publication AEDAR indisponible (${outcome.family}).`)
        }
        const data = outcome.data
        if (data.resource !== item.resource || !record(data.target)
          || data.target.kind !== 'territory' || data.target.type !== type || data.target.id !== id
          || !nonempty(data.content_version) || data.aedar_content_version !== options.expectedContentVersion
          || data.reference_content_version !== options.expectedReferenceContentVersion
          || (aggregate && data.summary_content_version !== options.expectedSummaryContentVersion)
          || (comparisonVersion !== undefined && data.content_version !== comparisonVersion)) invalid()
        comparisonVersion = data.content_version
        if (members && (!record(data.scope) || data.scope.kind !== 'explicit_selection' || data.scope.member_count !== members.length
          || JSON.stringify(data.selection) !== JSON.stringify(members))) invalid()
        const rows = selected ? data.comparisons : [data.comparison]
          const expectedRows = (item.coordinates?.typequ?.length ?? 1) * (item.coordinates?.measure.length ?? 0)
          if (!Array.isArray(rows) || rows.length !== expectedRows) invalid()
        const returned = new Set<string>()
        for (const row of rows) {
           if (!record(row) || (aggregate ? row.typequ !== null : typeof row.typequ !== 'string' || !item.coordinates!.typequ!.includes(row.typequ as string))
             || typeof row.measure !== 'string' || !item.coordinates!.measure.includes(row.measure) || returned.has(`${row.typequ ?? ''}/${row.measure}`)
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
          let normalizedDirection: 'high' | 'low' | undefined
          // Facet declarations exist for the aggregate readings only; a fixed
          // per-cell row has no declaration map to consult.
          const declaration = aggregate ? aggregateFacets?.[row.measure as string] : undefined
          if (selected || aggregate) {
            if (aggregate && (!declaration || (selected && row.direction !== declaration.direction))) invalid()
            if (selected && row.direction !== 'high' && row.direction !== 'low') invalid()
            normalizedDirection = aggregate ? declaration?.direction : row.direction as 'high' | 'low' | undefined
          }
          // Every item asks for the rank fields, so every row must satisfy one
          // shared law: an aggregate facet declared unranked never serves a
          // rank, a requested rank carries all three fields, and a selection
          // bounds its own population.
          const rank = servedRank(row)
          if (aggregate && !declaration?.ranked && rank) invalid()
          if (rank && selected && (rank[1] > members!.length
            || !members!.some((m) => m.territory_type === type && m.territory_id === id))) invalid()
          returned.add(`${row.typequ ?? ''}/${row.measure}`)
          cells.push({ ...row, ...(normalizedDirection ? { direction: normalizedDirection } : {}) } as unknown as AedarComparisonCell)
        }
      }
    }
    return { status: 'ready', evidence: { label: options.label, contentVersion: options.expectedContentVersion,
      referenceContentVersion: options.expectedReferenceContentVersion,
      ...(aggregate ? { summaryContentVersion: options.expectedSummaryContentVersion,
        aedarContentVersion: options.expectedContentVersion } : {}), cells } }
  } catch (error) {
    // #1002 — an unstarted batch whose chapter demand left is not a failure.
    if (error instanceof SemanticReadDeferredError) return { status: 'deferred' }
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

/** The producer-served ordinal of a comparison cell, or null when it is not
 *  renderable — a served 1/1 is valid evidence but has no peer to position
 *  against, so only `RANK_DISPLAY_MIN_SIZE` decides whether a chip renders. */
export function aedarComparisonRank(cell: AedarComparisonCell | null | undefined): ComparisonRank | null {
  return cell?.rank && cell.rank_size && cell.rank_size >= RANK_DISPLAY_MIN_SIZE
    ? { position: cell.rank, size: cell.rank_size, ties: cell.rank_ties ?? null }
    : null
}
