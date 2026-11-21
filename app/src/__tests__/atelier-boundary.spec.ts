import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { joinFigures } from '@/atelier/join'
import { cellKey } from '@/atelier/state'
import type { AdmittedCohort, CohortSource } from '@/atelier/types'
import { atelierDiscoveryFixture, atelierReferenceFixture, densiteCell } from './helpers/atelierFixtures'

// Vitest's root is app/; fall back for a runner invoked from the repo root.
const srcRoot = existsSync(resolve(process.cwd(), 'src/atelier'))
  ? resolve(process.cwd(), 'src')
  : resolve(process.cwd(), 'app/src')

function tsFiles(directory: string): string[] {
  let entries: import('node:fs').Dirent[]
  try { entries = readdirSync(directory, { withFileTypes: true }) }
  catch { return [] }
  return entries.flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return tsFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Every number in the output with its path — a derived value would show up here. */
function numericPaths(value: unknown, path = ''): Array<[string, number]> {
  if (typeof value === 'number') return [[path || '$', value]]
  if (Array.isArray(value)) return value.flatMap((child, index) => numericPaths(child, `${path}[${index}]`))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => numericPaths(child, path ? `${path}.${key}` : key))
}

function figureState(x: { cell: typeof densiteCell } | { formula: { expression: string; operands: Record<string, typeof densiteCell> } }) {
  return {
    v: 1 as const, title: 'Atelier', blocks: [{
      kind: 'figure' as const, id: 'f', figure: {
        type: 'nuage' as const, level: 'commune' as const, population: { excluded: 'hide' as const },
        variables: { x, y: { cell: densiteCell } },
      },
    }],
  }
}

const source: CohortSource = { sourceId: 'insee-rp', name: 'INSEE — Recensement', vintageId: '2023' }

function cohortAvecValeur(value: number): AdmittedCohort {
  const territory = atelierReferenceFixture[0]!
  return {
    key: `${cellKey(densiteCell)}|commune`, cell: densiteCell, level: 'commune',
    availability: { status: 'available' },
    values: [{ territory: territory.territoire, type: territory.type, nom: territory.nom, value, sources: [source] }],
  }
}

describe('atelier — confinement de la valeur dérivée (ADR-0046)', () => {
  it('les surfaces non-Atelier ne peuvent pas importer le modèle Atelier', () => {
    const surfaces = ['fiche', 'indicateurs', 'carte', 'components']
    const contrevenants = surfaces.flatMap((surface) =>
      tsFiles(resolve(srcRoot, surface)).filter((fichier) => /from\s+['"][^'"]*atelier/.test(readFileSync(fichier, 'utf8'))))
    expect(contrevenants).toEqual([])
  })

  it('le modèle Atelier n’importe aucune surface qui publie des faits dérivés', () => {
    const contrevenants = tsFiles(resolve(srcRoot, 'atelier')).filter((fichier) =>
      /from\s+['"]@\/(fiche|indicateurs|carte)\b/.test(readFileSync(fichier, 'utf8')))
    expect(contrevenants).toEqual([])
  })

  it('épingle exactement la forme de sortie d’une figure', () => {
    const rendue = joinFigures({
      state: figureState({ cell: densiteCell }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [cohortAvecValeur(0.30000000000000004)],
    })[0]!
    expect(Object.keys(rendue).sort()).toEqual([
      'axisTitles', 'excluded', 'id', 'level', 'nonTracees', 'points', 'sources', 'title', 'titleGenerated', 'type',
    ])
    expect(Object.keys(rendue.points[0]!).sort()).toEqual(['territory', 'values'])
    expect(Object.keys(rendue.points[0]!.territory).sort()).toEqual(['id', 'nom', 'type'])
    expect(Object.keys(rendue.nonTracees).sort()).toEqual(['count', 'territories'])
    expect(Object.keys(rendue.nonTracees.territories[0]!).sort()).toEqual(['reasons', 'territory'])
  })

  it('une valeur publiée traverse la jointure sans être recalculée', () => {
    const published = 0.30000000000000004
    const cohort = cohortAvecValeur(published)
    const rendue = joinFigures({
      state: figureState({ cell: densiteCell }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [cohort],
    })[0]!
    const territory = atelierReferenceFixture[0]!
    expect(rendue.points[0]!.values.x).toBe(published)
    expect(rendue.points[0]!.territory).toEqual({ id: territory.territoire, type: territory.type, nom: territory.nom })
    expect(rendue.sources[0]).toBe(cohort.values[0]!.sources[0]) // même objet, pas une copie recalculée
  })

  it('une variable de Formule rend ses territoires non tracés sans produire de nombre calculé', () => {
    const rendue = joinFigures({
      state: figureState({ formula: { expression: 'B - A', operands: { A: densiteCell, B: densiteCell } } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [cohortAvecValeur(42)],
    })[0]!
    expect(rendue.points).toEqual([])
    expect(rendue.nonTracees.count).toBe(atelierReferenceFixture.filter((t) => t.type === 'commune').length)
    expect(rendue.nonTracees.territories.every((t) => t.reasons.some((reason) => /Formule/.test(reason)))).toBe(true)
    // Le seul nombre de la figure est le compte des non tracées : aucune valeur calculée.
    expect(numericPaths(rendue)).toEqual([['nonTracees.count', rendue.nonTracees.count]])
  })
})
