import { describe, expect, it } from 'vitest'
import { dispatchIndicatorFamily, normalizeComparisonFacet } from '../indicateurs/familySeam'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Indicateur } from '../payload/types'

describe('seam des familles de Repères', () => {
  it('normalise une facette URL et conserve la facette scalaire', () => {
    const page = metadonneesThemesFixtures.demographie.indicator_pages!.densite
    const facet = normalizeComparisonFacet(page, { detail: 'stale', sex: 'X', dimension: 'total' })
    expect(facet).toMatchObject({ indicator: 'densite', detail: null, sex: null, direction: 'high', unit: 'hab./km²' })
    expect(facet.url).toBe('?facet=densite')
  })

  it.each([
    ['scalar', 'scalar'], ['trajectory', 'trajectory'], ['composition', 'composition'],
    ['distribution', 'distribution'], ['list', 'list'], ['relationship', 'relationship'],
    ['profile', 'profile'], ['pyramid', 'pyramid'], ['comparison-bars', 'comparison-bars'],
  ] as const)('dispatches %s through one renderer identity', (family, renderer) => {
    const page = { ...metadonneesThemesFixtures.demographie.indicator_pages!.densite, family, indicator: `fixture_${family}` }
    const result = dispatchIndicatorFamily(page, {})
    expect(result.family).toBe(family)
    expect(result.renderer).toBe(renderer)
    expect(result.status).toBe('unavailable')
    expect(result.representation.kind).toBe(family)
  })

  it('canonicalizes declared facet values and distinguishes invalid from unavailable/incomplete', () => {
    const base = { ...metadonneesThemesFixtures.demographie.indicator_pages!.densite, family: 'composition' as const, comparison: { details: ['total', 'F'], detail: 'total', sexes: ['F' as const], unit: 'hab./km²', labels: { total: 'Total' } } }
    const valid = dispatchIndicatorFamily(base, { facet: { detail: 'F', sex: 'F' }, facts: [] })
    expect(valid.facet.url).toContain('detail=F'); expect(valid.status).toBe('unavailable')
    const invalid = dispatchIndicatorFamily(base, { facet: { detail: 'stale', sex: 'X' } })
    expect(invalid.status).toBe('invalid'); expect(invalid.resolvedUrl).toContain('detail=total')
    const fact = { territoire: 'a', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: null, unit: 'hab./km²', rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null, vintage_source: 'x', vintage_version: 'x', vintage_date_reference: null, vintage_date_publication: 'x' } satisfies Indicateur
    expect(dispatchIndicatorFamily(metadonneesThemesFixtures.demographie.indicator_pages!.densite, { facts: [fact] }).status).toBe('incomplete')
  })
})
