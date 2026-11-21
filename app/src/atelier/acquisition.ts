/**
 * Cellule acquisition for the Atelier (ADR-0046, #1075/#1076/#1078).
 *
 * This module owns the DEMAND, the target shape and the join input — never the
 * transport. Coalescing, the 12-item batching, the two-request scheduler,
 * deadlines, typed `publication_unavailable` and the publication-identity cache
 * all belong to the shared semantic client we call into.
 */

import {
  publicationFamilyForResource,
  readSemanticOutcomes,
  type SemanticPublicationFamily,
  type SemanticReadOutcome,
} from '@/payload/semanticResourceClient'

import { cellKey, type AtelierState, type Binding, type CellRef, type FigureSpec } from './state'
import type { AdmittedCohort, CelluleDemand, CohortSource, CohortValue, DiscoveryResource } from './types'

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isBinding(value: unknown): value is Binding {
  return isRecord(value) && ('cell' in value || 'formula' in value)
}

/** Every Cellule a figure needs: variables, Formule operands and value thresholds. */
function cellRefsOf(figure: FigureSpec): CellRef[] {
  const bindings: Binding[] = []
  for (const binding of Object.values(figure.variables)) if (isBinding(binding)) bindings.push(binding)
  for (const threshold of figure.population.values ?? []) bindings.push(threshold.variable)
  const refs: CellRef[] = []
  for (const binding of bindings) {
    if ('cell' in binding) refs.push(binding.cell)
    else refs.push(...Object.values(binding.formula.operands))
  }
  return refs
}

/**
 * One whole-level cohort per distinct Cellule at each level. Batching and
 * coalescing are the client's; we simply hand it a deduplicated demand.
 */
export function planCelluleDemand(state: AtelierState): CelluleDemand[] {
  const demand = new Map<string, CelluleDemand>()
  for (const block of state.blocks) {
    if (block.kind !== 'figure') continue
    const level = block.figure.level
    for (const cell of cellRefsOf(block.figure)) {
      const key = `${cellKey(cell)}|${level}`
      if (demand.has(key)) continue
      demand.set(key, {
        key,
        cell,
        level,
        item: {
          resource: cell.resource,
          target: { kind: 'territory_cohort', type: level },
          coordinates: Object.fromEntries(Object.entries(cell.coordinates).map(([axis, value]) => [axis, [value]])),
          intent: { kind: 'facts' },
        },
      })
    }
  }
  return [...demand.values()]
}

/** A stable namespace for the client's publication-identity cache. */
function coherenceOf(discovery: readonly DiscoveryResource[] | undefined): string {
  if (!discovery?.length) return 'atelier-cellule-v1'
  const declarations = discovery
    .map((resource) => [resource.resource_id, resource.shapes, resource.cellule ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return `atelier-cellule-v1:${JSON.stringify(declarations)}`
}

function expectedFamiliesOf(discovery: readonly DiscoveryResource[] | undefined): Map<string, SemanticPublicationFamily> {
  const families = new Map<string, SemanticPublicationFamily>()
  for (const resource of discovery ?? []) families.set(resource.resource_id, publicationFamilyForResource(resource))
  return families
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normaliseSource(raw: unknown): CohortSource | null {
  if (!isRecord(raw) || typeof raw.source_id !== 'string' || !raw.source_id) return null
  return {
    sourceId: raw.source_id,
    name: typeof raw.name === 'string' ? raw.name
      : typeof raw.source_name === 'string' ? raw.source_name : raw.source_id,
    ...(typeof raw.vintage_id === 'string' ? { vintageId: raw.vintage_id } : {}),
    ...(typeof raw.version === 'string' ? { version: raw.version }
      : typeof raw.source_version === 'string' ? { version: raw.source_version } : {}),
    ...(typeof raw.reference_date === 'string' ? { referenceDate: raw.reference_date } : {}),
    ...(typeof raw.publication_date === 'string' ? { publicationDate: raw.publication_date } : {}),
  }
}

function sourcesOf(entry: Raw): CohortSource[] {
  const nested = entry.sources ?? entry.provenance
  if (Array.isArray(nested)) {
    return nested.map(normaliseSource).filter((source): source is CohortSource => source !== null)
  }
  // AEDAR observations carry flat provenance on the observation itself.
  const flat = normaliseSource(entry)
  return flat ? [flat] : []
}

function territoryOf(entry: Raw): { id: string; type: string; nom: string } | null {
  const territory = entry.territory
  if (!isRecord(territory)) return null
  const id = territory.id ?? territory.territoire
  const nom = territory.name ?? territory.nom
  if (typeof id !== 'string' || typeof nom !== 'string') return null
  return { id, type: typeof territory.type === 'string' ? territory.type : '', nom }
}

function valueOf(entry: Raw): number | null {
  // An absent, suppressed, uncovered or non-finite reading is null, never zero.
  return finite(entry.value)
}

function normaliseEntry(entry: unknown): CohortValue | null {
  if (!isRecord(entry)) return null
  const territory = territoryOf(entry)
  if (!territory) return null
  return {
    territory: territory.id,
    type: territory.type,
    nom: territory.nom,
    value: valueOf(entry),
    sources: sourcesOf(entry),
  }
}

/** Normalise the native cohort families into one per-territory shape; no shape is invented. */
function normaliseValues(data: Raw): { values: CohortValue[]; shape: string } | null {
  if (Array.isArray(data.observations)) {
    return { shape: 'scalar', values: data.observations.map(normaliseEntry).filter((v): v is CohortValue => v !== null) }
  }
  if (Array.isArray(data.values)) {
    return { shape: 'aedar', values: data.values.map(normaliseEntry).filter((v): v is CohortValue => v !== null) }
  }
  if (Array.isArray(data.profiles)) {
    const values: CohortValue[] = []
    for (const member of data.profiles) {
      if (!isRecord(member) || !Array.isArray(member.cells) || !isRecord(member.cells[0])) continue
      const entry = normaliseEntry({ ...member, ...member.cells[0], territory: member.territory })
      if (entry) values.push(entry)
    }
    return { shape: 'declared_profile', values }
  }
  if (Array.isArray(data.series)) {
    const values: CohortValue[] = []
    for (const member of data.series) {
      if (!isRecord(member) || !Array.isArray(member.points) || !isRecord(member.points[0])) continue
      const entry = normaliseEntry({ ...member, ...member.points[0], territory: member.territory })
      if (entry) values.push(entry)
    }
    return { shape: 'ordered_series', values }
  }
  return null
}

function toCohort(demand: CelluleDemand, outcome: SemanticReadOutcome): AdmittedCohort {
  const base = { key: demand.key, cell: demand.cell, level: demand.level, values: [] as CohortValue[] }
  if (outcome.status === 'publication_unavailable') {
    return { ...base, availability: { status: 'publication_unavailable', reason: outcome.reason, family: outcome.family } }
  }
  const normalised = normaliseValues(outcome.data)
  if (!normalised) {
    return { ...base, availability: { status: 'unsupported_shape', shape: String(outcome.data.shape ?? 'inconnu') } }
  }
  return { ...base, availability: { status: 'available' }, values: normalised.values }
}

export interface AcquisitionOptions {
  /** Injected by specs; defaults to the browser fetch. */
  fetcher?: typeof fetch
  /** Producer declarations, for the typed family of an absent publication and the cache identity. */
  discovery?: readonly DiscoveryResource[]
  signal?: AbortSignal
}

/** Acquire every needed Cellule once, through the one shared semantic client. */
export async function acquireCellules(state: AtelierState, options: AcquisitionOptions = {}): Promise<AdmittedCohort[]> {
  const demand = planCelluleDemand(state)
  if (!demand.length) return []
  const outcomes = await readSemanticOutcomes(
    demand.map((entry) => entry.item),
    {
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      coherence: coherenceOf(options.discovery),
      expectedFamilies: expectedFamiliesOf(options.discovery),
    },
  )
  return demand.map((entry, index) => toCohort(entry, outcomes[index]!))
}
