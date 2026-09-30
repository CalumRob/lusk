import type { Indicateur, Territoire, Theme, TerritoireType } from './types'

export interface OrderedSeriesPoint {
  axis: string
  observation_period: string | null
  value: number | null
  status: 'measured' | 'missing'
  source_id?: string
  vintage_id?: string
  source_version?: string | null
  source_reference_date?: string | null
  source_publication_date?: string | null
  provenance?: Array<{ revision_id: string; source_id: string; vintage_id: string; source_name: string;
    dataset_name: string; version: string; reference_date: string; publication_date: string; revision_hash: string }>
}

export interface OrderedSeriesTerritory {
  territory: { id: string; type: TerritoireType; name: string }
  points: OrderedSeriesPoint[]
}

export interface OrderedSeriesRead {
  indicator_id: string
  axis_kind: 'year' | 'state_role'
  unit: string
  territory: { id: string; type: TerritoireType; name: string }
  points: OrderedSeriesPoint[]
  dataset_id?: string
  scope_series?: OrderedSeriesTerritory[]
  comparison: {
    point: string | null
    value: number | null
    median: number | null
    rank: number | null
    ties: number | null
    comparable_count: number
    scope: { kind: string; territory_type: string; department_id?: string | null; epci_id?: string | null }
  } | null
}

export interface OrderedSeriesAdapter {
  theme: Theme
  indicator: string
  pathIndicator: string
  datasetId?: string
}

// Adapter registration is a data seam, not page markup: the renderer continues
// to use the existing indicator-page grammar and never knows about API shapes.
const adapters: readonly OrderedSeriesAdapter[] = [
  { theme: 'milieux', indicator: 'conso_enaf_annuel', pathIndicator: 'conso_enaf_annuel' },
  { theme: 'milieux', indicator: 'artif_par_habitant', pathIndicator: 'artif_par_habitant', datasetId: 'ocsge_artif_etats' },
]

export function orderedSeriesAdapterFor(theme: string, indicator: string): OrderedSeriesAdapter | null {
  return adapters.find((adapter) => adapter.theme === theme && adapter.indicator === indicator) ?? null
}

/** Convert an API snapshot to the app's existing fact contract without filling gaps. */
export function orderedSeriesFacts(
  read: OrderedSeriesRead,
  theme: Theme,
  territories: readonly Territoire[],
): Indicateur[] {
  const refs = new Map(territories.map((territory) => [territory.territoire, territory] as const))
  const groups = read.scope_series ? [...read.scope_series] : []
  if (!groups.some((group) => group.territory.id === read.territory.id)) {
    groups.push({ territory: read.territory, points: read.points })
  }
  const pointAxis = read.points.map((point) => point.axis)
  const rows: Indicateur[] = []
  for (const group of groups) {
    const ref = refs.get(group.territory.id)
    if (!ref || ref.type !== group.territory.type) continue
    const byAxis = new Map(group.points.map((point) => [point.axis, point] as const))
    for (const axis of pointAxis) {
      const point = byAxis.get(axis)
      rows.push({
        territoire: ref.territoire,
        type: ref.type,
        theme,
        key: read.indicator_id,
        detail: axis,
        value: point?.status === 'measured' ? point.value : null,
        unit: read.unit,
        vintage_source: point?.provenance?.map((lineage) => lineage.source_name).join(' · ') ?? point?.source_id ?? '',
        vintage_version: point?.provenance?.map((lineage) => lineage.version).join(' · ') ?? point?.source_version ?? point?.vintage_id ?? '',
        vintage_date_reference: point?.provenance?.map((lineage) => lineage.reference_date).join(' · ') ?? point?.source_reference_date ?? null,
        vintage_date_publication: point?.provenance?.map((lineage) => lineage.publication_date).join(' · ') ?? point?.source_publication_date ?? null,
        rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
        rang_reg: null, rang_reg_n: null,
        observation_status: point?.status ?? 'missing',
        observation_period: point?.observation_period ?? null,
        source_id: point?.source_id ?? null,
        vintage_id: point?.vintage_id ?? null,
        provenance_revisions: point?.provenance ?? [],
      })
    }
  }
  return rows
}
