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
 * Prochain identifiant de bloc, inédit dans l'état fourni. Un lien restauré
 * peut porter des ids troués (`b2`, `b3` après suppression de `b1`) : le
 * nombre de blocs ne suffit pas, on part du plus grand suffixe `b<n>` présent.
 * `b<max+1>` est absent de `blocks` par définition de max pour tout état
 * ordinaire : pas de boucle de vérification nécessaire, et deux ajouts
 * successifs sont sûrs parce que l'appelant écrit l'état de façon synchrone
 * avant le nouvel appel. Les ids qui ne suivent pas `b<n>` sont ignorés ; ils
 * ne peuvent pas entrer en collision avec ce préfixe.
 *
 * Un lien hostile peut en revanche porter un suffixe à la limite de 2^53 :
 * là, `suffixe + 1 === suffixe` en virgule flottante et le chemin compact
 * renverrait un id déjà présent. Ce garde-fou — contrairement à une boucle
 * sur le max — est donc atteignable : on bascule sur `b-<uuid>` dès que le
 * successeur n'est pas un entier sûr ou qu'il figure déjà dans `blocks`.
 */
export function nextBlockId(blocks: readonly AtelierBlock[]): string {
  let suffixe = 0
  for (const bloc of blocks) {
    const numerique = /^b(\d+)$/.exec(bloc.id)
    if (numerique) suffixe = Math.max(suffixe, Number(numerique[1]))
  }
  const suivant = suffixe + 1
  if (Number.isSafeInteger(suivant)) {
    const candidat = `b${suivant}`
    if (!blocks.some((bloc) => bloc.id === candidat)) return candidat
  }
  return `b-${crypto.randomUUID()}`
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

/**
 * A restored link is a closed contract: any unknown key — at the state, block,
 * figure or any nested level — is a different (or hostile) page and empties it.
 * Map-shaped coordinates and Formule operands are checked separately: their
 * keys are producer-declared axes and reader-chosen letters, not fixed fields.
 */
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const permitted = new Set(allowed)
  return Object.keys(value).every((key) => permitted.has(key))
}

const FIGURE_TYPES: readonly FigureType[] = ['nuage', 'distribution', 'table', 'classement']
const LEVELS: readonly AtelierLevel[] = ['commune', 'epci', 'departement']
const OVERLAY_LEVELS: readonly OverlayLevel[] = ['epci', 'departement', 'region']
const ATTRIBUTES: readonly Attribute[] = ['densite', 'littoral', 'departement', 'epci']

function isCellRef(value: unknown): value is CellRef {
  if (!isRecord(value) || !hasOnlyKeys(value, ['resource', 'coordinates'])) return false
  if (typeof value.resource !== 'string' || !value.resource) return false
  if (!isRecord(value.coordinates)) return false
  // Coordinate names are producer-declared: arbitrary keys, string values only.
  return Object.values(value.coordinates).every((entry) => typeof entry === 'string')
}

function isBinding(value: unknown): value is Binding {
  if (!isRecord(value)) return false
  const hasCell = 'cell' in value
  const hasFormula = 'formula' in value
  if (hasCell === hasFormula) return false // exactly one variant
  if (hasCell) return hasOnlyKeys(value, ['cell']) && isCellRef(value.cell)
  if (!hasOnlyKeys(value, ['formula']) || !isRecord(value.formula)) return false
  if (!hasOnlyKeys(value.formula, ['expression', 'operands'])) return false
  if (typeof value.formula.expression !== 'string' || !isRecord(value.formula.operands)) return false
  // Operand letters are local to the Formule: arbitrary keys, CellRef values only.
  return Object.values(value.formula.operands).every(isCellRef)
}

function isColour(value: unknown): boolean {
  if (isBinding(value)) return true
  return isRecord(value) && hasOnlyKeys(value, ['attribute']) &&
    typeof value.attribute === 'string' && ATTRIBUTES.includes(value.attribute as Attribute)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isLittoralArray(value: unknown): value is Littoral[] {
  return Array.isArray(value) && value.every((entry) => entry === 'C' || entry === 'NC')
}

function isFigureSpec(value: unknown): value is FigureSpec {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'type', 'level', 'population', 'variables', 'title', 'axisTitles', 'overlays', 'diagonal',
  ])) return false
  if (typeof value.type !== 'string' || !FIGURE_TYPES.includes(value.type as FigureType)) return false
  if (typeof value.level !== 'string' || !LEVELS.includes(value.level as AtelierLevel)) return false
  const population = value.population
  if (!isRecord(population) || !hasOnlyKeys(population, [
    'departement', 'epci', 'densite', 'littoral', 'values', 'excluded',
  ]) || (population.excluded !== 'hide' && population.excluded !== 'grey')) return false
  if (population.departement !== undefined && !isStringArray(population.departement)) return false
  if (population.epci !== undefined && !isStringArray(population.epci)) return false
  if (population.densite !== undefined && !isStringArray(population.densite)) return false
  if (population.littoral !== undefined && !isLittoralArray(population.littoral)) return false
  if (population.values !== undefined) {
    if (!Array.isArray(population.values) || !population.values.every((threshold) => {
      if (!isRecord(threshold) || !hasOnlyKeys(threshold, ['variable', 'min', 'max'])) return false
      if (!isBinding(threshold.variable)) return false
      if (threshold.min !== undefined && typeof threshold.min !== 'number') return false
      if (threshold.max !== undefined && typeof threshold.max !== 'number') return false
      return true
    })) return false
  }
  const variables = value.variables
  if (!isRecord(variables) || !hasOnlyKeys(variables, ['x', 'y', 'taille', 'couleur'])) return false
  if (variables.x !== undefined && !isBinding(variables.x)) return false
  if (variables.y !== undefined && !isBinding(variables.y)) return false
  if (variables.taille !== undefined && !isBinding(variables.taille)) return false
  if (variables.couleur !== undefined && !isColour(variables.couleur)) return false
  if (value.title !== undefined && typeof value.title !== 'string') return false
  if (value.axisTitles !== undefined) {
    if (!isRecord(value.axisTitles) || !hasOnlyKeys(value.axisTitles, ['x', 'y'])) return false
    if (value.axisTitles.x !== undefined && typeof value.axisTitles.x !== 'string') return false
    if (value.axisTitles.y !== undefined && typeof value.axisTitles.y !== 'string') return false
  }
  if (value.overlays !== undefined) {
    if (!Array.isArray(value.overlays) || !value.overlays.every((overlay) =>
      isRecord(overlay) && hasOnlyKeys(overlay, ['type', 'id']) &&
      typeof overlay.type === 'string' && OVERLAY_LEVELS.includes(overlay.type as OverlayLevel) &&
      typeof overlay.id === 'string')) return false
  }
  if (value.diagonal !== undefined && typeof value.diagonal !== 'boolean') return false
  return true
}

function isBlock(value: unknown): value is AtelierBlock {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return false
  if (value.kind === 'prose') return hasOnlyKeys(value, ['kind', 'id', 'markdown']) && typeof value.markdown === 'string'
  if (value.kind === 'figure') return hasOnlyKeys(value, ['kind', 'id', 'figure']) && isFigureSpec(value.figure)
  return false
}

/**
 * Les ids forment un espace unique sur toute la page : prose et figures
 * partagent le même identifiant de bloc. Un lien hostile peut transporter
 * deux blocs du même id (ou un texte qui emprunte l'id d'une figure) : sans
 * ce contrôle, éditer ou retirer l'un toucherait l'autre.
 */
function idsUniques(blocks: readonly AtelierBlock[]): boolean {
  const vus = new Set<string>()
  for (const bloc of blocks) {
    if (vus.has(bloc.id)) return false
    vus.add(bloc.id)
  }
  return true
}

/** Strict structural gate for a restored link. Never throws; rejects anything not a v1 page. */
export function isValidAtelierState(value: unknown): value is AtelierState {
  return isRecord(value) && hasOnlyKeys(value, ['v', 'title', 'blocks']) &&
    value.v === STATE_VERSION &&
    typeof value.title === 'string' &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isBlock) &&
    idsUniques(value.blocks as AtelierBlock[])
}
