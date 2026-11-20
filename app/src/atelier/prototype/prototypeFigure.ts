/** PROTOTYPE — throwaway. Figure d'atelier draft state, Formule parsing, spec shape. */
import { computed, reactive, ref } from 'vue'

import {
  cellShortLabel,
  cellUnit,
  defaultCoordinates,
  normaliseCoordinates,
  type Coordinates,
  type Level,
  type ResourceDef,
} from './prototypeCellules'

export const CHANNELS = [
  { id: 'x', label: 'x', note: 'abscisse' },
  { id: 'y', label: 'y', note: 'ordonnée' },
  { id: 'taille', label: 'taille', note: 'surface du point' },
  { id: 'couleur', label: 'couleur', note: 'teinte du point' },
] as const
export type ChannelId = (typeof CHANNELS)[number]['id']

export const POPULATION_STUBS = [
  { id: 'departement', label: 'Département' },
  { id: 'classe_densite', label: 'Classe de densité' },
  { id: 'littoral', label: 'Littoral (C / NC)' },
] as const

/** Catégorie territoriale (closed classes) and Appartenance territoriale (membership) stubs. */
export const CATEGORIES = [
  { id: 'classe_densite', label: 'Classe de densité' },
  { id: 'littoral', label: 'Littoral (C / NC)' },
] as const
export const APPARTENANCES = [
  { id: 'departement', label: 'Département' },
  { id: 'epci', label: 'EPCI' },
] as const

export type Binding =
  | { kind: 'cellule'; letter: string }
  | { kind: 'formule'; expression: string }
  | { kind: 'categorie'; id: string }
  | { kind: 'appartenance'; id: string }

export interface CelluleDraft {
  letter: string
  resourceId: string | null
  coordinates: Coordinates
}

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
    if ((FUNCTIONS as readonly string[]).includes(lower)) {
      functions.add(lower)
    } else if (/^[A-Z]$/.test(token)) {
      letters.add(token)
      if (!knownLetters.includes(token)) unknownLetters.add(token)
    } else {
      unknownTokens.add(token)
    }
  }
  let depth = 0
  let balanced = true
  for (const char of trimmed) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth < 0) balanced = false
  }
  if (depth !== 0) balanced = false
  return {
    empty: trimmed === '',
    letters: [...letters].sort(),
    unknownLetters: [...unknownLetters].sort(),
    unknownTokens: [...unknownTokens],
    functions: [...functions],
    balanced,
  }
}

export const prettyExpression = (expression: string) => expression.trim().replace(/\*/g, '×').replace(/(?<![eE])-/g, '−').replace(/\s+/g, ' ')

/* -------------------------------------------------------------------- draft */

export function createDraft(catalogueOf: () => ResourceDef[]) {
  const level = ref<Level>('commune')
  const population = reactive<Record<string, boolean>>({ departement: false, classe_densite: false, littoral: false })
  const cells = ref<CelluleDraft[]>([{ letter: 'A', resourceId: null, coordinates: {} }])
  const channels = reactive<Record<ChannelId, Binding | null>>({ x: null, y: null, taille: null, couleur: null })

  const resourceOf = (resourceId: string | null) => catalogueOf().find((r) => r.id === resourceId) ?? null
  const cellByLetter = (letter: string) => cells.value.find((c) => c.letter === letter) ?? null
  const letters = computed(() => cells.value.map((c) => c.letter))

  function addCell(): string {
    const used = new Set(letters.value)
    const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !used.has(l))!
    cells.value = [...cells.value, { letter, resourceId: null, coordinates: {} }].sort((a, b) => a.letter.localeCompare(b.letter))
    return letter
  }

  function removeCell(letter: string) {
    cells.value = cells.value.filter((c) => c.letter !== letter)
    for (const id of Object.keys(channels) as ChannelId[]) {
      const binding = channels[id]
      if (binding?.kind === 'cellule' && binding.letter === letter) channels[id] = null
    }
  }

  function setResource(letter: string, resourceId: string | null) {
    const cell = cellByLetter(letter)
    if (!cell) return
    const resource = resourceOf(resourceId)
    cell.resourceId = resource?.id ?? null
    cell.coordinates = resource ? defaultCoordinates(resource) : {}
  }

  function setCoordinate(letter: string, axisKey: string, value: string) {
    const cell = cellByLetter(letter)
    const resource = resourceOf(cell?.resourceId ?? null)
    if (!cell || !resource) return
    cell.coordinates = normaliseCoordinates(resource, { ...cell.coordinates, [axisKey]: value }, axisKey)
  }

  function address(letter: string, resourceId: string, coordinates: Coordinates) {
    const cell = cellByLetter(letter)
    if (!cell) return
    cell.resourceId = resourceId
    cell.coordinates = { ...coordinates }
  }

  const completeCells = computed(() => cells.value.filter((c) => c.resourceId && resourceOf(c.resourceId)))

  function unitsOf(expressionLetters: readonly string[]): string[] {
    const units = new Set<string>()
    for (const l of expressionLetters) {
      const cell = cellByLetter(l)
      const resource = resourceOf(cell?.resourceId ?? null)
      if (cell && resource) units.add(cellUnit(resource, cell.coordinates) || '—')
    }
    return [...units]
  }

  function bindingTitle(binding: Binding | null): string {
    if (!binding) return ''
    if (binding.kind === 'cellule') return binding.letter
    if (binding.kind === 'formule') return prettyExpression(binding.expression)
    const list = binding.kind === 'categorie' ? CATEGORIES : APPARTENANCES
    return list.find((e) => e.id === binding.id)?.label ?? binding.id
  }

  function formulaProblems(binding: Binding | null): { reading: FormulaReading; units: string[] } | null {
    if (binding?.kind !== 'formule') return null
    const reading = readFormula(binding.expression, letters.value)
    return { reading, units: unitsOf(reading.letters) }
  }

  const channelIssues = computed(() => {
    const issues: string[] = []
    for (const { id } of CHANNELS) {
      const binding = channels[id]
      if (binding?.kind === 'cellule' && !cellByLetter(binding.letter)) issues.push(`${id} : cellule ${binding.letter} absente`)
      if (binding?.kind === 'cellule' && !cellByLetter(binding.letter)?.resourceId) issues.push(`${id} : cellule ${binding.letter} non adressée`)
      if (binding?.kind === 'formule') {
        const reading = readFormula(binding.expression, letters.value)
        if (reading.empty) issues.push(`${id} : formule vide`)
        else if (reading.unknownLetters.length || reading.unknownTokens.length || !reading.balanced || !reading.letters.length) issues.push(`${id} : formule invalide`)
        for (const l of reading.letters) if (cellByLetter(l) && !cellByLetter(l)!.resourceId) issues.push(`${id} : cellule ${l} non adressée`)
      }
    }
    if (!channels.x) issues.push('x : à lier')
    if (!channels.y) issues.push('y : à lier')
    return issues
  })

  const spec = computed(() => {
    const warnings: string[] = []
    const canaux: Record<string, unknown> = {}
    for (const { id } of CHANNELS) {
      const binding = channels[id]
      if (!binding) {
        canaux[id] = null
      } else if (binding.kind === 'cellule') {
        canaux[id] = { cellule: binding.letter }
      } else if (binding.kind === 'formule') {
        const reading = readFormula(binding.expression, letters.value)
        const units = unitsOf(reading.letters)
        if (units.length > 1) warnings.push(`${id} : unités mêlées (${units.join(' / ')})`)
        canaux[id] = { formule: binding.expression.trim(), libelle: prettyExpression(binding.expression), cellules: reading.letters, fonctions: reading.functions, inconnues: [...reading.unknownLetters, ...reading.unknownTokens] }
      } else if (binding.kind === 'categorie') {
        canaux[id] = { categorie_territoriale: binding.id }
      } else {
        canaux[id] = { appartenance_territoriale: binding.id }
      }
    }
    return {
      type: 'nuage',
      niveau: level.value,
      filtre_population: POPULATION_STUBS.filter((p) => population[p.id]).map((p) => ({ id: p.id, valeurs: 'stub' })),
      cellules: completeCells.value.map((c) => {
        const resource = resourceOf(c.resourceId)!
        return {
          id: c.letter,
          resource_id: resource.id,
          theme_id: resource.themeId,
          label: resource.label,
          unite: cellUnit(resource, c.coordinates),
          coordonnees: c.coordinates,
          lecture: cellShortLabel(resource, c.coordinates),
        }
      }),
      canaux,
      avertissements: warnings,
    }
  })

  const canCreate = computed(() => channelIssues.value.length === 0 && completeCells.value.length > 0)

  return {
    level,
    population,
    cells,
    channels,
    letters,
    resourceOf,
    cellByLetter,
    addCell,
    removeCell,
    setResource,
    setCoordinate,
    address,
    completeCells,
    unitsOf,
    bindingTitle,
    formulaProblems,
    channelIssues,
    spec,
    canCreate,
  }
}

export type Draft = ReturnType<typeof createDraft>
