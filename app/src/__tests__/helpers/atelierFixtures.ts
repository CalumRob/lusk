/**
 * Synthetic discovery, territory reference and cohort fixtures for the Atelier
 * model specs — same spirit as payload/fixtures.ts, never producer data.
 * 4 communes across 2 EPCIs in 2 départements, plus their parents and the region.
 */

import type { Territoire } from '@/payload/types'
import type { AtelierLevel, CellRef } from '@/atelier/state'
import type { DiscoveryResource } from '@/atelier/types'

export const atelierReferenceFixture: Territoire[] = [
  { territoire: '22001', type: 'commune', nom: 'Commune A', departement: '22', epci: '200000001', classe_densite_code: 'D1', littoral_code: 'C' },
  { territoire: '22002', type: 'commune', nom: 'Commune B', departement: '22', epci: '200000001', classe_densite_code: 'D2', littoral_code: 'NC' },
  { territoire: '29001', type: 'commune', nom: 'Commune C', departement: '29', epci: '200000002', classe_densite_code: 'D1', littoral_code: 'C' },
  { territoire: '29002', type: 'commune', nom: 'Commune D (sans donnée)', departement: '29', epci: '200000002', classe_densite_code: 'D3', littoral_code: null },
  { territoire: '200000001', type: 'epci', nom: 'EPCI X', departement: '22', epci: null },
  { territoire: '200000002', type: 'epci', nom: 'EPCI Y', departement: '29', epci: null },
  { territoire: '22', type: 'departement', nom: 'Département 22', departement: '22', epci: null },
  { territoire: '29', type: 'departement', nom: 'Département 29', departement: '29', epci: null },
  { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
]

const unite = (unit: string | null) => (value: string, label = value) => ({ value, label, unit })

export const atelierDiscoveryFixture: DiscoveryResource[] = [
  {
    resource_id: 'densite', label: 'Densité de population', unit: 'hab/km²',
    sources: ['INSEE — Recensement'], shapes: ['scalar'],
    cellule: { coordinates: [{ name: 'annee', values: [unite('hab/km²')('2022')] }], valid_combinations: [{ annee: '2022' }], default_point: { annee: '2022' } },
  },
  {
    resource_id: 'prix_m2', label: 'Prix du m²', unit: '€/m²',
    sources: ['DVF — Prix de vente'], shapes: ['scalar'],
    cellule: { coordinates: [{ name: 'year', values: [unite('€/m²')('2022'), unite('€/m²')('2021')] }] },
  },
  {
    resource_id: 'structure_age', label: 'Population par âge', unit: 'personnes',
    sources: ['INSEE — Recensement'], shapes: ['declared_profile'],
    cellule: {
      coordinates: [
        { name: 'detail', values: [unite('personnes')('65-79', '65–79 ans')] },
        { name: 'sex', values: [unite(null)('F', 'Femmes'), unite(null)('M', 'Hommes')] },
      ],
      default_point: { detail: '65-79', sex: 'F' },
    },
  },
  {
    resource_id: 'aedar_territorial_aggregate', label: 'Accès aux équipements', unit: '%',
    sources: ['BPE — INSEE', 'Réseau — Observatoire'], shapes: ['aedar_source_grain'],
    cellule: {
      coordinates: [
        { name: 'typequ', values: [unite(null)('D265', 'Médecin généraliste')] },
        { name: 'horizon', values: [unite('minutes')('15', '15 min'), unite('minutes')('20', '20 min')] },
        { name: 'mode', values: [unite(null)('bike_lts2', 'Vélo LTS2'), unite(null)('walk', 'À pied')] },
        { name: 'statistic', values: [unite(null)('share', 'Part')] },
      ],
      valid_combinations: [{ typequ: 'D265', horizon: '15', mode: 'bike_lts2', statistic: 'share' }],
      default_point: { typequ: 'D265', horizon: '15', mode: 'bike_lts2', statistic: 'share' },
    },
  },
]

export const sourceFixture = {
  source_id: 'insee-rp', name: 'INSEE — Recensement', vintage_id: '2023',
  version: '2023', reference_date: '2023-01-01', publication_date: '2026-06-30',
}

const member = (id: string, type: AtelierLevel | 'region') => {
  const territory = atelierReferenceFixture.find((row) => row.territoire === id)!
  return { id, type, name: territory.nom }
}

/** A scalar cohort `data` payload, as returned by the shared client's available outcome. */
export function observationCohort(resource: string, level: AtelierLevel, rows: Array<[string, number | null]>) {
  return {
    resource,
    target: { kind: 'territory_cohort', type: level, department_id: null, epci_id: null },
    shape: 'scalar',
    cohort: { territory_type: level, members: rows.map(([id]) => member(id, level)), member_count: rows.length },
    observations: rows.map(([id, value]) => ({
      territory: member(id, level), status: value === null ? 'suppressed' : 'measured',
      ...(value === null ? {} : { value }), sources: [sourceFixture],
    })),
  }
}

/** An AEDAR cohort `data` payload, with flat provenance on each observation. */
export function aedarCohort(resource: string, level: AtelierLevel, rows: Array<[string, number | null]>) {
  return {
    resource,
    target: { kind: 'territory_cohort', type: level, department_id: null, epci_id: null },
    shape: 'aedar_per_cell_cohort',
    cohort: { territory_type: level, members: rows.map(([id]) => member(id, level)), member_count: rows.length },
    values: rows.map(([id, value]) => ({
      territory: member(id, level),
      ...(value === null ? {} : { value }),
      ...sourceFixture, source_url: 'https://exemple.fr/source', licence: 'ouvert', attribution: 'INSEE',
    })),
  }
}

export const densiteCell: CellRef = { resource: 'densite', coordinates: { annee: '2022' } }
export const prixCell: CellRef = { resource: 'prix_m2', coordinates: { year: '2022' } }
export const aedarCell: CellRef = {
  resource: 'aedar_territorial_aggregate',
  coordinates: { typequ: 'D265', horizon: '15', mode: 'bike_lts2', statistic: 'share' },
}
