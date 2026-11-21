/**
 * Atelier page state — the decision recorded in #1074/#1079, not a working demo.
 *
 * Pure TypeScript: no Vue, no DOM, no network, no derived value. A `CellRef`
 * names a published Cellule by its producer identity and coordinates, never by
 * a label. A `Formule` binding travels through a link as the reader's own
 * expression; its evaluation belongs to #1085 and is deliberately absent here.
 */

export type AtelierLevel = 'commune' | 'epci' | 'departement'
export type FigureType = 'nuage' | 'distribution' | 'table' | 'classement'
export type Littoral = 'C' | 'NC'
export type Attribute = 'densite' | 'littoral' | 'departement' | 'epci'
export type OverlayLevel = 'epci' | 'departement' | 'region'

/** Producer identity (never a label) plus every declared coordinate. */
export interface CellRef {
  resource: string
  coordinates: Record<string, string>
}

export interface FormuleBinding {
  expression: string
  /** Letters local to this Formule (A, B, C…), each a fully-addressed Cellule. */
  operands: Record<string, CellRef>
}

export type Binding = { cell: CellRef } | { formula: FormuleBinding }
export type AttributeBinding = { attribute: Attribute }

export interface ValueThreshold {
  variable: Binding
  min?: number
  max?: number
}

export interface FigureSpec {
  type: FigureType
  level: AtelierLevel
  population: {
    departement?: string[]
    epci?: string[]
    densite?: string[]
    littoral?: Littoral[]
    values?: ValueThreshold[]
    excluded: 'hide' | 'grey'
  }
  variables: {
    x?: Binding
    y?: Binding
    taille?: Binding
    couleur?: Binding | AttributeBinding
  }
  /** Absent means the generated cahier title is used. */
  title?: string
  /** Absent means the default title (with the variable's unit) is used. */
  axisTitles?: { x?: string; y?: string }
  overlays?: Array<{ type: OverlayLevel; id: string }>
  diagonal?: boolean
}

export interface ProseBlock {
  kind: 'prose'
  id: string
  markdown: string
}

export interface FigureBlock {
  kind: 'figure'
  id: string
  figure: FigureSpec
}

export type AtelierBlock = ProseBlock | FigureBlock

export interface AtelierState {
  v: 1
  title: string
  blocks: AtelierBlock[]
}

export const STATE_VERSION = 1 as const
export const DEFAULT_TITLE = 'Atelier'

export function emptyAtelierState(): AtelierState {
  return { v: STATE_VERSION, title: DEFAULT_TITLE, blocks: [] }
}

/**
 * Stable identity of a Cellule's publication. A Cellule bound twice — in two
 * figures, or as an x and a Formule operand — has one key, so it is acquired
 * once and reused. Coordinates are sorted so key order in the link is irrelevant.
 */
export function cellKey(ref: CellRef): string {
  const axes = Object.keys(ref.coordinates).sort()
  return JSON.stringify([ref.resource, axes.map((axis) => [axis, ref.coordinates[axis]])])
}

/* ------------------------------------------------------------- validation */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const FIGURE_TYPES: readonly FigureType[] = ['nuage', 'distribution', 'table', 'classement']
const LEVELS: readonly AtelierLevel[] = ['commune', 'epci', 'departement']
const OVERLAY_LEVELS: readonly OverlayLevel[] = ['epci', 'departement', 'region']
const ATTRIBUTES: readonly Attribute[] = ['densite', 'littoral', 'departement', 'epci']

function isCellRef(value: unknown): value is CellRef {
  if (!isRecord(value) || typeof value.resource !== 'string' || !value.resource) return false
  if (!isRecord(value.coordinates)) return false
  return Object.values(value.coordinates).every((entry) => typeof entry === 'string')
}

function isBinding(value: unknown): value is Binding {
  if (!isRecord(value)) return false
  const hasCell = 'cell' in value
  const hasFormula = 'formula' in value
  if (hasCell === hasFormula) return false // exactly one variant
  if (hasCell) return isCellRef(value.cell)
  if (!isRecord(value.formula)) return false
  if (typeof value.formula.expression !== 'string' || !isRecord(value.formula.operands)) return false
  return Object.values(value.formula.operands).every(isCellRef)
}

function isColour(value: unknown): boolean {
  if (isBinding(value)) return true
  return isRecord(value) && typeof value.attribute === 'string' && ATTRIBUTES.includes(value.attribute as Attribute)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isLittoralArray(value: unknown): value is Littoral[] {
  return Array.isArray(value) && value.every((entry) => entry === 'C' || entry === 'NC')
}

function isFigureSpec(value: unknown): value is FigureSpec {
  if (!isRecord(value)) return false
  if (typeof value.type !== 'string' || !FIGURE_TYPES.includes(value.type as FigureType)) return false
  if (typeof value.level !== 'string' || !LEVELS.includes(value.level as AtelierLevel)) return false
  const population = value.population
  if (!isRecord(population) || (population.excluded !== 'hide' && population.excluded !== 'grey')) return false
  if (population.departement !== undefined && !isStringArray(population.departement)) return false
  if (population.epci !== undefined && !isStringArray(population.epci)) return false
  if (population.densite !== undefined && !isStringArray(population.densite)) return false
  if (population.littoral !== undefined && !isLittoralArray(population.littoral)) return false
  if (population.values !== undefined) {
    if (!Array.isArray(population.values) || !population.values.every((threshold) => {
      if (!isRecord(threshold) || !isBinding(threshold.variable)) return false
      if (threshold.min !== undefined && typeof threshold.min !== 'number') return false
      if (threshold.max !== undefined && typeof threshold.max !== 'number') return false
      return true
    })) return false
  }
  const variables = value.variables
  if (!isRecord(variables)) return false
  if (variables.x !== undefined && !isBinding(variables.x)) return false
  if (variables.y !== undefined && !isBinding(variables.y)) return false
  if (variables.taille !== undefined && !isBinding(variables.taille)) return false
  if (variables.couleur !== undefined && !isColour(variables.couleur)) return false
  if (value.title !== undefined && typeof value.title !== 'string') return false
  if (value.axisTitles !== undefined) {
    if (!isRecord(value.axisTitles)) return false
    if (value.axisTitles.x !== undefined && typeof value.axisTitles.x !== 'string') return false
    if (value.axisTitles.y !== undefined && typeof value.axisTitles.y !== 'string') return false
  }
  if (value.overlays !== undefined) {
    if (!Array.isArray(value.overlays) || !value.overlays.every((overlay) =>
      isRecord(overlay) && typeof overlay.type === 'string' && OVERLAY_LEVELS.includes(overlay.type as OverlayLevel) &&
      typeof overlay.id === 'string')) return false
  }
  if (value.diagonal !== undefined && typeof value.diagonal !== 'boolean') return false
  return true
}

function isBlock(value: unknown): value is AtelierBlock {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return false
  if (value.kind === 'prose') return typeof value.markdown === 'string'
  if (value.kind === 'figure') return isFigureSpec(value.figure)
  return false
}

/** Structural gate for a restored link. Never throws; rejects anything not a v1 page. */
export function isValidAtelierState(value: unknown): value is AtelierState {
  return isRecord(value) &&
    value.v === STATE_VERSION &&
    typeof value.title === 'string' &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isBlock)
}
