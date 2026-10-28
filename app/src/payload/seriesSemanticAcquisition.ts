import type { Territoire, TerritoireType } from './types'
import type { OrderedSeriesRead } from './orderedSeriesAdapter'
import { lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem } from './semanticResourceClient'

type Row = Record<string, any>
const record = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)

/** One bounded semantic batch: filtered cohort facts, exact focal facts, and comparison evidence. */
export async function acquireOrderedSeriesSemantic(input: {
  resource: string
  level: TerritoireType
  focal: Territoire
  territories: readonly Territoire[]
  includeScalarFacet?: boolean
  departmentId?: string
  epciId?: string
}): Promise<OrderedSeriesRead> {
  const scoped = input.territories.filter((territory) => territory.type === input.level &&
    (input.level !== 'commune' || ((!input.departmentId || territory.departement === input.departmentId) &&
      (!input.epciId || territory.epci === input.epciId))))
  const explicitFilter = input.level === 'commune' && Boolean(input.departmentId || input.epciId)
  const cohortTarget = { kind: 'territory_cohort' as const, type: input.level,
    ...(input.level === 'commune' ? { department_id: input.departmentId ?? null, epci_id: input.epciId ?? null } : {}) }
  const comparison = explicitFilter
    ? { kind: 'selected_comparison' as const, members: scoped.map((territory) => ({ type: 'commune' as const, id: territory.territoire })) }
    : { kind: 'fixed_comparison' as const, context: 'default' as const }
  const items: SemanticReadItem[] = [
    { resource: input.resource, target: cohortTarget, intent: { kind: 'facts' },
      ...(input.includeScalarFacet ? { fields: ['scalar_facet'] } : {}) },
    { resource: input.resource, target: { kind: 'territory', type: input.focal.type, id: input.focal.territoire }, intent: { kind: 'facts' } },
    { resource: input.resource, target: { kind: 'territory', type: input.focal.type, id: input.focal.territoire },
      intent: comparison, fields: input.includeScalarFacet ? ['axis_comparisons', 'scalar_facet'] : ['axis_comparisons'] },
  ]
  const [cohort, focal, comparisonData] = await lireRessourcesBatch(items)
  if (cohort.shape !== 'ordered_series' || !record(cohort.descriptor) || !Array.isArray(cohort.series) ||
      !record(focal.territory) || !Array.isArray(focal.points) || !record(comparisonData.result)) {
    throw new Error('Réponse de série sémantique incompatible')
  }
  const descriptor = cohort.descriptor
  const focalTerritory = focal.territory
  if (focalTerritory.id !== input.focal.territoire || focalTerritory.type !== input.focal.type ||
      cohort.content_version !== focal.publication_id && cohort.content_version !== focal.content_version ||
      cohort.reference_content_version !== focal.reference_content_version) {
    throw new Error('Identité ou publication de série sémantique incompatible')
  }
  const axisComparisons = comparisonData.result.axis_comparisons
  if (!Array.isArray(axisComparisons)) throw new Error('Preuve de comparaison par axe absente')
  const mapped = axisComparisons.map((candidate: unknown) => {
    if (!record(candidate) || typeof candidate.axis !== 'string' || !['median', 'mean'].includes(candidate.statistic) ||
        !['available', 'unavailable'].includes(candidate.status) || !Array.isArray(candidate.member_ranks)) {
      throw new Error('Preuve de comparaison par axe invalide')
    }
    return candidate
  })
  const groupSeries = cohort.series.map((candidate: unknown) => {
    if (!record(candidate) || !record(candidate.territory) || !Array.isArray(candidate.points)) {
      throw new Error('Faits de cohorte de série invalides')
    }
    return candidate
  })
  const allPoints = [...focal.points, ...groupSeries.flatMap((group: Row) => group.points)]
  const sources = allPoints.flatMap((point: Row) => Array.isArray(point?.provenance) ? point.provenance : [])
  const comparisonPoint = descriptor.comparison_point
  const selected = mapped.find((item: Row) => item.axis === comparisonPoint)
  const focalRank = selected?.member_ranks?.find((rank: Row) => rank.territory_id === input.focal.territoire)
  const source = sources[0]
  const comparisonEnvelope = comparisonData as Row
  return {
    indicator_id: input.resource,
    axis_kind: descriptor.axis_kind,
    unit: descriptor.unit,
    territory: { id: focalTerritory.id, type: focalTerritory.type, name: focalTerritory.name },
    points: focal.points,
    dataset_id: focal.dataset_id,
    scope_series: groupSeries,
    native_descriptor: { label: descriptor.label, unit: descriptor.unit, direction: descriptor.direction,
      axis_kind: descriptor.axis_kind, axis_values: descriptor.axis_values,
      comparison_point: descriptor.comparison_point ?? null },
    ...(input.includeScalarFacet ? { scalar_facet: {
      cohort: cohort.scalar_facet, focal: focal.scalar_facet, comparison: comparisonEnvelope.scalar_facet,
    } } : {}),
    comparison: {
      point: comparisonPoint,
      value: selected?.value,
      median: selected?.statistic === 'median' ? selected.value : undefined,
      mean: selected?.statistic === 'mean' ? selected.value : undefined,
      rank: focalRank?.rank ?? null,
      ties: focalRank?.rank_ties ?? null,
      comparable_count: selected?.eligible_count,
      direction: descriptor.direction,
      axis_comparisons: mapped,
      ...(source ? { scope: comparisonEnvelope.scope } : {}),
    },
  } as unknown as OrderedSeriesRead
}
