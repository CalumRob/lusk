import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The former Mobilité snapshot figure (#142) read the precomputed density
 * signature and the peers' snapshot values. Slice 3 of #1048 retires both the
 * fields and the figure: the component is removed and no consumer may
 * reintroduce a distribution branch for a story the app no longer reads. This
 * guard replaces the component's mounting tests with the contract that retires it.
 */

const src = (relative: string) => resolve(process.cwd(), 'src', relative)
const lire = (relative: string) => readFileSync(src(relative), 'utf8')
const fichiers = (directory: string) => readdirSync(src(directory))
const RETIRES = [
  'GraphiqueDistributionMobilite',
  'DistributionMobilite',
  'PointNuageMobilite',
  'nuageMobilite',
  'histoireMobilitePourTerritoire',
]

describe('figure de distribution Mobilité — retirée avec son snapshot (#1048)', () => {
  it('le composant n’existe plus dans les composants de fiche', () => {
    expect(fichiers('components/fiche')).not.toContain('GraphiqueDistributionMobilite.vue')
  })

  it('aucun fichier source ne réintroduit la figure ni ses champs retirés', () => {
    const coupables: string[] = []
    const parcourir = (directory: string): void => {
      for (const entree of fichiers(directory)) {
        const chemin = `${directory}/${entree}`
        if (entree.endsWith('.ts') || entree.endsWith('.vue')) {
          const contenu = lire(chemin)
          if (RETIRES.some((jeton) => contenu.includes(jeton))) coupables.push(chemin)
        }
      }
    }
    parcourir('components/fiche')
    parcourir('fiche')
    parcourir('fiche/content')
    parcourir('payload')
    expect(coupables).toEqual([])
  })

  it('la fiche et le prototype ne branchent plus sur une figure distribution', () => {
    expect(lire('components/fiche/OngletTheme.vue')).not.toContain("genre === 'distribution'")
    expect(lire('fiche/prototype/LectureFigureProto.vue')).not.toContain("genre === 'distribution'")
  })
})
