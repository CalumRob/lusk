import { describe, expect, it } from 'vitest'

import { joinFigures } from '@/atelier/join'
import { cellKey, type AtelierLevel, type AtelierState, type CellRef, type FigureSpec } from '@/atelier/state'
import type { AdmittedCohort, CohortSource, CohortValue, DiscoveryResource } from '@/atelier/types'
import { atelierDiscoveryFixture, atelierReferenceFixture, aedarCell, densiteCell } from './helpers/atelierFixtures'

const sourceA: CohortSource = { sourceId: 'insee-rp', name: 'INSEE — Recensement', vintageId: '2023' }
const sourceB: CohortSource = { sourceId: 'bpe', name: 'BPE — INSEE', vintageId: '2021' }

function valeur(territory: string, value: number | null, sources: CohortSource[] = [sourceA]): CohortValue {
  const territoryRow = atelierReferenceFixture.find((row) => row.territoire === territory)!
  return { territory, type: territoryRow.type, nom: territoryRow.nom, value, sources }
}

function cohorte(cell: CellRef, level: AtelierLevel, valeurs: CohortValue[]): AdmittedCohort {
  return { key: `${cellKey(cell)}|${level}`, cell, level, availability: { status: 'available' }, values: valeurs }
}

function figure(variables: FigureSpec['variables'], extra: Partial<FigureSpec> = {}): AtelierState {
  return {
    v: 1, title: 'Atelier',
    blocks: [{ kind: 'figure', id: 'f1', figure: { type: 'nuage', level: 'commune', population: { excluded: 'hide' }, variables, ...extra } }],
  }
}

const densite = () => cohorte(densiteCell, 'commune', [
  valeur('22001', 200), valeur('22002', 50), valeur('29001', 150), valeur('29002', null),
])

describe('atelier — jointure des Cellules en figures tracées', () => {
  it('trace un point par territoire ayant toutes ses entrées, sans jamais mettre zéro', () => {
    const aedar = cohorte(aedarCell, 'commune', [valeur('22001', 61, [sourceB]), valeur('29001', 42, [sourceB])])
    const sortie = joinFigures({
      state: figure({ x: { cell: densiteCell }, y: { cell: aedarCell } }),
      discovery: atelierDiscoveryFixture,
      reference: atelierReferenceFixture,
      cohorts: [densite(), aedar],
    })
    expect(sortie).toHaveLength(1)
    const rendue = sortie[0]!
    expect(rendue.points.map((point) => [point.territory.id, point.values.x, point.values.y])).toEqual([
      ['22001', 200, 61],
      ['29001', 150, 42],
    ])
    expect(rendue.nonTracees.count).toBe(2)
    expect(rendue.nonTracees.territories.map((t) => t.territory.id).sort()).toEqual(['22002', '29002'])
    const sansAedar = rendue.nonTracees.territories.find((t) => t.territory.id === '22002')!
    expect(sansAedar.reasons.join(' ')).toMatch(/y/)
    const sansValeur = rendue.nonTracees.territories.find((t) => t.territory.id === '29002')!
    expect(sansValeur.reasons.join(' ')).toMatch(/absente|manquante/i)
    expect(rendue.points.some((point) => point.values.x === 0)).toBe(false)
  })

  it('ne trace aucun point et n’invente rien quand la publication est retirée', () => {
    const retiree: AdmittedCohort = {
      ...cohorte(densiteCell, 'commune', []),
      availability: { status: 'publication_unavailable', reason: 'publication_absent', family: 'scalar' },
    }
    const rendue = joinFigures({
      state: figure({ x: { cell: densiteCell } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [retiree],
    })[0]!
    expect(rendue.points).toEqual([])
    expect(rendue.nonTracees.count).toBe(4)
    expect(rendue.nonTracees.territories.every((t) => t.reasons.some((r) => /indisponible/i.test(r)))).toBe(true)
    expect(rendue.sources).toEqual([])
  })

  it('ne trace pas une Cellule de Formule : son évaluation appartient à #1085', () => {
    const rendue = joinFigures({
      state: figure({ x: { formula: { expression: 'B - A', operands: { A: densiteCell, B: densiteCell } } }, y: { cell: densiteCell } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite()],
    })[0]!
    expect(rendue.points).toEqual([])
    expect(rendue.nonTracees.count).toBe(4)
    expect(rendue.nonTracees.territories[0]!.reasons.join(' ')).toMatch(/formule/i)
  })

  it('les titres d’axe par défaut suivent les variables et portent leur unité', () => {
    const rendue = joinFigures({
      state: figure({ x: { cell: densiteCell }, y: { cell: densiteCell } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite()],
    })[0]!
    expect(rendue.axisTitles.x).toContain('Densité de population')
    expect(rendue.axisTitles.x).toContain('hab/km²')
    expect(rendue.axisTitles.y).toContain('hab/km²')
  })

  it('un titre d’axe de profil prend l’unité de la coordonnée déclarée, pas celle du scalaire', () => {
    const profil: CellRef = { resource: 'structure_age', coordinates: { detail: '65-79', sex: 'F' } }
    const rendue = joinFigures({
      state: figure({ x: { cell: profil } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [],
    })[0]!
    expect(rendue.axisTitles.x).toContain('personnes')
    expect(rendue.axisTitles.x).toContain('65–79 ans')
  })

  it('utilise le titre généré jusqu’à ce que le lecteur le modifie, axe et titre compris', () => {
    const sansTitres = joinFigures({
      state: figure({ x: { cell: densiteCell }, y: { cell: aedarCell } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite()],
    })[0]!
    expect(sansTitres.titleGenerated).toBe(true)
    expect(sansTitres.title).toMatch(/^y : .* · x : /)
    expect(sansTitres.title.indexOf('Accès aux équipements')).toBeLessThan(sansTitres.title.indexOf('Densité de population'))

    const avecTitres = joinFigures({
      state: figure({ x: { cell: densiteCell } }, { title: 'Mon titre', axisTitles: { x: 'Ma densité' } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite()],
    })[0]!
    expect(avecTitres.title).toBe('Mon titre')
    expect(avecTitres.titleGenerated).toBe(false)
    expect(avecTitres.axisTitles.x).toBe('Ma densité')
  })

  it('ne liste que les jeux de données réellement utilisés par les Cellules liées, dédupliqués', () => {
    const aedar = cohorte(aedarCell, 'commune', [valeur('22001', 61, [sourceB]), valeur('29001', 42, [sourceB])])
    const rendue = joinFigures({
      state: figure({ x: { cell: densiteCell }, y: { cell: aedarCell } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite(), aedar],
    })[0]!
    expect(rendue.sources).toEqual([sourceA, sourceB])
    // Les `sources` déclarées par la découverte ne sont pas recopiées telles quelles.
    expect(rendue.sources.some((source) => source.name.includes('Réseau'))).toBe(false)
  })

  it('une couleur par Appartenance vient de la référence, jamais d’une valeur fabriquée', () => {
    const rendue = joinFigures({
      state: figure({ x: { cell: densiteCell }, couleur: { attribute: 'littoral' } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite()],
    })[0]!
    const point = rendue.points.find((p) => p.territory.id === '22001')!
    expect(point.values.couleur).toBe('C')
    expect(rendue.nonTracees.territories.map((t) => t.territory.id)).toContain('29002') // littoral null
  })

  it('ne renvoie ni direction, ni rang, ni aucune valeur dérivée', () => {
    const rendue = joinFigures({
      state: figure({ x: { cell: densiteCell }, y: { cell: densiteCell } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite()],
    })[0]!
    expect(JSON.stringify(rendue)).not.toMatch(/direction|rang|rank|score|derived/i)
  })

  it('laisse la place aux points exclus (Filtre de population, #1089)', () => {
    const rendue = joinFigures({
      state: figure({ x: { cell: densiteCell } }),
      discovery: atelierDiscoveryFixture, reference: atelierReferenceFixture, cohorts: [densite()],
    })[0]!
    expect(rendue.excluded).toEqual([])
  })
})

// Keep the discovery type imported for the contract: a future rename must fail the build.
const _contract: readonly DiscoveryResource[] = atelierDiscoveryFixture
void _contract
