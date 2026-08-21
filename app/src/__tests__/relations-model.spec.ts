import { describe, expect, it } from 'vitest'
import { modeleRelation } from '../indicateurs/explorationModel'
import type { Indicateur, RelationshipPageMetadata, Territoire } from '../payload/types'

const territories: Territoire[] = [
  { territoire: 'a', type: 'commune', nom: 'Alpha', departement: '22', epci: 'e' },
  { territoire: 'b', type: 'commune', nom: 'Beta', departement: '22', epci: 'e' },
]
const stamp = { vintage_source: 'x', vintage_version: '1', vintage_date_reference: null, vintage_date_publication: '2026-01-01' }
const fact = (territoire: string, key: string, value: number | null): Indicateur => ({ ...stamp, territoire, type: 'commune', theme: 'economie', key, detail: null, value, unit: 'u', rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null })
const page: RelationshipPageMetadata = { family: 'relationship', indicator: 'relation', detail: null, label: 'Relation', definition: 'Deux forces.', unit: '—', calculation: 'Publié', caveats: 'Les points incomplets restent visibles.', levels: ['commune'], sources: ['x'], axis: { indicator: 'axe', label: 'Axe', unit: 'a' }, measure: { indicator: 'mesure', label: 'Mesure', unit: 'm' }, scalarFacet: { indicator: 'facette', direction: 'high' } }

describe('modeleRelation', () => {
  it('keeps the same territories and selected highlight in cloud and table', () => {
    const model = modeleRelation([fact('a', 'axe', 1), fact('a', 'mesure', 2), fact('a', 'facette', 3), fact('b', 'axe', null), fact('b', 'mesure', 4), fact('b', 'facette', 1)], page, territories, 'commune', 'a')
    expect(model.points.map((point) => point.territoire.territoire)).toEqual(['a', 'b'])
    expect(model.table.map((point) => point.territoire.territoire)).toEqual(['a', 'b'])
    expect(model.points.find((point) => point.highlighted)?.territoire.nom).toBe('Alpha')
    expect(model.incomplete.map((point) => point.territoire.territoire)).toEqual(['b'])
  })

  it('uses declared semantic roles and does not infer them from names', () => {
    const model = modeleRelation([fact('a', 'axe', 5), fact('a', 'mesure', 6), fact('a', 'facette', 7)], page, territories, 'commune')
    expect(model.axisLabel).toBe('Axe')
    expect(model.measureLabel).toBe('Mesure')
    expect(model.scalarIndicator).toBe('facette')
  })
})
