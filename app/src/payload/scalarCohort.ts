import type { Indicateur, Territoire, TerritoireType, Theme, IndicatorPageMetadata } from './types'
import { PayloadError } from './validate'

export interface ScalarCohort {
  indicator_id: string; territory_type: TerritoireType; label: string; unit: string
  direction: 'high' | 'low'; comparison_facet: string; completeness: string; content_version: string
  observations: Array<{ territory_id: string; name: string; value: number | null; status: string;
    sources: Array<{ source_id: string; name: string; vintage_id: string; version: string;
      reference_date: string | null; publication_date: string | null }> }>
}

export function scalarCohortEnabled(env: Record<string, string | undefined>): boolean {
  return env.VITE_SCALAR_COHORT_API === '1'
}

/** Registration is producer-owned; a declared page alone does not opt into scalar serving. */
export function indicateursScalairesEnregistres(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || !('scalar_contracts' in raw)) return []
  const declarations = (raw as { scalar_contracts: unknown }).scalar_contracts
  if (Array.isArray(declarations) && declarations.every((item) => typeof item === 'string')) return declarations
  if (typeof declarations === 'object' && declarations !== null && !Array.isArray(declarations)) return Object.keys(declarations)
  throw new PayloadError('validation', 'theme_economie.json', 'Le registre producer-owned scalar_contracts est mal formé.')
}

export function choisirFocalCohorte(territories: Territoire[], level: TerritoireType,
  selectedId: string | undefined, scope: { department?: string; epci?: string }): Territoire | null {
  const eligible = territories.filter((t) => t.type === level &&
    (!scope.department || t.departement === scope.department) && (!scope.epci || t.epci === scope.epci))
  return eligible.find((t) => t.territoire === selectedId) ?? eligible[0] ?? null
}

export async function chargerCohorteScalaire(indicator: string, theme: Theme, page: IndicatorPageMetadata,
  focal: Territoire, level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
): Promise<Indicateur[]> {
  const query = new URLSearchParams({ scope_level: level })
  if (level === 'commune' && scope.department) query.set('department_id', scope.department)
  if (level === 'commune' && scope.epci) query.set('epci_id', scope.epci)
  const path = `/api/territories/${encodeURIComponent(focal.type)}/${encodeURIComponent(focal.territoire)}/indicator-cohorts/${encodeURIComponent(indicator)}?${query}`
  let response: Response
  try { response = await fetch(path) }
  catch (cause) { throw new PayloadError('fetch', path, `API de l’indicateur indisponible : ${cause instanceof Error ? cause.message : String(cause)}`) }
  if (!response.ok) throw new PayloadError('fetch', path, `L’indicateur n’est pas disponible (HTTP ${response.status}).`)
  let read: ScalarCohort
  try { read = await response.json() as ScalarCohort }
  catch { throw new PayloadError('validation', path, 'Réponse illisible de l’API de l’indicateur.') }
  if (read.indicator_id !== indicator || read.territory_type !== level || !read.content_version ||
      read.label !== page.label || read.unit !== page.unit || read.direction !== page.direction ||
      read.comparison_facet !== indicator || !Array.isArray(read.observations)) {
    throw new PayloadError('validation', path, 'Le contrat du cohort scalaire est incompatible avec la page déclarée.')
  }
  const refs = new Map(territories.filter((t) => t.type === level).map((t) => [t.territoire, t]))
  const seen = new Set<string>()
  return read.observations.map((row) => {
    const ref = refs.get(row.territory_id)
    if (!ref || seen.has(row.territory_id) || (row.status === 'measured') !== (row.value !== null) ||
        (row.value !== null && !Number.isFinite(row.value)) || !Array.isArray(row.sources)) {
      throw new PayloadError('validation', path, 'Le cohort contient un territoire, une valeur ou un état invalide.')
    }
    seen.add(row.territory_id)
    if (row.status !== 'not_published' && row.sources.length === 0) {
      throw new PayloadError('validation', path, 'La provenance d’une observation du cohort est absente.')
    }
    const source = row.sources[0]
    return { territoire: row.territory_id, type: level, theme, key: indicator, detail: null,
      value: row.status === 'measured' ? row.value : null, unit: read.unit,
      observation_status: row.status === 'measured' ? 'measured' as const : 'missing' as const,
      vintage_source: source?.name ?? '', vintage_version: source?.version ?? '',
      vintage_date_reference: source?.reference_date ?? null,
      vintage_date_publication: source?.publication_date ?? null,
      source_id: source?.source_id ?? null, vintage_id: source?.vintage_id ?? null,
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
  })
}
