/**
 * The Atelier join (#1074/#1079): a pure function from page state, discovery,
 * the territory reference and admitted cohorts to what a page renders.
 *
 * No network, no DOM, no Vue. No derived value leaves this module: a plotted
 * value is a Cellule's published value carried through unchanged. Formules are
 * NOT evaluated (#1085), population filters are NOT evaluated (#1089), and no
 * direction or rank is computed (ADR-0046).
 */

import type { Territoire } from '@/payload/types'

import { cellKey, type AtelierLevel, type AtelierState, type AttributeBinding, type Binding, type CellRef, type FigureSpec } from './state'
import type { AdmittedCohort, CohortSource, DiscoveryResource } from './types'

export interface FigureTerritory {
  id: string
  type: string
  nom: string
}

export interface PlottedValues {
  x?: number | string
  y?: number | string
  taille?: number | string
  couleur?: number | string
}

export interface PlottedPoint {
  territory: FigureTerritory
  values: PlottedValues
}

export interface NonTracee {
  territory: FigureTerritory
  reasons: string[]
}

export interface ExcludedPoint {
  territory: FigureTerritory
  reason: string
}

export interface RenderedFigure {
  id: string
  type: FigureSpec['type']
  level: AtelierLevel
  /** Reader title, or the generated cahier title when the reader did not edit it. */
  title: string
  titleGenerated: boolean
  /** Resolved titles: the reader's override or the default carrying the unit. */
  axisTitles: { x?: string; y?: string }
  points: PlottedPoint[]
  nonTracees: { count: number; territories: NonTracee[] }
  /** Populated by the Filtre de population (#1089); empty until then. */
  excluded: ExcludedPoint[]
  sources: CohortSource[]
}

export interface JoinOptions {
  state: AtelierState
  discovery: readonly DiscoveryResource[]
  reference: readonly Territoire[]
  cohorts: readonly AdmittedCohort[]
}

type Role = 'x' | 'y' | 'taille' | 'couleur'
type Resolution = { value?: number | string; reason?: string }

const ATTRIBUTE_LABELS: Record<AttributeBinding['attribute'], string> = {
  densite: 'Classe de densité',
  littoral: 'Classification littorale',
  departement: 'Département',
  epci: 'EPCI',
}

const isBinding = (value: unknown): value is Binding =>
  typeof value === 'object' && value !== null && ('cell' in value || 'formula' in value)

function refsOf(binding: Binding): CellRef[] {
  return 'cell' in binding ? [binding.cell] : Object.values(binding.formula.operands)
}

function boundRefs(figure: FigureSpec): CellRef[] {
  const bindings: Binding[] = []
  for (const binding of Object.values(figure.variables)) if (isBinding(binding)) bindings.push(binding)
  for (const threshold of figure.population.values ?? []) bindings.push(threshold.variable)
  return bindings.flatMap(refsOf)
}

function resourceFor(cell: CellRef, discovery: readonly DiscoveryResource[]): DiscoveryResource | undefined {
  return discovery.find((resource) => resource.resource_id === cell.resource)
}

function coordinateLabels(cell: CellRef, discovery: readonly DiscoveryResource[]): string[] {
  const resource = resourceFor(cell, discovery)
  if (!resource) return []
  return (resource.cellule?.coordinates ?? []).map((coordinate) => {
    const bound = cell.coordinates[coordinate.name]
    return coordinate.values.find((value) => value.value === bound)?.label ?? bound
  }).filter((label): label is string => typeof label === 'string' && label.length > 0)
}

function unitOf(cell: CellRef, discovery: readonly DiscoveryResource[]): string | null {
  const resource = resourceFor(cell, discovery)
  if (!resource) return null
  for (const coordinate of resource.cellule?.coordinates ?? []) {
    const bound = cell.coordinates[coordinate.name]
    const declared = coordinate.values.find((value) => value.value === bound)
    if (declared?.unit) return declared.unit
  }
  return resource.unit || null
}

function bindingLabel(binding: Binding | undefined, discovery: readonly DiscoveryResource[]): string {
  if (!binding) return '…'
  if ('formula' in binding) return binding.formula.expression.trim() || '…'
  const resource = resourceFor(binding.cell, discovery)
  if (!resource) return '…'
  return [resource.label, ...coordinateLabels(binding.cell, discovery)].join(' · ')
}

function defaultAxisTitle(binding: Binding | undefined, discovery: readonly DiscoveryResource[]): string | undefined {
  if (!binding) return undefined
  const label = bindingLabel(binding, discovery)
  if (label === '…') return undefined
  if ('formula' in binding) return label // A Formule makes no unit claim (ADR-0046).
  const unit = unitOf(binding.cell, discovery)
  return unit ? `${label} (${unit})` : label
}

function attributeValue(attribute: AttributeBinding['attribute'], territory: Territoire): string | null {
  switch (attribute) {
    case 'densite': return territory.classe_densite_libelle_public ?? territory.classe_densite_code ?? null
    case 'littoral': return territory.littoral_code ?? null
    case 'departement': return territory.departement ?? null
    case 'epci': return territory.epci ?? null
  }
}

function resolve(
  role: Role,
  binding: Binding | AttributeBinding | undefined,
  territory: Territoire,
  figure: FigureSpec,
  cohorts: Map<string, AdmittedCohort>,
): Resolution {
  if (!binding) return {}
  if ('attribute' in binding) {
    const value = attributeValue(binding.attribute, territory)
    return value === null ? { reason: `${role} : catégorie absente` } : { value }
  }
  if ('formula' in binding) {
    return { reason: `${role} : Formule non évaluée (#1085)` }
  }
  const cohort = cohorts.get(`${cellKey(binding.cell)}|${figure.level}`)
  if (!cohort) return { reason: `${role} : Cellule non acquise` }
  if (cohort.availability.status === 'publication_unavailable') {
    return { reason: `${role} : publication indisponible` }
  }
  if (cohort.availability.status === 'unsupported_shape') {
    return { reason: `${role} : forme de cohorte non prise en charge` }
  }
  const row = cohort.values.find((value) => value.territory === territory.territoire)
  if (!row) return { reason: `${role} : absence de donnée` }
  if (row.value === null) return { reason: `${role} : valeur absente` }
  return { value: row.value }
}

/** Only datasets actually observed by a bound Cellule are cited, once each. */
function sourcesUsed(figure: FigureSpec, cohorts: Map<string, AdmittedCohort>): CohortSource[] {
  const seen = new Set<string>()
  const sources: CohortSource[] = []
  for (const cell of boundRefs(figure)) {
    const cohort = cohorts.get(`${cellKey(cell)}|${figure.level}`)
    if (!cohort || cohort.availability.status !== 'available') continue
    for (const value of cohort.values) {
      if (value.value === null) continue
      for (const source of value.sources) {
        const key = `${source.sourceId}|${source.vintageId ?? ''}|${source.version ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        sources.push(source)
      }
    }
  }
  return sources
}

function territoryIdentity(territory: Territoire): FigureTerritory {
  return { id: territory.territoire, type: territory.type, nom: territory.nom }
}

function renderFigure(
  block: Extract<AtelierState['blocks'][number], { kind: 'figure' }>,
  options: JoinOptions,
  cohorts: Map<string, AdmittedCohort>,
): RenderedFigure {
  const figure = block.figure
  const roles: Role[] = ['x', 'y', 'taille', 'couleur']
  const points: PlottedPoint[] = []
  const nonTracees: NonTracee[] = []

  for (const territory of options.reference) {
    if (territory.type !== figure.level) continue
    const values: PlottedValues = {}
    const reasons: string[] = []
    for (const role of roles) {
      const resolved = resolve(role, figure.variables[role], territory, figure, cohorts)
      if (resolved.value === undefined) {
        if (resolved.reason) reasons.push(resolved.reason)
      } else {
        values[role] = resolved.value
      }
    }
    if (reasons.length) nonTracees.push({ territory: territoryIdentity(territory), reasons })
    else points.push({ territory: territoryIdentity(territory), values })
  }

  const generated = `y : ${bindingLabel(figure.variables.y, options.discovery)} · x : ${bindingLabel(figure.variables.x, options.discovery)}`
  return {
    id: block.id,
    type: figure.type,
    level: figure.level,
    title: figure.title ?? generated,
    titleGenerated: figure.title === undefined,
    axisTitles: {
      x: figure.axisTitles?.x ?? defaultAxisTitle(figure.variables.x, options.discovery),
      y: figure.axisTitles?.y ?? defaultAxisTitle(figure.variables.y, options.discovery),
    },
    points,
    nonTracees: { count: nonTracees.length, territories: nonTracees },
    excluded: [],
    sources: sourcesUsed(figure, cohorts),
  }
}

/** Pure projection; the caller decides what to render and never recomputes a value. */
export function joinFigures(options: JoinOptions): RenderedFigure[] {
  const cohorts = new Map(options.cohorts.map((cohort) => [cohort.key, cohort]))
  return options.state.blocks
    .filter((block): block is Extract<AtelierState['blocks'][number], { kind: 'figure' }> => block.kind === 'figure')
    .map((block) => renderFigure(block, options, cohorts))
}
