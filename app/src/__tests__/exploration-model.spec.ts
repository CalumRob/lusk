import { describe, expect, it } from 'vitest'
import { modeleExploration } from '../indicateurs/explorationModel'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Indicateur, Territoire } from '../payload/types'

const territoires: Territoire[] = [
  { territoire: 'a', type: 'commune', nom: 'Alpha', departement: '22', epci: 'e' },
  { territoire: 'b', type: 'commune', nom: 'Beta', departement: '22', epci: 'e' },
  { territoire: 'c', type: 'commune', nom: 'Gamma', departement: '29', epci: 'f' },
]
const facts = (id: string, value: number): Indicateur => ({ territoire: id, type: 'commune', theme: 'demographie', key: 'densite', detail: null, value, unit: 'hab./km²', rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null, vintage_source: 'INSEE', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2024-01-01' })

describe('modèle pur de Page d’indicateur', () => {
  it('normalise le niveau, scope les pairs et conserve les égalités', () => {
    const result = modeleExploration([facts('a', 10), facts('b', 10), facts('c', 20)], metadonneesThemesFixtures.demographie, territoires, { niveau: 'commune', departement: '22' })
    expect(result.state.niveau).toBe('commune')
    expect(result.rows.map((row) => row.territoire.nom)).toEqual(['Alpha', 'Beta'])
    expect(result.median).toBe(10)
    expect(result.high).toHaveLength(2)
    expect(result.low).toHaveLength(2)
  })
  it('gives explicit URL state precedence over remembered level', () => {
    const result = modeleExploration([facts('a', 10)], metadonneesThemesFixtures.demographie, territoires, { niveau: 'commune' }, 'departement')
    expect(result.state.niveau).toBe('commune')
  })
  it('uses the arithmetic median for even samples and direction-aware competition ranks', () => {
    const meta = structuredClone(metadonneesThemesFixtures.demographie)
    meta.indicator_pages!.densite.direction = 'moins = mieux'
    const result = modeleExploration([facts('a', 10), facts('b', 20), facts('c', 30)], meta, territoires, { niveau: 'commune' })
    expect(result.median).toBe(20)
    expect(result.rows.map((row) => row.rang)).toEqual([3, 2, 1])
  })
})
