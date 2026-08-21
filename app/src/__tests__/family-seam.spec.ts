import { describe, expect, it } from 'vitest'
import { dispatchIndicatorFamily, normalizeComparisonFacet } from '../indicateurs/familySeam'
import { metadonneesThemesFixtures } from '../payload/fixtures'

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
  ] as const)('dispatches %s through one renderer identity', (family, renderer) => {
    const page = { ...metadonneesThemesFixtures.demographie.indicator_pages!.densite, family, indicator: `fixture_${family}` }
    const result = dispatchIndicatorFamily(page, {})
    expect(result.family).toBe(family)
    expect(result.renderer).toBe(renderer)
    expect(result.status).toBe('missing')
  })
})
