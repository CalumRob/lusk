import type { Indicateur, Territoire, ThemeMetadata } from './types'
import { PayloadError, validerThemeMetadata } from './validate'

export async function chargerMetadataStructureAge(): Promise<ThemeMetadata> {
  const file = 'theme_demographie.json'
  const url = `/data/${file}`
  let response: Response
  try { response = await fetch(url) }
  catch (cause) { throw new PayloadError('fetch', file, `Métadonnées indisponibles : ${cause instanceof Error ? cause.message : String(cause)}`) }
  if (!response.ok) throw new PayloadError('fetch', file, `Réponse HTTP ${response.status} pour ${url}`)
  let raw: unknown
  try { raw = await response.json() }
  catch { throw new PayloadError('validation', file, `JSON illisible dans ${url}`) }
  return validerThemeMetadata(raw, file)
}

export interface StructureAgeProfileResponse {
  indicator: string
  label: string
  unit: string
  content_version: string
  comparison: {
    detail: string
    sex: string
    direction: 'high' | 'low' | 'none'
    scope: string
    scope_id: string | null
    values: Array<{ territory_id: string; name: string; value: number | null; status: string }>
  }
  axes: Array<{ name: string; key: string; label: string; order: number }>
  cells: Array<{ detail: string; sex: string; value: number | null; status: string }>
  sources: Array<{ source_id: string; name: string; version: string; reference_date: string | null; publication_date: string | null }>
}

export function structureAgeProfileEnabled(env: Record<string, string | undefined>): boolean {
  return env.VITE_STRUCTURE_AGE_PROFILE_API === '1'
}

/** Keep unrelated static facts while making structure_age API-only. */
export function remplacerStructureAgeStatique(staticFacts: Indicateur[], apiFacts: Indicateur[]): Indicateur[] {
  return [...staticFacts.filter((fact) => fact.key !== 'structure_age'), ...apiFacts]
}

function parseProfile(raw: unknown, declaration: { details: string[]; sexes: string[]; labels: Record<string, string>; detail: string; sex: string; label: string; unit: string; direction: string; sources: string[] }, scope: string, scopeId?: string): StructureAgeProfileResponse {
  if (typeof raw !== 'object' || raw === null) throw new Error('Réponse de profil invalide')
  const value = raw as Partial<StructureAgeProfileResponse>
  if (value.indicator !== 'structure_age' || typeof value.content_version !== 'string' ||
      !value.comparison || !Array.isArray(value.axes) || !Array.isArray(value.cells) ||
      !Array.isArray(value.sources) || !Array.isArray(value.comparison.values)) {
    throw new Error('Contrat du profil incomplet')
  }
  const expectedCoordinates = declaration.details.flatMap((detail) => declaration.sexes.map((sex) => `${detail}\0${sex}`))
  const axes = value.axes as StructureAgeProfileResponse['axes']
  const cells = value.cells as StructureAgeProfileResponse['cells']
  const sources = value.sources as StructureAgeProfileResponse['sources']
  const axisKeys = new Set(axes.map((axis) => `${axis.name}\0${axis.key}`))
  const cellKeys = new Set(cells.map((cell) => `${cell.detail}\0${cell.sex}`))
  const expectedAxes = [...declaration.details.map((key, order) => ({ name: 'detail', key, label: declaration.labels[key], order })),
    ...declaration.sexes.map((key, order) => ({ name: 'sex', key, label: key, order }))]
  if (axes.length !== declaration.details.length + declaration.sexes.length ||
      cells.length !== expectedCoordinates.length || sources.length !== 1 || declaration.sources.length !== 1 ||
      sources[0]?.source_id !== declaration.sources[0] ||
      value.label !== declaration.label || value.unit !== declaration.unit ||
      value.comparison.detail !== declaration.detail || value.comparison.sex !== declaration.sex ||
      value.comparison.direction !== declaration.direction || value.comparison.scope !== scope ||
      value.comparison.scope_id !== (scopeId ?? null) ||
      !declaration.details.every((detail) => axisKeys.has(`detail\0${detail}`)) ||
      !declaration.sexes.every((sex) => axisKeys.has(`sex\0${sex}`)) ||
      expectedAxes.some((expected) => !axes.some((axis) => axis.name === expected.name &&
        axis.key === expected.key && axis.label === expected.label && axis.order === expected.order)) ||
      expectedCoordinates.some((key) => !cellKeys.has(key)) ||
      cellKeys.size !== value.cells.length ||
      cells.some((cell) => cell.value !== null && !Number.isFinite(cell.value)) ||
      value.comparison.values.some((item) => item.value !== null && !Number.isFinite(item.value)) ||
      value.cells.some((cell) => (cell.status === 'measured') !== (cell.value !== null)) ||
      value.comparison.values.some((item) => (item.status === 'measured') !== (item.value !== null)) ||
      axes.some((axis) => !Number.isInteger(axis.order) || axis.order < 0) ||
      cells.some((cell) => !['measured', 'not_available', 'suppressed', 'unsupported'].includes(cell.status)) ||
      value.comparison.values.some((item) => !['measured', 'not_available', 'suppressed', 'unsupported'].includes(item.status))) {
    throw new Error('Le profil déclaré est incomplet ou mal formé')
  }
  return value as StructureAgeProfileResponse
}

export async function chargerStructureAgeProfile(
  selected: Territoire,
  territories: Territoire[],
  scope: { department?: string; epci?: string },
  declaration: { details: string[]; sexes: string[]; labels: Record<string, string>; detail: string; sex: string; label: string; unit: string; direction: string; sources: string[] },
): Promise<Indicateur[]> {
  const comparisonScope = selected.type !== 'commune' ? 'bretagne' : scope.department ? 'departement' : scope.epci ? 'epci' : 'bretagne'
  const scopeId = selected.type === 'commune' ? scope.department ?? scope.epci : undefined
  const query = scopeId ? `?comparison_scope=${comparisonScope}&comparison_scope_id=${encodeURIComponent(scopeId)}` : ''
  const path = `/api/territories/${encodeURIComponent(selected.type)}/${encodeURIComponent(selected.territoire)}/profiles/structure_age${query}`
  let response: Response
  try { response = await fetch(path) }
  catch (cause) {
    throw new PayloadError('fetch', path, `API du profil indisponible : ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!response.ok) throw new PayloadError('fetch', path, `Le profil n’est pas disponible (HTTP ${response.status}).`)
  let raw: unknown
  try { raw = await response.json() }
  catch { throw new PayloadError('validation', path, 'Réponse illisible de l’API du profil.') }
  let profile: StructureAgeProfileResponse
  try { profile = parseProfile(raw, declaration, comparisonScope, scopeId) }
  catch (cause) { throw new PayloadError('validation', path, cause instanceof Error ? cause.message : String(cause)) }
  const [source] = profile.sources
  if (!source) throw new PayloadError('validation', path, 'La provenance du profil est absente.')
  const peerIds = profile.comparison.values.map((item) => item.territory_id)
  if (new Set(peerIds).size !== peerIds.length || !peerIds.includes(selected.territoire)) {
    throw new PayloadError('validation', path, 'La facette comparative doit contenir une seule ligne pour le territoire focal.')
  }
  const vintage = {
    vintage_source: source.name,
    vintage_version: source.version,
    vintage_date_reference: source.reference_date,
    vintage_date_publication: source.publication_date,
  }
  const common = {
    theme: 'demographie' as const, key: profile.indicator, unit: profile.unit,
    rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
    rang_reg: null, rang_reg_n: null, ...vintage,
  }
  const level = selected.type
  const comparison = profile.comparison.values.map((item): Indicateur => {
    const territory = territories.find((candidate) => candidate.territoire === item.territory_id)
    if (!territory || territory.type !== selected.type || (item.status === 'measured') !== (item.value !== null)) {
      throw new PayloadError('validation', path, 'La facette comparative référence un territoire ou un état invalide.')
    }
    return ({
    ...common, territoire: item.territory_id,
    type: territory.type,
    detail: profile.comparison.detail, sex: profile.comparison.sex as 'F' | 'M',
    value: item.status === 'measured' ? item.value : null,
  })})
  const cells = profile.cells.map((cell): Indicateur => ({
    ...common, territoire: selected.territoire, type: level,
    detail: cell.detail, sex: cell.sex as 'F' | 'M',
    value: cell.status === 'measured' ? cell.value : null,
  }))
  const keys = new Set([...comparison, ...cells].map((fact) => `${fact.territoire}\0${fact.detail}\0${fact.sex}`))
  if (keys.size !== comparison.length + cells.length) {
    return [...comparison.filter((fact) => !(fact.territoire === selected.territoire &&
      fact.detail === profile.comparison.detail && fact.sex === profile.comparison.sex)), ...cells]
  }
  return [...comparison, ...cells]
}
