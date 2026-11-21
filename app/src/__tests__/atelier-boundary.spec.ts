import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import * as atelier from '@/atelier'
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

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)])
}

describe('atelier — confinement de la valeur dérivée (ADR-0046)', () => {
  it('n’expose aucun nom évoquant une direction, un rang ou une valeur calculée', () => {
    const noms = Object.keys(atelier)
    expect(noms.length).toBeGreaterThan(0)
    expect(noms.filter((nom) => /direction|rang|rank|score|derived|derive|zscore|norme/i.test(nom))).toEqual([])
  })

  it('une figure avec Formule ne produit aucune clé de direction, rang ou score', () => {
    const figures = atelier.joinFigures({
      state: {
        v: 1, title: 'Atelier', blocks: [{
          kind: 'figure', id: 'f', figure: {
            type: 'nuage', level: 'commune', population: { excluded: 'hide' },
            variables: {
              x: { formula: { expression: 'B - A', operands: { A: densiteCell, B: densiteCell } } },
              y: { cell: densiteCell },
            },
          },
        }],
      },
      discovery: atelierDiscoveryFixture,
      reference: atelierReferenceFixture,
      cohorts: [],
    })
    const cles = keysDeep(figures)
    expect(cles.length).toBeGreaterThan(0)
    expect(cles.filter((cle) => /^(direction|rang|rank|score|derived|derivee|zscore|norme)$/i.test(cle))).toEqual([])
  })

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
})
