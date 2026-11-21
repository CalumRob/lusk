import { describe, expect, it } from 'vitest'

import { acquireCellules, planCelluleDemand } from '@/atelier/acquisition'
import { cellKey, emptyAtelierState, type AtelierState, type CellRef, type FigureSpec } from '@/atelier/state'
import {
  aedarCohort, aedarCell, atelierDiscoveryFixture, densiteCell, observationCohort, prixCell,
} from './helpers/atelierFixtures'

type BatchBody = { contract: string; items: Array<{ id: string; resource: string; target: Record<string, unknown>; coordinates?: Record<string, string[]> }> }

function fakeFetcher(dataFor: (resource: string, level: string) => Record<string, unknown> | null) {
  const appels: BatchBody[] = []
  const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as BatchBody
    appels.push(body)
    const results = body.items.map((item) => {
      const data = dataFor(item.resource, String(item.target.type))
      if (!data) return { id: item.id, resource: item.resource, status: 'publication_unavailable', reason: 'publication_absent', family: 'scalar' }
      return { id: item.id, resource: item.resource, status: 'available', data }
    })
    return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results }), { status: 200 })
  }
  return { fetcher, appels }
}

const dataFor: (resource: string, level: string) => Record<string, unknown> | null = (resource, level) => {
  const l = level as 'commune' | 'epci'
  if (resource === 'aedar_territorial_aggregate') return aedarCohort(resource, l, [['22001', 61], ['22002', 42]])
  if (resource === 'prix_m2') return null // publication retirée
  return observationCohort(resource, l, [['22001', 200], ['22002', 50], ['29001', 150], ['29002', null]])
}

function figureState(bindings: FigureSpec['variables'], level: 'commune' | 'epci' = 'commune'): AtelierState {
  return {
    v: 1, title: 'Atelier', blocks: [{
      kind: 'figure', id: 'f', figure: {
        type: 'nuage', level, population: { excluded: 'hide' },
        variables: bindings,
      },
    }],
  }
}

describe('atelier — acquisition des Cellules par le client sémantique partagé', () => {
  it('une page vide ne demande aucune lecture', async () => {
    expect(planCelluleDemand(emptyAtelierState())).toEqual([])
    const { fetcher, appels } = fakeFetcher(dataFor)
    expect(await acquireCellules(emptyAtelierState(), { fetcher })).toEqual([])
    expect(appels).toHaveLength(0)
  })

  it('demande une cohorte de niveau entier, sans filtre département/EPCI, coordonnées en tableaux', () => {
    const demande = planCelluleDemand(figureState({ x: { cell: aedarCell } }, 'epci'))
    expect(demande).toHaveLength(1)
    expect(demande[0]!.item).toEqual({
      resource: 'aedar_territorial_aggregate',
      target: { kind: 'territory_cohort', type: 'epci' },
      coordinates: { typequ: ['D265'], horizon: ['15'], mode: ['bike_lts2'], statistic: ['share'] },
      intent: { kind: 'facts' },
    })
    expect(demande[0]!.item.target).not.toHaveProperty('department_id')
    expect(demande[0]!.item.target).not.toHaveProperty('epci_id')
  })

  it('demande chaque Cellule une fois par niveau, y compris les opérandes de Formule et les seuils', () => {
    const page: AtelierState = {
      v: 1, title: 'Atelier', blocks: [
        {
          kind: 'figure', id: 'f1', figure: {
            type: 'nuage', level: 'commune',
            population: { excluded: 'grey', values: [{ variable: { cell: densiteCell }, min: 100 }] },
            variables: {
              x: { cell: densiteCell },
              y: { cell: densiteCell }, // même Cellule, même niveau → une seule demande
              taille: { formula: { expression: 'A / B', operands: { A: densiteCell, B: prixCell } } },
            },
          },
        },
        {
          kind: 'figure', id: 'f2', figure: {
            type: 'nuage', level: 'epci', population: { excluded: 'hide' },
            variables: { x: { cell: densiteCell } }, // même Cellule, autre niveau → autre cohorte
          },
        },
      ],
    }
    const demande = planCelluleDemand(page)
    const cles = demande.map((d) => d.key)
    expect(new Set(cles).size).toBe(cles.length)
    expect(cles).toHaveLength(3)
    expect(cles).toContain(`${cellKey(densiteCell)}|commune`)
    expect(cles).toContain(`${cellKey(prixCell)}|commune`)
    expect(cles).toContain(`${cellKey(densiteCell)}|epci`)
  })

  it('acquiert chaque Cellule une fois et la réutilise entre figures et variables', async () => {
    const page = figureState({ x: { cell: densiteCell }, y: { cell: densiteCell }, taille: { cell: aedarCell } })
    const { fetcher, appels } = fakeFetcher(dataFor)
    const cohorts = await acquireCellules(page, { fetcher, discovery: atelierDiscoveryFixture })
    expect(appels).toHaveLength(1)
    expect(appels[0]!.items).toHaveLength(2) // densite + aedar, une seule fois chacune
    expect(cohorts).toHaveLength(2)
    expect(cohorts.find((c) => c.cell.resource === 'densite')!.values).toEqual([
      expect.objectContaining({ territory: '22001', value: 200 }),
      expect.objectContaining({ territory: '22002', value: 50 }),
      expect.objectContaining({ territory: '29001', value: 150 }),
      expect.objectContaining({ territory: '29002', value: null }), // absent ≠ zéro
    ])
  })

  it('réutilise le cache d’identité du client entre deux acquisitions de la même Cellule', async () => {
    const { fetcher, appels } = fakeFetcher(dataFor)
    const page = figureState({ x: { cell: densiteCell } })
    const options = { fetcher, discovery: atelierDiscoveryFixture }
    await acquireCellules(page, options)
    await acquireCellules(page, options)
    expect(appels).toHaveLength(1)
  })

  it('normalise les valeurs AEDAR et leur provenance en sources de dataset', async () => {
    const { fetcher } = fakeFetcher(dataFor)
    const cohorts = await acquireCellules(figureState({ x: { cell: aedarCell } }), { fetcher, discovery: atelierDiscoveryFixture })
    const cohort = cohorts[0]!
    expect(cohort.availability).toEqual({ status: 'available' })
    expect(cohort.values[0]).toMatchObject({
      territory: '22001', value: 61,
      sources: [{ sourceId: 'insee-rp', name: 'INSEE — Recensement', version: '2023' }],
    })
  })

  it('garde une publication retirée comme état typé, sans valeur inventée', async () => {
    const { fetcher } = fakeFetcher(dataFor)
    const cohorts = await acquireCellules(figureState({ x: { cell: prixCell } }), { fetcher, discovery: atelierDiscoveryFixture })
    expect(cohorts).toHaveLength(1)
    expect(cohorts[0]!.availability).toEqual({ status: 'publication_unavailable', reason: 'publication_absent', family: 'scalar' })
    expect(cohorts[0]!.values).toEqual([])
  })

  it('passe par le lot du client : 13 Cellules produisent deux requêtes d’au plus 12 lectures', async () => {
    const cellules: CellRef[] = Array.from({ length: 13 }, (_, i) => ({ resource: `ressource_${i}`, coordinates: {} }))
    const page: AtelierState = {
      v: 1, title: 'Atelier', blocks: [{
        kind: 'figure', id: 'f', figure: {
          type: 'nuage', level: 'commune', population: { excluded: 'hide' },
          variables: {
            x: { cell: cellules[0]! },
            y: { cell: cellules[1]! },
            taille: { formula: { expression: 'A+B', operands: Object.fromEntries(cellules.slice(2).map((cell, i) => [`${i}`, cell])) } },
          },
        },
      }],
    }
    const { fetcher, appels } = fakeFetcher((resource) => observationCohort(resource, 'commune', [['22001', 1]]))
    await acquireCellules(page, { fetcher })
    expect(appels).toHaveLength(2)
    expect(appels.every((appel) => appel.items.length <= 12)).toBe(true)
    expect(appels.reduce((total, appel) => total + appel.items.length, 0)).toBe(13)
  })
})
