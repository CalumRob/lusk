import type { DirectionRang } from '@/methodes/indicateurs'
import { THEMES_METHODES } from '@/methodes/indicateurs'
import type {
  Indicateur,
  Payload,
  Territoire,
  TerritoireType,
} from '@/payload/types'
import type { TerritoryComparisonContext } from '@/fiche/comparisonContext'

/** The availability of a normalized fact, independent of how a surface lays it out. */
export type FactAvailability = 'complete' | 'incomplete' | 'absent'

/** The source clock carried by one fact. No payload row is exposed to callers. */
export interface FactProvenance {
  sourceId: string | null
  source: string
  version: string
  referenceDate: string | null
  publicationDate: string | null
  /** Original producer lineage, retained when the normalized consumer uses only source clocks. */
  lineage?: Record<string, unknown>
}

export type ComparisonScopeKind =
  | 'selection'
  | 'communes-densite'
  | 'communes-epci'
  | 'communes-bretagne'
  | 'epcis-bretagne'
  | 'departements-bretagne'

/** The one peer universe used for both a fact's rank and its reference value. */
export interface ComparisonScope {
  kind: ComparisonScopeKind
  territoryIds?: readonly string[]
  mode?: 'densite' | 'epci' | 'bretagne'
  label?: string
}

export interface ComparisonRank {
  position: number
  size: number
  /** Producer-served tie count at this position, itself included; absent when unknown. */
  ties?: number | null
}

export interface ComparisonReference {
  kind: 'mean' | 'median'
  value: number
}

/** A named territory's own mean, distinct from a statistic over peer territories. */
export interface TerritorialScalarReference {
  kind: 'territory-mean'
  territory: { type: string; id: string; name: string }
  label: string
  value: number
  unit: string
}

export interface FactComparison {
  direction: DirectionRang
  scope: ComparisonScope
  rank: ComparisonRank | null
  reference: ComparisonReference | null
}

/** A numeric fact normalized away from the payload's row and rank columns. */
export interface NumericFact {
  key: string
  detail: string | null
  /** Producer-declared numeric position for an ordered series axis. */
  axisValue?: number
  sex?: Indicateur['sex']
  /** Payload-owned label when this fact is a published indicator. */
  label?: string | null
  /** Producer/app display label for its declared category coordinate. */
  detailLabel?: string | null
  value: number | null
  unit: string
  availability: FactAvailability
  provenance: FactProvenance | null
  /** Full producer lineage where a publication names more than one source. */
  sourceLineage?: readonly FactProvenance[]
  comparison: FactComparison | null
  /** Published aggregation semantics, including when the reference is unavailable. */
  comparisonBasis: 'territory-median' | 'territory-mean' | 'building-weighted-mean' | 'pooled-building-mean'
  reason: string | null
}

/** Named analytical series evidence has no territory identity and is never a focal observation. */
export interface NamedTrajectoryReference {
  indicatorId: string
  id: string
  label: string
  role: string
  statistic: string
  unit: string
  points: readonly NumericFact[]
}

/** API-owned aggregate curve for the resolved comparison scope (never member curves). */
export interface SelectedTrajectoryComparison {
  statistic: 'mean'
  scope: ComparisonScope
  selectedMemberCount: number
  eligibleCount: number
  modelZeroReasonCounts: Readonly<Record<string, number>>
  sourceLineage: readonly FactProvenance[]
  points: readonly NumericFact[]
}

export interface MobilityTrajectoryContract {
  axisKind: 'duration_minute'
  axisValues: readonly string[]
  axisNumericValues: readonly number[]
  comparisonPoint: string
  comparisonStatistic: 'mean'
  comparisonScope: 'selected_group'
}

export type MobiliteService =
  | 'administration'
  | 'alimentation'
  | 'sante'
  | 'banque'
  | 'ecole'

export type MobiliteAccessMode = 'car' | 'bike' | 'walkTransit'

/** Canonical labels for the three mobility modes used throughout the fiche. */
export const MOBILITE_MODE_LABELS: Readonly<Record<MobiliteAccessMode, string>> = {
  car: 'Voiture',
  bike: 'À vélo + TC',
  walkTransit: 'À pied + TC',
}

/** Network labels are narrower than access labels: the OSM t network is
 * pedestrian and the b network is cycling; neither carries transit data. */
export const MOBILITE_RESEAU_MODE_LABELS: Readonly<Record<MobiliteAccessMode, string>> = {
  car: 'Réseau automobile',
  bike: 'Réseau cyclable',
  walkTransit: 'Réseau piéton',
}

export const MOBILITE_INACCESSIBLE_LABEL = 'Inaccessible'
/** Generic time-indexed ramp data; null values represent unavailable observations. */
export interface TimeRampPoint {
  xValue: number
  xLabel: string
  value: number | null
  referenceValue: number | null
  /** Producer-served ordinal for the compared reading; never derived from the focal value. */
  referenceRank?: ComparisonRank | null
}

export interface TimeRampSeries {
  key: string
  label: string
  points: readonly TimeRampPoint[]
}

export interface TimeRampFigureData {
  availability: FactAvailability
  xAxis: { label: string; unit: string }
  yAxis: { label: string; unit: string }
  series: readonly TimeRampSeries[]
  provenance: FactProvenance | null
  comparisonLabel: string | null
  /** The figure supports a comparison layer even when its current values are unavailable. */
  comparisonLayerSupported?: boolean
}

export interface TerritoryIdentity {
  code: string
  type: TerritoireType
  name: string
  department: string | null
  epci: string | null
  /** The published EPCI name for a commune's comparison context, when available. */
  epciName?: string | null
  densityClassCode?: string | null
}

export interface MobilityFacts {
  indicators: readonly NumericFact[]
  namedTrajectoryReferences: readonly NamedTrajectoryReference[]
  selectedTrajectoryComparison?: SelectedTrajectoryComparison | null
  trajectoryContract?: MobilityTrajectoryContract | null
}

/**
 * The target-scoped, presentation-neutral Mobilité facts result. The public
 * shape contains normalized facts only: no payload row, story-selection field,
 * or Vue presentation type crosses this seam.
 */
export interface TerritoryFacts {
  territory: TerritoryIdentity
  theme: 'mobilite'
  mobility: MobilityFacts
}
function identityOf(territoire: Territoire, epciName: string | null = null): TerritoryIdentity {
  return {
    code: territoire.territoire,
    type: territoire.type,
    name: territoire.nom,
    department: territoire.departement,
    epci: territoire.epci,
    densityClassCode: territoire.classe_densite_code ?? null,
    ...(epciName ? { epciName } : {}),
  }
}

function availabilityOf(value: number | null, present: boolean): FactAvailability {
  if (!present) return 'absent'
  return value === null ? 'incomplete' : 'complete'
}

function factOf(options: {
  key: string
  detail?: string | null
  sex?: Indicateur['sex']
  label?: string | null
  detailLabel?: string | null
  value: number | null
  unit: string
  present: boolean
  provenance?: FactProvenance | null
  sourceLineage?: readonly FactProvenance[]
  comparison?: FactComparison | null
  comparisonBasis?: NumericFact['comparisonBasis']
  reason?: string | null
}): NumericFact {
  return {
    key: options.key,
    detail: options.detail ?? null,
    ...(options.sex !== undefined ? { sex: options.sex } : {}),
    label: options.label ?? null,
    ...(options.detailLabel !== undefined ? { detailLabel: options.detailLabel } : {}),
    value: options.value,
    unit: options.unit,
    availability: availabilityOf(options.value, options.present),
    provenance: options.present ? options.provenance ?? null : null,
    ...(options.sourceLineage ? { sourceLineage: options.sourceLineage } : {}),
    comparison: options.comparison ?? null,
    comparisonBasis: options.comparisonBasis ?? 'territory-median',
    reason: options.reason ?? null,
  }
}

function provenanceFromRow(row: Indicateur, sourceId: string | null): FactProvenance {
  if (row.vintage_version === null) throw new Error(`Horloge de provenance absente pour ${row.key}`)
  const source = row.fact_sources?.[0]
  return {
    sourceId: source?.sourceId ?? sourceId,
    source: row.vintage_source,
    version: row.vintage_version,
    referenceDate: row.vintage_date_reference,
    publicationDate: row.vintage_date_publication,
    ...(source?.lineage ? { lineage: source.lineage } : {}),
  }
}

function sourceLineageFromRow(row: Indicateur, sourceId: string | null): readonly FactProvenance[] {
  return row.fact_sources?.length ? row.fact_sources : [provenanceFromRow(row, sourceId)]
}

function scopeFor(payload: Payload, target: Territoire): ComparisonScope | null {
  switch (target.type) {
    case 'commune': {
      if (target.epci) {
        return {
          kind: 'communes-epci',
          territoryIds: payload.territoires
            .filter((candidate) => candidate.type === 'commune' && candidate.epci === target.epci)
            .map((candidate) => candidate.territoire),
        }
      }
      return {
        kind: 'communes-bretagne',
        territoryIds: payload.territoires
          .filter((candidate) => candidate.type === 'commune')
          .map((candidate) => candidate.territoire),
      }
    }
    case 'epci':
      return {
        kind: 'epcis-bretagne',
        territoryIds: payload.territoires
          .filter((candidate) => candidate.type === 'epci')
          .map((candidate) => candidate.territoire),
      }
    case 'departement':
      return {
        kind: 'departements-bretagne',
        territoryIds: payload.territoires
          .filter((candidate) => candidate.type === 'departement')
          .map((candidate) => candidate.territoire),
      }
    case 'region':
      return null
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? null
  const lower = sorted[middle - 1]
  const upper = sorted[middle]
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2
}

function rankOf(
  value: number | null,
  values: readonly number[],
  direction: DirectionRang,
): ComparisonRank | null {
  if (value === null || values.length === 0) return null
  return {
    position:
      1 +
      values.filter((candidate) =>
        direction === 'moins-est-mieux' ? candidate < value : candidate > value,
      ).length,
    size: values.length,
  }
}


function comparisonOf(options: {
  scope: ComparisonScope | null
  direction: DirectionRang
  value: number | null
  values: readonly number[]
}): FactComparison | null {
  if (!options.scope) return null

  // A comparison group containing fewer than two usable communes cannot
  // support a truthful peer reference or rank. Keep the scope so content can
  // name the unavailable comparison instead of silently dropping it.
  if (options.values.length < 2) {
    return {
      direction: options.direction,
      scope: options.scope,
      rank: null,
      reference: null,
    }
  }

  const referenceValue = median(options.values)
  const rank = rankOf(options.value, options.values, options.direction)

  return {
    direction: options.direction,
    scope: options.scope,
    rank,
    reference: referenceValue === null ? null : { kind: 'median', value: referenceValue },
  }
}

function sourceIdForIndicator(payload: Payload, key: string): string | null {
  return (
    payload.themeMetadata?.mobilite?.sources[key] ??
    THEMES_METHODES.mobilite.indicateurs[key]?.sourceId ??
    null
  )
}
function directionForIndicator(key: string): DirectionRang | null {
  return THEMES_METHODES.mobilite.indicateurs[key]?.direction ?? null
}

function comparisonFromPrecomputed(
  precomputed: TerritoryComparisonContext | undefined,
  key: string,
  detail: string | null = null,
  sex: string | null = null,
  dimension: string | null = null,
): FactComparison | null {
  if (!precomputed) return null
  const fact = precomputed.facts.find((candidate) =>
    candidate.key === key &&
    candidate.detail === detail &&
    candidate.sex === sex &&
    candidate.dimension === dimension,
  )
  return fact
    ? {
        direction: fact.direction,
        scope: {
          mode: precomputed.mode,
          kind: precomputed.scope.kind,
          label: precomputed.scope.label,
        },
        rank: fact.rank,
        reference: fact.reference,
      }
    : null
}

function indicatorComparison(
  payload: Payload,
  scope: ComparisonScope | null,
  row: Indicateur,
  direction: DirectionRang,
  precomputed?: TerritoryComparisonContext,
): FactComparison | null {
  if (precomputed) {
    return comparisonFromPrecomputed(
      precomputed,
      row.key,
      row.detail,
      row.sex ?? null,
      row.dimension ?? null,
    )
  }
  const observations = payload.indicateurs
    .filter(
      (candidate) =>
        candidate.theme === 'mobilite' &&
        candidate.key === row.key &&
        candidate.detail === row.detail &&
        (candidate.sex ?? null) === (row.sex ?? null) &&
        (candidate.dimension ?? null) === (row.dimension ?? null) &&
        scope !== null && (scope.territoryIds ?? []).includes(candidate.territoire),
    )
    .flatMap((candidate) => (candidate.value === null ? [] : [candidate.value]))

  return comparisonOf({
    scope,
    direction,
    value: row.value,
    values: observations,
  })
}

function indicatorsOf(
  payload: Payload,
  target: Territoire,
  scope: ComparisonScope | null,
  precomputed?: TerritoryComparisonContext,
): readonly NumericFact[] {
  return payload.indicateurs
    .filter((row) => row.theme === 'mobilite' && row.territoire === target.territoire)
    .map((row) => {
      const direction = directionForIndicator(row.key)
      const sourceId = sourceIdForIndicator(payload, row.key)
      return factOf({
        key: row.key,
        detail: row.detail,
        sex: row.sex ?? null,
        label: row.nativeContract?.label ?? payload.themeMetadata?.mobilite?.indicator_labels[row.key] ?? null,
        detailLabel: row.detail === null ? null : row.nativeContract?.axes?.find((axis) =>
          axis.name === 'detail' && axis.key === row.detail)?.label ??
          payload.themeMetadata?.mobilite?.detail_labels[row.key]?.[row.detail] ?? null,
        value: row.value,
        unit: row.unit,
        present: true,
        provenance: provenanceFromRow(row, sourceId),
        sourceLineage: sourceLineageFromRow(row, sourceId),
        comparison: direction
          ? indicatorComparison(payload, scope, row, direction, precomputed)
          : null,
        comparisonBasis: 'territory-median',
        reason: row.rider ?? null,
      })
    })
}
/** Build Mobilité facts for one target. Unknown targets stay honestly absent. */
export function territoryFactsFor(
  payload: Payload,
  territoire: string,
  precomputed?: TerritoryComparisonContext,
): TerritoryFacts | null {
  const target = payload.territoires.find((candidate) => candidate.territoire === territoire)
  if (!target) return null

  const scope = scopeFor(payload, target)
  const epciName = target.epci
    ? payload.territoires.find(
        (candidate) => candidate.type === 'epci' && candidate.territoire === target.epci,
      )?.nom ?? null
    : null
  return {
    territory: identityOf(target, epciName),
    theme: 'mobilite',
    mobility: {
      indicators: indicatorsOf(payload, target, scope, precomputed),
      namedTrajectoryReferences: [],
      selectedTrajectoryComparison: null,
      trajectoryContract: null,
    },
  }
}
