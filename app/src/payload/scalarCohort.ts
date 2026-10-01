import type { Indicateur, Territoire, TerritoireType, Theme, IndicatorPageMetadata, ThemeMetadata } from './types'
import { PayloadError } from './validate'

export interface ScalarCohort {
  indicator_id: string; territory_type: TerritoireType; label: string; unit: string
  direction: 'high' | 'low'; comparison_facet: string; completeness: string; content_version: string
  observations: Array<{ territory_id: string; name: string; value: number | null; status: string;
    rang_epci: number | null; rang_epci_n: number | null; rang_dep: number | null; rang_dep_n: number | null;
    rang_reg: number | null; rang_reg_n: number | null;
    sources: Array<{ source_id: string; name: string; vintage_id: string; version: string;
      reference_date: string | null; publication_date: string | null }> }>
}

export function scalarCohortEnabled(env: Record<string, string | undefined>): boolean {
  return env.VITE_SCALAR_COHORT_API === '1'
}

/** Registration is producer-owned; a declared page alone does not opt into scalar serving. */
export function indicateursScalairesEnregistres(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('scalar_contracts' in raw)) {
    throw new PayloadError('validation', 'theme_economie.json', 'Le registre producer-owned scalar_contracts est absent ou mal formé.')
  }
  const declarations = (raw as { scalar_contracts: unknown }).scalar_contracts
  if (Array.isArray(declarations) && declarations.every((item) => typeof item === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(item)) &&
      new Set(declarations).size === declarations.length) return declarations
  if (typeof declarations === 'object' && declarations !== null && !Array.isArray(declarations) &&
      Object.entries(declarations).every(([key, value]) => /^[a-z][a-z0-9_]{0,95}$/.test(key) && value !== null && value !== false)) return Object.keys(declarations)
  throw new PayloadError('validation', 'theme_economie.json', 'Le registre producer-owned scalar_contracts est mal formé.')
}

export function validerEnregistrementScalaires(metadata: ThemeMetadata, registered: string[]): void {
  for (const id of registered) {
    const page = metadata.indicator_pages?.[id]
    if (!page || page.indicator !== id || page.family !== 'scalar') {
      throw new PayloadError('validation', 'theme_economie.json', `Le contrat scalaire « ${id} » n’a pas de page scalaire correspondante.`)
    }
  }
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
  if (!read || typeof read !== 'object' || read.indicator_id !== indicator || read.territory_type !== level ||
      typeof read.content_version !== 'string' || !read.content_version ||
      read.label !== page.label || read.unit !== page.unit || read.direction !== page.direction ||
      read.comparison_facet !== (page.comparison?.indicator ?? indicator) ||
      !['sparse', 'dense_complete'].includes(read.completeness) || !Array.isArray(read.observations)) {
    throw new PayloadError('validation', path, 'Le contrat du cohort scalaire est incompatible avec la page déclarée.')
  }
  const refs = new Map(territories.filter((t) => t.type === level).map((t) => [t.territoire, t]))
  const seen = new Set<string>()
  const facts = read.observations.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.territory_id !== 'string' ||
        typeof candidate.name !== 'string' || typeof candidate.status !== 'string') {
      throw new PayloadError('validation', path, 'Le cohort contient une observation mal formée.')
    }
    const row = candidate
    const ref = refs.get(row.territory_id)
    const statuses = ['measured', 'suppressed', 'unsupported', 'not_available', 'not_published']
    if (!ref || row.name !== ref.nom || seen.has(row.territory_id) || !statuses.includes(row.status) ||
        (row.status === 'measured') !== (row.value !== null) ||
        (row.value !== null && !Number.isFinite(row.value)) || !Array.isArray(row.sources) ||
        ![row.rang_epci, row.rang_epci_n, row.rang_dep, row.rang_dep_n, row.rang_reg, row.rang_reg_n]
          .every((rank) => rank === null || (Number.isInteger(rank) && rank >= 1))) {
      throw new PayloadError('validation', path, 'Le cohort contient un territoire, une valeur ou un état invalide.')
    }
    seen.add(row.territory_id)
    if (row.status !== 'not_published' && row.sources.length === 0) {
      throw new PayloadError('validation', path, 'La provenance d’une observation du cohort est absente.')
    }
    if (row.sources.some((source) => !source || typeof source !== 'object' ||
        typeof source.source_id !== 'string' || !page.sources.includes(source.source_id) ||
        typeof source.name !== 'string' || !source.name || typeof source.version !== 'string' || !source.version ||
        typeof source.vintage_id !== 'string' || !source.vintage_id ||
        !(source.reference_date === null || typeof source.reference_date === 'string') ||
        !(source.publication_date === null || typeof source.publication_date === 'string'))) {
      throw new PayloadError('validation', path, 'La provenance du cohort ne correspond pas aux sources déclarées.')
    }
    const source = row.sources[0]
    return { territoire: row.territory_id, type: level, theme, key: indicator, detail: null,
      value: row.status === 'measured' ? row.value : null, unit: read.unit,
      observation_status: row.status === 'measured' ? 'measured' as const : 'missing' as const,
      vintage_source: source?.name ?? '', vintage_version: source?.version ?? '',
      vintage_date_reference: source?.reference_date ?? null,
      vintage_date_publication: source?.publication_date ?? null,
      source_id: source?.source_id ?? null, vintage_id: source?.vintage_id ?? null,
      rang_epci: row.rang_epci, rang_epci_n: row.rang_epci_n,
      rang_dep: row.rang_dep, rang_dep_n: row.rang_dep_n,
      rang_reg: row.rang_reg, rang_reg_n: row.rang_reg_n }
  })
  if (!seen.has(focal.territoire)) throw new PayloadError('validation', path, 'Le territoire focal est absent du cohort annoncé.')
  return facts
}
