/** PROTOTYPE — throwaway. Figure d'atelier state, Formule reading, spec shape, generated titles. */
import {
  cellShortLabel,
  cellUnit,
  type Coordinates,
  type Level,
  type ResourceDef,
} from './prototypeCellules'

export const CHANNELS = [
  { id: 'x', label: 'x', note: 'abscisse', required: true },
  { id: 'y', label: 'y', note: 'ordonnée', required: true },
  { id: 'taille', label: 'taille', note: 'surface du point', required: false },
  { id: 'couleur', label: 'couleur', note: 'teinte du point', required: false },
] as const
export type ChannelId = (typeof CHANNELS)[number]['id']

export const POPULATION_KEYS = ['departement', 'epci', 'classe_densite', 'littoral'] as const
export type PopulationKey = (typeof POPULATION_KEYS)[number]

export const CATEGORIES = [
  { id: 'classe_densite', label: 'Classe de densité' },
  { id: 'littoral', label: 'Littoral (C / NC)' },
] as const
export const APPARTENANCES = [
  { id: 'departement', label: 'Département' },
  { id: 'epci', label: 'EPCI' },
] as const

export interface CellRef {
  resourceId: string
  coordinates: Coordinates
}

export type ChannelMode = 'aucune' | 'cellule' | 'formule' | 'categorie' | 'appartenance'

/** Every sub-state is kept so switching mode never loses what was typed. */
export interface ChannelState {
  mode: ChannelMode
  cell: CellRef | null
  expression: string
  /** Operands of the Formule, lettered A, B, C… within this formula only. */
  operands: (CellRef | null)[]
  categorie: string
  appartenance: string
}

export interface FigureState {
  level: Level
  population: Record<PopulationKey, string[]>
  channels: Record<ChannelId, ChannelState>
}

export const letterOf = (index: number) => String.fromCharCode(65 + index)

export function newChannel(id: ChannelId): ChannelState {
  return {
    mode: id === 'x' || id === 'y' ? 'cellule' : 'aucune',
    cell: null,
    expression: '',
    operands: [],
    categorie: CATEGORIES[0].id,
    appartenance: APPARTENANCES[0].id,
  }
}

export function newFigureState(): FigureState {
  return {
    level: 'commune',
    population: { departement: [], epci: [], classe_densite: [], littoral: [] },
    channels: { x: newChannel('x'), y: newChannel('y'), taille: newChannel('taille'), couleur: newChannel('couleur') },
  }
}

export const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/* ------------------------------------------------------------------- formula */

const FUNCTIONS = ['log10', 'log', 'sqrt', 'abs', 'min', 'max'] as const

export interface FormulaReading {
  empty: boolean
  letters: string[]
  unknownLetters: string[]
  unknownTokens: string[]
  functions: string[]
  balanced: boolean
}

/** Prototype: only finds which letters are referenced and what does not belong. No evaluation. */
export function readFormula(expression: string, knownLetters: readonly string[]): FormulaReading {
  const letters = new Set<string>()
  const unknownLetters = new Set<string>()
  const unknownTokens = new Set<string>()
  const functions = new Set<string>()
  const trimmed = expression.trim()
  for (const match of trimmed.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const token = match[0]
    const lower = token.toLowerCase()
    if ((FUNCTIONS as readonly string[]).includes(lower)) functions.add(lower)
    else if (/^[A-Z]$/.test(token)) {
      letters.add(token)
      if (!knownLetters.includes(token)) unknownLetters.add(token)
    } else unknownTokens.add(token)
  }
  let depth = 0
  let balanced = true
  for (const char of trimmed) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth < 0) balanced = false
  }
  if (depth !== 0) balanced = false
  return { empty: trimmed === '', letters: [...letters].sort(), unknownLetters: [...unknownLetters].sort(), unknownTokens: [...unknownTokens], functions: [...functions], balanced }
}

export const prettyExpression = (expression: string) =>
  expression.trim().replace(/\*/g, '×').replace(/(?<![eE])-/g, '−').replace(/\s+/g, ' ')

export const formulaIsValid = (reading: FormulaReading) =>
  !reading.empty && reading.letters.length > 0 && !reading.unknownLetters.length && !reading.unknownTokens.length && reading.balanced

export function formulaReadingOf(channel: ChannelState) {
  return readFormula(channel.expression, channel.operands.map((_, i) => letterOf(i)))
}

/* --------------------------------------------------------------------- reading */

type Lookup = (resourceId: string) => ResourceDef | undefined

export function describe(cell: CellRef | null, lookup: Lookup) {
  const resource = cell ? lookup(cell.resourceId) : undefined
  if (!cell || !resource) return null
  return { resource, cell, lecture: cellShortLabel(resource, cell.coordinates), unite: cellUnit(resource, cell.coordinates) }
}

export function operandUnits(channel: ChannelState, reading: FormulaReading, lookup: Lookup): string[] {
  const units = new Set<string>()
  for (const letter of reading.letters) {
    const info = describe(channel.operands[letter.charCodeAt(0) - 65] ?? null, lookup)
    if (info) units.add(info.unite || '—')
  }
  return [...units]
}

export function channelIssues(state: FigureState, lookup: Lookup): string[] {
  const issues: string[] = []
  for (const { id, required } of CHANNELS) {
    const channel = state.channels[id]
    if (channel.mode === 'aucune') {
      if (required) issues.push(`${id} : à lier`)
    } else if (channel.mode === 'cellule') {
      if (!describe(channel.cell, lookup)) issues.push(`${id} : cellule à choisir`)
    } else if (channel.mode === 'formule') {
      const reading = formulaReadingOf(channel)
      if (reading.empty) issues.push(`${id} : formule vide`)
      else if (!formulaIsValid(reading)) issues.push(`${id} : formule invalide`)
      else if (reading.letters.some((l) => !describe(channel.operands[l.charCodeAt(0) - 65] ?? null, lookup))) issues.push(`${id} : opérande à choisir`)
    }
  }
  return issues
}

export function channelLabel(channel: ChannelState, lookup: Lookup): string {
  if (channel.mode === 'cellule') return describe(channel.cell, lookup)?.lecture ?? ''
  if (channel.mode === 'formule') return prettyExpression(channel.expression)
  if (channel.mode === 'categorie') return CATEGORIES.find((c) => c.id === channel.categorie)?.label ?? ''
  if (channel.mode === 'appartenance') return APPARTENANCES.find((a) => a.id === channel.appartenance)?.label ?? ''
  return ''
}

/** « y : log(B − A) / C · x : Densité de population » — the reader may overwrite it. */
export function generatedTitle(state: FigureState, lookup: Lookup): string {
  const part = (id: ChannelId) => channelLabel(state.channels[id], lookup) || '…'
  return `y : ${part('y')} · x : ${part('x')}`
}

export function buildSpec(state: FigureState, lookup: Lookup) {
  const variables: Record<string, unknown> = {}
  for (const { id } of CHANNELS) {
    const channel = state.channels[id]
    if (channel.mode === 'aucune') {
      variables[id] = null
    } else if (channel.mode === 'cellule') {
      const info = describe(channel.cell, lookup)
      variables[id] = info ? { liaison: 'cellule', resource_id: info.resource.id, coordonnees: info.cell.coordinates, unite: info.unite, lecture: info.lecture } : { liaison: 'cellule', cellule: null }
    } else if (channel.mode === 'formule') {
      const reading = formulaReadingOf(channel)
      const units = operandUnits(channel, reading, lookup)
      variables[id] = {
        liaison: 'formule',
        formule: channel.expression.trim(),
        libelle: prettyExpression(channel.expression),
        fonctions: reading.functions,
        operandes: channel.operands.map((operand, index) => {
          const info = describe(operand, lookup)
          return info
            ? { id: letterOf(index), resource_id: info.resource.id, coordonnees: info.cell.coordinates, unite: info.unite, lecture: info.lecture }
            : { id: letterOf(index), resource_id: null }
        }),
        erreurs: [...reading.unknownLetters.map((l) => `lettre inconnue ${l}`), ...reading.unknownTokens.map((t) => `jeton inconnu ${t}`), ...(reading.balanced ? [] : ['parenthèses'])],
        avertissements: units.length > 1 ? [`unités mêlées : ${units.join(' / ')}`] : [],
      }
    } else if (channel.mode === 'categorie') {
      variables[id] = { liaison: 'categorie_territoriale', id: channel.categorie }
    } else {
      variables[id] = { liaison: 'appartenance_territoriale', id: channel.appartenance }
    }
  }
  const population: Record<string, string[]> = {}
  for (const key of POPULATION_KEYS) if (state.population[key].length) population[key] = [...state.population[key]]
  return { type: 'nuage', niveau: state.level, filtre_population: population, variables }
}
export type FigureSpec = ReturnType<typeof buildSpec>
