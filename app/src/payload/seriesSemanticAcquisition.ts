import type { Territoire, TerritoireType } from './types'
import type { OrderedSeriesRead } from './orderedSeriesAdapter'
import { lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem } from './semanticResourceClient'

type Row = Record<string, any>
const record = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The facts half of an admitted ordered-series read: everything the page can
 *  keep rendering while a comparison alone is rejected or retried (#857). */
export interface OrderedSeriesFactsEvidence {
  indicator_id: string
  axis_kind: string
  unit: string
  territory: { id: string; type: string; name?: string }
  points: Row[]
  dataset_id?: string
  scope_series: Row[]
  native_descriptor: OrderedSeriesRead['native_descriptor']
  scalar_facet?: OrderedSeriesRead['scalar_facet']
  /** The full validated cohort descriptor and its publication identity. */
  descriptor: Row
  content_version: string
  reference_content_version: string
  /** The producer's own state-role marking on the acquired points (OCS-GE M2/M3). */
  role_axes: string[]
  /** Every producer source id the cohort's own provenance declared. */
  declared_source_ids: string[]
}

/** A comparison whose native evidence failed strict binding. The already
 *  validated facts stay admitted; only the comparison is reacquired. */
export class SeriesComparisonRejectedError extends Error {
  constructor(message: string, readonly facts: OrderedSeriesFactsEvidence) {
    super(message)
    this.name = 'SeriesComparisonRejectedError'
  }
}

function assertDescriptor(value: unknown): Row {
  if (!record(value) || !text(value.dataset_id) || !text(value.theme_id) || !text(value.axis_kind) ||
      !Array.isArray(value.axis_values) || !value.axis_values.every((axis: unknown) => text(axis)) ||
      !(value.axis_numeric_values === null || (Array.isArray(value.axis_numeric_values) &&
        value.axis_numeric_values.every((axis: unknown) => finite(axis)))) ||
      !['may_be_missing', 'dense_complete'].includes(value.completeness) ||
      !text(value.absence_semantics) || !text(value.label) || !text(value.unit) ||
      !['high', 'low', 'none'].includes(value.direction) || !text(value.descriptor_version) ||
      !Array.isArray(value.allowed_levels) ||
      !(value.comparison_point === null || text(value.comparison_point)) ||
      !(value.observation_period_kind === null || text(value.observation_period_kind))) {
    throw new Error('Descripteur de série sémantique incompatible')
  }
  return value
}

/** One series point: a measured point carries a finite value, a missing point
 *  carries none, and provenance binds only the cohort's declared sources. */
function assertSeriesPoint(point: unknown, declaredSourceIds: Set<string> | null, context: string): void {
  if (!record(point) || !text(point.axis) || !['measured', 'missing'].includes(point.status) ||
      !(point.observation_period === null || point.observation_period === undefined ||
        text(point.observation_period)) ||
      !(point.missing_reason === null || point.missing_reason === undefined || text(point.missing_reason))) {
    throw new Error(`Point de série invalide (${context})`)
  }
  if (point.status === 'measured') {
    if (!finite(point.value)) throw new Error(`Valeur mesurée absente du fil natif (${context})`)
  } else if (point.value !== null && point.value !== undefined) {
    throw new Error(`Point manquant porteur de valeur (${context})`)
  }
  if (!Array.isArray(point.provenance)) throw new Error(`Provenance de point absente (${context})`)
  for (const revision of point.provenance) {
    if (!record(revision) || !text(revision.revision_id) || !text(revision.source_id) ||
        !text(revision.vintage_id) || !text(revision.source_name) || !text(revision.version) ||
        (declaredSourceIds !== null && !declaredSourceIds.has(revision.source_id)) ||
        !(revision.reference_date === null || text(revision.reference_date)) ||
        !(revision.publication_date === null || text(revision.publication_date))) {
      if (process.env.LUSK_SERIES_PROOF_DEBUG) {
        console.error(`DEBUG provenance: row=${JSON.stringify(revision)}` +
          (declaredSourceIds !== null ? ` declared=[${[...declaredSourceIds].slice(0, 12).join(', ')}]` : ''))
      }
      throw new Error(`Provenance de point non déclarée (${context})`)
    }
  }
}

function cohortSourceIds(series: Row[]): Set<string> {
  return new Set(series.flatMap((group) => group.points.flatMap((point: Row) =>
    (Array.isArray(point?.provenance) ? point.provenance : []).map((revision: Row) => revision.source_id)
      .filter((sourceId: unknown): sourceId is string => text(sourceId)))))
}

/** The comparison request item shared by the initial batch and the
 *  comparison-only re-acquisition. */
function comparisonItem(input: {
  resource: string; focal: Territoire; includeScalarFacet?: boolean
}, members: Array<{ type: TerritoireType; id: string }> | null): SemanticReadItem {
  return {
    resource: input.resource,
    target: { kind: 'territory', type: input.focal.type, id: input.focal.territoire },
    intent: members
      ? { kind: 'selected_comparison', members }
      : { kind: 'fixed_comparison', context: 'default' },
    fields: input.includeScalarFacet ? ['axis_comparisons', 'scalar_facet'] : ['axis_comparisons'],
  }
}

function scopedMembers(input: {
  level: TerritoireType; territories: readonly Territoire[]; departmentId?: string; epciId?: string
}): Array<{ type: TerritoireType; id: string }> | null {
  const explicitFilter = input.level === 'commune' && Boolean(input.departmentId || input.epciId)
  if (!explicitFilter) return null
  return input.territories.filter((territory) => territory.type === 'commune' &&
    (!input.departmentId || territory.departement === input.departmentId) &&
    (!input.epciId || territory.epci === input.epciId))
    .map((territory) => ({ type: 'commune' as const, id: territory.territoire }))
}

/** Validate one comparison response against the admitted facts' descriptor,
 *  publication identity, resolved selection and declared sources, then map it
 *  to the read's comparison evidence. Any single corrupt wire field rejects the
 *  whole comparison before it is cached (#857). */
function bindComparisonEvidence(comparisonData: Row, facts: {
  descriptor: Row; contentVersion: string; referenceContentVersion: string
  declaredSourceIds: Set<string>; memberIdentity: Set<string>
}, requestedMembers: Array<{ type: TerritoireType; id: string }> | null): OrderedSeriesRead['comparison'] {
  const result = comparisonData.result
  if (!record(result) || !['median', 'mean'].includes(result.statistic) ||
      !['available', 'unavailable'].includes(result.status) ||
      comparisonData.content_version !== facts.contentVersion ||
      comparisonData.reference_content_version !== facts.referenceContentVersion ||
      result.descriptor_version !== facts.descriptor.descriptor_version) {
    throw new Error('Identité ou publication de comparaison sémantique incompatible')
  }
  if (requestedMembers) {
    const selection = comparisonData.selection
    if (!Array.isArray(selection) || selection.length !== requestedMembers.length ||
        !selection.every((member: Row) => record(member) &&
          requestedMembers.some((requested) => requested.type === member.territory_type &&
            requested.id === member.territory_id))) {
      throw new Error('Écho de sélection de comparaison incompatible')
    }
  }
  const scope = comparisonData.scope
  if (!record(scope) || !text(scope.kind) ||
      !Number.isInteger(scope.member_count) || scope.member_count < 1) {
    throw new Error('Périmètre de comparaison sémantique incompatible')
  }
  const axisComparisons = Array.isArray(result.axis_comparisons) ? result.axis_comparisons : []
  if (!axisComparisons.length) throw new Error('Preuve de comparaison par axe absente')
  const mapped = axisComparisons.map((candidate: unknown) => {
    const axis = record(candidate) && text(candidate.axis) ? candidate.axis : '?'
    if (!record(candidate) || !['median', 'mean'].includes(candidate.statistic) ||
        candidate.statistic !== result.statistic ||
        !['available', 'unavailable'].includes(candidate.status) ||
        !(candidate.value === null || finite(candidate.value)) ||
        !(candidate.min === null || finite(candidate.min)) ||
        !(candidate.max === null || finite(candidate.max)) ||
        !Number.isInteger(candidate.selected_member_count) || candidate.selected_member_count < 1 ||
        !Number.isInteger(candidate.eligible_count) || candidate.eligible_count < 0 ||
        !Number.isInteger(candidate.missing_count) || candidate.missing_count < 0 ||
        candidate.eligible_count + candidate.missing_count !== candidate.selected_member_count ||
        !Array.isArray(candidate.member_ranks) || !Array.isArray(candidate.sources)) {
      throw new Error(`Preuve de comparaison par axe invalide (${axis})`)
    }
    if (candidate.selected_member_count !== scope.member_count) {
      throw new Error(`Population de comparaison incohérente (${axis})`)
    }
    for (const source of candidate.sources) {
      if (!record(source) || !text(source.source_id) || !facts.declaredSourceIds.has(source.source_id) ||
          !text(source.revision_id) || !text(source.vintage_id) || !text(source.version) ||
          !(source.reference_date === null || text(source.reference_date)) ||
          !(source.publication_date === null || text(source.publication_date))) {
        throw new Error(`Source de comparaison non déclarée (${axis})`)
      }
    }
    if (candidate.status === 'available') {
      if (candidate.value === null || candidate.min === null || candidate.max === null ||
          candidate.min > candidate.max || candidate.value < candidate.min ||
          candidate.value > candidate.max || candidate.eligible_count < 2) {
        throw new Error(`Agrégat de comparaison incohérent (${axis})`)
      }
    } else if (candidate.value !== null || candidate.min !== null || candidate.max !== null) {
      throw new Error(`Comparaison indisponible porteuse de valeurs (${axis})`)
    }
    for (const rank of candidate.member_ranks) {
      if (!record(rank) || !text(rank.territory_id) || !facts.memberIdentity.has(rank.territory_id) ||
          !(rank.rank === null || Number.isInteger(rank.rank)) ||
          !(rank.rank_size === null || Number.isInteger(rank.rank_size)) ||
          !(rank.rank_ties === null || Number.isInteger(rank.rank_ties))) {
        throw new Error(`Rang de pair invalide (${axis})`)
      }
      if (candidate.status !== 'available') {
        if (rank.rank !== null || rank.rank_size !== null || rank.rank_ties !== null) {
          throw new Error(`Rang porté par une comparaison indisponible (${axis})`)
        }
        continue
      }
      // A member without a measured value legitimately carries no rank; the
      // ranked-count check below reconciles them with the eligibility.
      if (rank.rank === null) continue
      if (!Number.isInteger(rank.rank) || !Number.isInteger(rank.rank_size) ||
          !Number.isInteger(rank.rank_ties) || rank.rank_size !== candidate.eligible_count ||
          rank.rank_size < 1 || rank.rank < 1 || rank.rank > rank.rank_size ||
          rank.rank_ties < 1 || rank.rank_ties > rank.rank_size ||
          rank.rank + rank.rank_ties > rank.rank_size + 1) {
        throw new Error(`Span de rang publié impossible (${axis})`)
      }
    }
    const rankedCount = candidate.member_ranks.filter((rank: Row) => rank.rank !== null).length
    if (candidate.status === 'available' ? rankedCount !== candidate.eligible_count : rankedCount !== 0) {
      throw new Error(`Rangs de pairs incohérents avec l'éligibilité (${axis})`)
    }
    return candidate
  })
  const comparisonPoint = facts.descriptor.comparison_point
  const selected = mapped.find((item: Row) => item.axis === comparisonPoint)
  const focalRank = selected?.member_ranks?.find((rank: Row) =>
    rank.territory_id === comparisonData.target?.id)
  return {
    point: comparisonPoint,
    value: selected?.value,
    median: selected?.statistic === 'median' ? selected.value : undefined,
    mean: selected?.statistic === 'mean' ? selected.value : undefined,
    rank: focalRank?.rank ?? null,
    ties: focalRank?.rank_ties ?? null,
    comparable_count: selected?.eligible_count,
    direction: facts.descriptor.direction,
    axis_comparisons: mapped,
    scope,
  } as unknown as OrderedSeriesRead['comparison']
}

/** One bounded semantic batch: filtered cohort facts, exact focal facts, and
 *  comparison evidence — each part bound to the others' publication identity,
 *  declared sources and resolved selection before anything is admitted (#857).
 *  A comparison whose evidence fails binding rejects alone: the validated facts
 *  stay admitted on the typed error and only the comparison is reacquired. */
export async function acquireOrderedSeriesSemantic(input: {
  resource: string
  level: TerritoireType
  focal: Territoire
  territories: readonly Territoire[]
  includeScalarFacet?: boolean
  departmentId?: string
  epciId?: string
}): Promise<OrderedSeriesRead> {
  const members = scopedMembers(input)
  const cohortTarget = { kind: 'territory_cohort' as const, type: input.level,
    ...(input.level === 'commune' ? { department_id: input.departmentId ?? null, epci_id: input.epciId ?? null } : {}) }
  const items: SemanticReadItem[] = [
    { resource: input.resource, target: cohortTarget, intent: { kind: 'facts' },
      fields: input.includeScalarFacet ? ['value', 'scalar_facet'] : ['value'] },
    { resource: input.resource, target: { kind: 'territory', type: input.focal.type, id: input.focal.territoire }, intent: { kind: 'facts' } },
    comparisonItem(input, members),
  ]
  const [cohort, focal, comparisonData] = await lireRessourcesBatch(items)
  if (cohort.shape !== 'ordered_series' || !Array.isArray(cohort.series) ||
      !record(focal.territory) || !Array.isArray(focal.points)) {
    throw new Error('Réponse de série sémantique incompatible')
  }
  const descriptor = assertDescriptor(cohort.descriptor)
  if (cohort.resource !== input.resource || focal.resource !== input.resource ||
      comparisonData.resource !== input.resource ||
      !text(cohort.content_version) || !text(cohort.reference_content_version) ||
      !(focal.content_version === cohort.content_version ||
        focal.publication_id === cohort.content_version) ||
      focal.reference_content_version !== cohort.reference_content_version ||
      focal.descriptor_version !== descriptor.descriptor_version ||
      focal.indicator_id !== input.resource || focal.dataset_id !== descriptor.dataset_id) {
    throw new Error('Identité ou publication de série sémantique incompatible')
  }
  const focalTerritory = focal.territory
  if (focalTerritory.id !== input.focal.territoire || focalTerritory.type !== input.focal.type) {
    throw new Error('Territoire focal de série sémantique incompatible')
  }
  const groupSeries = cohort.series.map((candidate: unknown) => {
    if (!record(candidate) || !record(candidate.territory) || !Array.isArray(candidate.points) ||
        !text(candidate.territory.id) || !text(candidate.territory.type)) {
      throw new Error('Faits de cohorte de série invalides')
    }
    return candidate
  })
  // The cohort's own provenance declares the resource's admissible sources.
  const declaredSourceIds = cohortSourceIds(groupSeries)
  for (const group of groupSeries) {
    group.points.forEach((point: unknown, index: number) =>
      assertSeriesPoint(point, declaredSourceIds, `${group.territory.id}#${index}`))
  }
  focal.points.forEach((point: unknown, index: number) =>
    assertSeriesPoint(point, declaredSourceIds, `focal#${index}`))
  if (input.includeScalarFacet) {
    for (const facet of [cohort.scalar_facet, focal.scalar_facet]) {
      if (facet !== undefined && facet !== null && !record(facet)) {
        throw new Error('Facette scalaire de série sémantique incompatible')
      }
    }
  }
  const memberIdentity = new Set<string>([
    ...groupSeries.map((group) => group.territory.id),
    ...input.territories.filter((territory) => territory.type === input.level)
      .map((territory) => territory.territoire),
  ])
  const facts: OrderedSeriesFactsEvidence = {
    indicator_id: input.resource,
    axis_kind: descriptor.axis_kind,
    unit: descriptor.unit,
    territory: { id: focalTerritory.id, type: focalTerritory.type, name: focalTerritory.name },
    points: focal.points,
    dataset_id: descriptor.dataset_id,
    scope_series: groupSeries,
    native_descriptor: { label: descriptor.label, unit: descriptor.unit, direction: descriptor.direction,
      axis_kind: descriptor.axis_kind, axis_values: descriptor.axis_values,
      comparison_point: descriptor.comparison_point ?? null },
    ...(input.includeScalarFacet ? { scalar_facet: {
      cohort: cohort.scalar_facet as Row | undefined, focal: focal.scalar_facet as Row | undefined,
      comparison: comparisonData.scalar_facet as Row | undefined,
    } } : {}),
    descriptor,
    content_version: cohort.content_version,
    reference_content_version: cohort.reference_content_version,
    role_axes: [...new Set([...focal.points, ...groupSeries.flatMap((group: Row) => group.points)]
      .flatMap((point: Row) => text(point.state_role) ? [point.state_role] : []))],
    declared_source_ids: [...declaredSourceIds],
  }
  try {
    const comparison = bindComparisonEvidence(comparisonData, {
      descriptor, contentVersion: cohort.content_version,
      referenceContentVersion: cohort.reference_content_version,
      declaredSourceIds, memberIdentity,
    }, members)
    return { ...facts, comparison } as unknown as OrderedSeriesRead
  } catch (cause) {
    throw new SeriesComparisonRejectedError(
      cause instanceof Error ? cause.message : String(cause), facts)
  }
}

/** Comparison-only re-acquisition: one bounded read validated against the
 *  already admitted facts' identity — the warm facts are never reread (#857). */
export async function reacquireOrderedSeriesComparison(input: {
  resource: string
  level: TerritoireType
  focal: Territoire
  territories: readonly Territoire[]
  includeScalarFacet?: boolean
  departmentId?: string
  epciId?: string
  facts: OrderedSeriesFactsEvidence
}): Promise<OrderedSeriesRead['comparison']> {
  const members = scopedMembers(input)
  const [comparisonData] = await lireRessourcesBatch([comparisonItem(input, members)])
  if (!record(comparisonData)) throw new Error('Réponse de comparaison sémantique incompatible')
  const memberIdentity = new Set<string>(input.facts.scope_series.map((group) => group.territory.id))
  return bindComparisonEvidence(comparisonData, {
    descriptor: input.facts.descriptor,
    contentVersion: input.facts.content_version,
    referenceContentVersion: input.facts.reference_content_version,
    declaredSourceIds: new Set(input.facts.declared_source_ids),
    memberIdentity,
  }, members)
}
