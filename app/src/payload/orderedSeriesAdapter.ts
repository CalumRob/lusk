import type { Indicateur, Territoire, Theme, TerritoireType } from './types'

export interface OrderedSeriesPoint {
  axis: string
  state_role?: 'M2' | 'M3' | null
  observation_period: string | null
  value: number | null
  status: 'measured' | 'missing'
  missing_reason?: string | null
  source_id?: string
  vintage_id?: string
  source_version?: string | null
  source_reference_date?: string | null
  source_publication_date?: string | null
  provenance?: Array<{ revision_id: string; source_id: string; vintage_id: string; source_name: string;
    dataset_name: string; version: string; reference_date: string; publication_date: string; revision_hash: string }>
  comparison_rank?: number | null
  comparison_ties?: number | null
  comparison_count?: number | null
  comparison_value?: number | null
  comparison_min?: number | null
  comparison_max?: number | null
  comparison_statistic?: 'median' | 'mean'
  comparison_missing_count?: number
}

export interface OrderedSeriesTerritory {
  territory: { id: string; type: TerritoireType; name: string }
  points: OrderedSeriesPoint[]
}

export interface OrderedSeriesRead {
  indicator_id: string
  axis_kind: 'year' | 'state_role' | 'declared_detail'
  unit: string
  territory: { id: string; type: TerritoireType; name: string }
  points: OrderedSeriesPoint[]
  dataset_id?: string
  scope_series?: OrderedSeriesTerritory[]
  scalar_facet?: { cohort?: Record<string, any>; focal?: Record<string, any>;
    comparison?: Record<string, any> }
  native_descriptor?: { label: string; unit: string; direction: 'high' | 'low' | 'none';
    axis_kind: string; axis_values: string[]; comparison_point: string | null }
  /** The producer's own state-role marking carried by the admitted points (#857). */
  role_axes?: string[]
  comparison: {
    point: string | null
    value?: number | null
    median?: number | null
    rank?: number | null
    ties?: number | null
    comparable_count?: number
    direction?: 'high' | 'low' | 'none'
    scope?: { kind?: string; territory_type?: string; department_id?: string | null; epci_id?: string | null;
      rank_field?: 'rang_epci' | 'rang_dep' | 'rang_reg' | null; label?: string | null }
    axis_comparisons?: Array<{ axis: string; statistic: 'median' | 'mean'; status: 'available' | 'unavailable';
      value: number | null; min: number | null; max: number | null; selected_member_count: number;
      eligible_count: number; missing_count: number; member_ranks: Array<{ territory_id: string;
        rank: number | null; rank_size: number | null; rank_ties: number | null }>; sources: Array<Record<string, unknown>> }>
  } | null
}

export interface OrderedSeriesAdapter {
  theme: Theme
  indicator: string
  pathIndicator: string
  datasetId?: string
  publicationMode?: 'legacy' | 'owned'
}

/** Derive eligibility from the producer catalogue; there is no parallel page allowlist. */
export function orderedSeriesAdapterFor(theme: string, indicator: string,
  resource?: { resource_id: string; theme_id: string; indicator_id: string; shapes: string[];
    target_kinds: string[] } | null): OrderedSeriesAdapter | null {
  if (!resource || resource.resource_id !== indicator || resource.theme_id !== theme ||
      resource.indicator_id !== indicator || !resource.shapes.includes('ordered_series') ||
      !resource.target_kinds.includes('territory_cohort')) return null
  return { theme: theme as Theme, indicator, pathIndicator: indicator }
}

/** Convert an API snapshot to the app's existing fact contract without filling gaps. */
export function orderedSeriesFacts(
  read: OrderedSeriesRead,
  theme: Theme,
  territories: readonly Territoire[],
  axisFacet: 'detail' | 'dimension' = 'detail',
): Indicateur[] {
  const refs = new Map(territories.map((territory) => [territory.territoire, territory] as const))
  const comparisonByAxis = new Map((read.comparison?.axis_comparisons ?? []).map((comparison) => [comparison.axis, comparison]))
  const withEvidence = (point: OrderedSeriesPoint, territoryId: string): OrderedSeriesPoint => {
    const comparison = comparisonByAxis.get(point.axis)
    const member = comparison?.member_ranks.find((rank) => rank.territory_id === territoryId)
    return comparison ? { ...point,
      comparison_rank: member?.rank ?? null,
      comparison_ties: member?.rank_ties ?? null,
      comparison_count: member?.rank_size ?? null,
      comparison_value: comparison.value,
      comparison_min: comparison.min,
      comparison_max: comparison.max,
      comparison_statistic: comparison.statistic,
      comparison_missing_count: comparison.missing_count,
    } : point
  }
  const groups = read.scope_series ? read.scope_series.map((group) => ({ ...group,
    points: group.points.map((point) => withEvidence(point, group.territory.id)),
  })) : []
  if (!groups.some((group) => group.territory.id === read.territory.id)) {
    groups.push({ territory: read.territory, points: read.points.map((point) => withEvidence(point, read.territory.id)) })
  }
  const rows: Indicateur[] = []
  for (const group of groups) {
    const ref = refs.get(group.territory.id)
    if (!ref || ref.type !== group.territory.type) continue
    for (const point of group.points) {
      const axis = point.axis
      rows.push({
        territoire: ref.territoire,
        type: ref.type,
        theme,
        key: read.indicator_id,
        detail: axisFacet === 'detail' ? axis : null,
        dimension: axisFacet === 'dimension' ? axis : null,
        native_ordered_series_fact: true,
        value: point?.status === 'measured' ? point.value : null,
        unit: read.unit,
        rider: point?.status === 'measured' ? null : point?.missing_reason ?? null,
        ...(point?.status !== 'measured' && ['suppressed', 'unsupported', 'not_available', 'not_published', 'unavailable']
          .includes(point?.missing_reason ?? '') ? { fact_status: point.missing_reason as Indicateur['fact_status'] } : {}),
        vintage_source: point?.provenance?.map((lineage) => lineage.source_name).join(' · ') ?? point?.source_id ?? '',
        vintage_version: point?.provenance?.map((lineage) => lineage.version).join(' · ') ?? point?.source_version ?? point?.vintage_id ?? '',
        vintage_date_reference: point?.provenance?.map((lineage) => lineage.reference_date).join(' · ') ?? point?.source_reference_date ?? null,
        vintage_date_publication: point?.provenance?.map((lineage) => lineage.publication_date).join(' · ') ?? point?.source_publication_date ?? null,
        rang_epci: read.comparison?.scope?.rank_field === 'rang_epci' && point.axis === read.comparison.point
          ? point.comparison_rank ?? null : null,
        rang_epci_n: read.comparison?.scope?.rank_field === 'rang_epci' && point.axis === read.comparison.point
          ? point.comparison_count ?? null : null,
        rang_dep: read.comparison?.scope?.rank_field === 'rang_dep' && point.axis === read.comparison.point
          ? point.comparison_rank ?? null : null,
        rang_dep_n: read.comparison?.scope?.rank_field === 'rang_dep' && point.axis === read.comparison.point
          ? point.comparison_count ?? null : null,
        rang_reg: read.comparison?.scope?.rank_field === 'rang_reg' && point.axis === read.comparison.point
          ? point.comparison_rank ?? null : null,
        rang_reg_n: read.comparison?.scope?.rank_field === 'rang_reg' && point.axis === read.comparison.point
          ? point.comparison_count ?? null : null,
        observation_status: point?.status ?? 'missing',
        ...(comparisonByAxis.get(point.axis)?.status === 'available' && point.comparison_rank !== null &&
          point.comparison_rank !== undefined ? { comparaisonApi: {
            rang: point.comparison_rank, taille: point.comparison_count ?? null,
            portee: read.comparison?.scope?.label ?? null,
            direction: read.comparison?.direction === 'high' || read.comparison?.direction === 'low'
              ? read.comparison.direction : undefined,
          } } : {}),
        observation_period: point?.observation_period ?? null,
        source_id: point?.source_id ?? point?.provenance?.map((lineage) => lineage.source_id).join(' · ') ?? null,
        vintage_id: point?.vintage_id ?? point?.provenance?.map((lineage) => lineage.vintage_id).join(' · ') ?? null,
        provenance_revisions: point?.provenance ?? [],
        fact_sources: (point?.provenance ?? []).map((lineage) => ({ sourceId: lineage.source_id,
          source: lineage.source_name, version: lineage.version, vintageId: lineage.vintage_id,
          referenceDate: lineage.reference_date, publicationDate: lineage.publication_date,
          lineage: { revisionId: lineage.revision_id, dataset: lineage.dataset_name, hash: lineage.revision_hash } })),
        ...(comparisonByAxis.has(point.axis) ? { native_series_comparison: {
          statistic: comparisonByAxis.get(point.axis)!.statistic,
          status: comparisonByAxis.get(point.axis)!.status,
          value: comparisonByAxis.get(point.axis)!.value,
          min: comparisonByAxis.get(point.axis)!.min,
          max: comparisonByAxis.get(point.axis)!.max,
          eligible_count: comparisonByAxis.get(point.axis)!.eligible_count,
          missing_count: comparisonByAxis.get(point.axis)!.missing_count,
        } } : {}),
      })
    }
  }
  const scalar = read.scalar_facet
  if (scalar) {
    const observations = scalar.cohort?.observations
    const ranks = scalar.comparison?.result?.member_ranks
    if (Array.isArray(observations)) {
      for (const observation of observations) {
        const territory = observation?.territory
        const ref = refs.get(territory?.id)
        if (!ref || ref.type !== territory.type) continue
        const rank = Array.isArray(ranks) ? ranks.find((candidate: any) => candidate.territory_id === ref.territoire) : undefined
        const sources = observation.sources ?? []
        rows.push({ territoire: ref.territoire, type: ref.type, theme, key: read.indicator_id,
          detail: null, value: observation.status === 'measured' ? observation.value : null,
          unit: scalar.cohort?.descriptor?.unit ?? read.unit,
          vintage_source: sources.map((source: any) => source.name).join(' · '),
          vintage_version: sources.map((source: any) => source.version).join(' · '),
          vintage_date_reference: sources.map((source: any) => source.reference_date).join(' · ') || null,
          vintage_date_publication: sources.map((source: any) => source.publication_date).join(' · ') || null,
          fact_status: observation.status, source_id: sources.map((source: any) => source.source_id).join(' · ') || null,
          vintage_id: sources.map((source: any) => source.vintage_id).join(' · ') || null,
          rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null,
          fact_sources: sources.map((source: any) => ({ sourceId: source.source_id, source: source.name,
            version: source.version, vintageId: source.vintage_id, referenceDate: source.reference_date,
            publicationDate: source.publication_date })),
          ...(scalar.comparison?.result?.status === 'available' && rank?.rank !== null && rank?.rank !== undefined
            ? { comparaisonApi: { rang: rank.rank, taille: rank.rank_size ?? null,
              portee: scalar.comparison.scope?.label ?? null,
              direction: scalar.comparison.result.direction === 'high' || scalar.comparison.result.direction === 'low'
                ? scalar.comparison.result.direction : undefined } } : {}),
          native_scalar_comparison: scalar.comparison?.result ? {
            status: scalar.comparison.result.status, statistic: scalar.comparison.result.statistic,
            value: scalar.comparison.result.median ?? scalar.comparison.result.mean ?? null,
            eligible_count: scalar.comparison.result.eligible_count,
            missing_count: scalar.comparison.result.missing_count,
            rank: rank?.rank ?? null, rank_size: rank?.rank_size ?? null, rank_ties: rank?.rank_ties ?? null,
          } : undefined,
        })
      }
    }
    const focalObservation = scalar.focal?.observation
    if (focalObservation && !rows.some((fact) => fact.territoire === read.territory.id && fact.detail === null)) {
      const sources = focalObservation.sources ?? []
      rows.push({ territoire: read.territory.id, type: read.territory.type, theme, key: read.indicator_id,
        detail: null, value: focalObservation.status === 'measured' ? focalObservation.value : null,
        unit: scalar.focal?.descriptor?.unit ?? read.unit,
        vintage_source: sources.map((source: any) => source.name).join(' · '),
        vintage_version: sources.map((source: any) => source.version).join(' · '),
        vintage_date_reference: sources.map((source: any) => source.reference_date).join(' · ') || null,
        vintage_date_publication: sources.map((source: any) => source.publication_date).join(' · ') || null,
        fact_status: focalObservation.status, source_id: sources.map((source: any) => source.source_id).join(' · ') || null,
        vintage_id: sources.map((source: any) => source.vintage_id).join(' · ') || null,
        rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null,
        fact_sources: sources.map((source: any) => ({ sourceId: source.source_id, source: source.name,
          version: source.version, vintageId: source.vintage_id, referenceDate: source.reference_date,
          publicationDate: source.publication_date })),
      })
    }
  }
  return rows
}

/** Replace trajectory points from the API while retaining any canonical scalar headline. */
export function mergeOrderedSeriesFacts(
  existing: readonly Indicateur[],
  indicator: string,
  seriesFacts: readonly Indicateur[],
): Indicateur[] {
  return [...existing.filter((fact) => fact.key !== indicator || fact.detail == null), ...seriesFacts]
}
