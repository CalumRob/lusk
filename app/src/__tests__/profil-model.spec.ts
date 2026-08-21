import { describe, expect, it } from 'vitest'
import { modeleProfil } from '../indicateurs/profilModel'
import { metadonneesThemesFixtures, territoiresFixture } from '../payload/fixtures'
import type { Indicateur } from '../payload/types'

const fact = (territoire: string, detail: string | null, value: number | null): Indicateur => ({ territoire, type: 'commune', theme: 'demographie', key: 'structure_age', detail, value, unit: '%', rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null, vintage_source: 'RP', vintage_version: '2023', vintage_date_reference: '2023', vintage_date_publication: '2024' })

describe('contrat de profil', () => {
  it('uses metadata order, keeps the complete category vocabulary, and selects a URL facet', () => {
    const result = modeleProfil([fact('22001', '15-24', 20), fact('22001', '<15', 10)], metadonneesThemesFixtures.demographie, territoiresFixture, '15-24')
    expect(result.details.slice(0, 2)).toEqual(['<15', '15-24'])
    expect(result.selected).toBe('15-24')
    expect(result.selectedLabel).toBe('15 à 24 ans')
    expect(result.state).toBe('short')
  })

  it('does not invent an extreme for ties or for an unavailable facet', () => {
    const tied = modeleProfil([fact('22001', '<15', 10), fact('22002', '<15', 10)], metadonneesThemesFixtures.demographie, territoiresFixture)
    expect(tied.high.count).toBe(2); expect(tied.high.rows).toHaveLength(0)
    const unavailable = modeleProfil([], metadonneesThemesFixtures.demographie, territoiresFixture, 'missing')
    expect(unavailable.state).toBe('empty'); expect(unavailable.selected).toBeNull()
  })
})
