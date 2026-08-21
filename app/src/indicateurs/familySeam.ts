import type { IndicatorPageMetadata, Indicateur, FamilleFigure, Sexe, Territoire } from '@/payload/types'

export type FamilyStatus = 'complete' | 'partial' | 'missing'
export type FamilyRenderer = Extract<FamilleFigure, 'scalar' | 'trajectory' | 'composition' | 'distribution' | 'list' | 'relationship'>

/** The one comparison contract consumed by map, Repères, ranks and tables. */
export interface ComparisonFacet {
  indicator: string
  detail: string | null
  sex: Sexe | null
  dimension: string | null
  direction: 'high' | 'low'
  unit: string
  labels: Record<string, string>
  url: string
}

export interface FamilyDispatch {
  family: FamilyRenderer
  renderer: FamilyRenderer
  facet: ComparisonFacet
  resolvedUrl: string
  representation: { family: FamilyRenderer; rows: readonly Indicateur[]; territories: readonly Territoire[] }
  selected: Indicateur | null
  status: FamilyStatus
}

const FAMILIES = new Set<FamilyRenderer>(['scalar', 'trajectory', 'composition', 'distribution', 'list', 'relationship'])

export function normalizeComparisonFacet(page: IndicatorPageMetadata, requested: object = {}): ComparisonFacet {
  const query = requested as Record<string, unknown>
  const comparison = page.comparison ?? {}
  const detail = query.detail === page.detail ? page.detail ?? null : page.detail ?? null
  const sex = query.sex === 'F' || query.sex === 'M' ? query.sex : comparison.sex ?? null
  const dimension = typeof query.dimension === 'string' && query.dimension === comparison.dimension ? query.dimension : comparison.dimension ?? null
  const indicator = comparison.indicator || page.indicator
  const params = new URLSearchParams()
  params.set('facet', indicator)
  if (detail !== null) params.set('detail', detail)
  if (sex !== null) params.set('sex', sex)
  if (dimension !== null) params.set('dimension', dimension)
  return { indicator, detail, sex, dimension, direction: comparison.direction ?? page.direction, unit: comparison.unit ?? page.unit, labels: comparison.labels ?? {}, url: `?${params.toString()}` }
}

/** Resolve all family concerns once. Callers never switch on indicator names. */
export function dispatchIndicatorFamily(page: IndicatorPageMetadata, input: { facts?: readonly Indicateur[]; territories?: readonly Territoire[]; selected?: string; facet?: Record<string, unknown> } = {}): FamilyDispatch {
  const family = (page.family ?? 'scalar') as FamilyRenderer
  if (!FAMILIES.has(family)) throw new Error(`Famille de Repères inconnue « ${family} »`)
  const facet = normalizeComparisonFacet(page, input.facet)
  const rows = (input.facts ?? []).filter((fact) => fact.key === facet.indicator && fact.detail === facet.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex))
  const selected = rows.find((row) => row.territoire === input.selected) ?? null
  return { family, renderer: family, facet, resolvedUrl: facet.url, representation: { family, rows, territories: input.territories ?? [] }, selected, status: rows.length === 0 ? 'missing' : rows.some((row) => row.value === null) ? 'partial' : 'complete' }
}

export const familyRegistry = Object.freeze({ scalar: 'scalar', trajectory: 'trajectory', composition: 'composition', distribution: 'distribution', list: 'list', relationship: 'relationship' } as const)
