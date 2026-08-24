import { describe, expect, it } from 'vitest'
import { dispatchIndicatorFamily, normalizeComparisonFacet } from '../indicateurs/familySeam'
import type { FamilyDispatch, FamilyName } from '../indicateurs/familySeam'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Indicateur } from '../payload/types'

type DispatchFor<F extends FamilyName> = Extract<FamilyDispatch, { family: F }>
type Assert<T extends true> = T
type FamilyAlignment = Assert<DispatchFor<'trajectory'>['representation']['kind'] extends 'trajectory' ? true : false>
const familyAlignment: FamilyAlignment = true

describe('seam des familles de Repères', () => {
  it('normalise une facette URL et conserve la facette scalaire', () => {
    const page = metadonneesThemesFixtures.demographie.indicator_pages!.densite
    const facet = normalizeComparisonFacet(page, { detail: 'stale', sex: 'X', dimension: 'total' })
    expect(facet).toMatchObject({ indicator: 'densite', detail: null, sex: null, label: 'Densité de population', direction: 'high', unit: 'hab./km²' })
    expect(facet.url).toBe('')
  })

  it('publishes the resolved detail label for map and comparison surfaces', () => {
    const page = { ...metadonneesThemesFixtures.demographie.indicator_pages!.densite, comparison: { details: ['total'], detail: 'total', labels: { total: 'Population totale' } } }
    expect(normalizeComparisonFacet(page, {}).label).toBe('Population totale')
    expect(familyAlignment).toBe(true)
  })

  it.each([
    ['scalar', 'scalar'], ['trajectory', 'trajectory'], ['composition', 'composition'],
    ['distribution', 'distribution'], ['list', 'list'], ['relationship', 'relationship'],
    ['pyramid', 'pyramid'], ['comparison-bars', 'comparison-bars'],
  ] as const)('dispatches %s through one renderer identity', (family, renderer) => {
    const page = { ...metadonneesThemesFixtures.demographie.indicator_pages!.densite, family, indicator: `fixture_${family}` }
    if (family !== 'scalar') (page as any)[family === 'comparison-bars' ? 'comparisonBars' : family] = family === 'relationship' ? { roles: { x: { indicator: 'densite', detail: null, label: 'Axe X', unit: 'hab./km²' }, y: { indicator: 'densite', detail: null, label: 'Axe Y', unit: 'hab./km²' } } } : family === 'distribution' ? { signature: ['s'] } : { [family === 'trajectory' ? 'endpoints' : family === 'composition' ? 'parts' : family === 'list' ? 'categories' : family === 'pyramid' ? 'dimensions' : 'series']: ['x'] }
    const result = dispatchIndicatorFamily(page as any, {})
    expect(result.family).toBe(family)
    expect(result.renderer).toBe(renderer)
    expect(result.status).toBe('unavailable')
    expect(result.representation.kind).toBe(family)
  })

  it('canonicalizes declared facet values and distinguishes invalid from unavailable/incomplete', () => {
    const base = { ...metadonneesThemesFixtures.demographie.indicator_pages!.densite, family: 'composition' as const, composition: { parts: ['total'] }, comparison: { details: ['total', 'F'], detail: 'total', sexes: ['F' as const], unit: 'hab./km²', labels: { total: 'Total' } } }
    const valid = dispatchIndicatorFamily(base, { facet: { detail: 'F', sex: 'F' }, facts: [] })
    expect(valid.facet.url).toContain('detail=F'); expect(valid.status).toBe('unavailable')
    const invalid = dispatchIndicatorFamily(base, { facet: { detail: 'stale', sex: 'X' } })
    expect(invalid.status).toBe('invalid'); expect(invalid.resolvedUrl).toContain('detail=total')
    const fact = { territoire: 'a', type: 'commune', theme: 'demographie', key: 'densite', detail: null, value: null, unit: 'hab./km²', rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null, vintage_source: 'x', vintage_version: 'x', vintage_date_reference: null, vintage_date_publication: 'x' } satisfies Indicateur
    expect(dispatchIndicatorFamily(metadonneesThemesFixtures.demographie.indicator_pages!.densite, { facts: [fact] }).status).toBe('incomplete')
  })

  // La facette résumée d'une distribution (#440) : elle lit une AUTRE clé
  // publiée que la page (part_passoires résume distribution_dpe) et son
  // libellé + unité déclarés sont CE QUE LE VISITEUR VOIT — jamais le libellé
  // de la page sur des valeurs d'une autre clé.
  it('résout la facette résumée d\u2019une distribution : clé croisée, libellé public, unité déclarée', () => {
    const page = { ...metadonneesThemesFixtures.demographie.indicator_pages!.densite, indicator: 'distribution_dpe', family: 'distribution' as const, distribution: { signature: ['A'] }, comparison: { indicator: 'part_passoires', label: 'Part de passoires thermiques', unit: '%', direction: 'low' as const } }
    const facet = normalizeComparisonFacet(page, {}, 'habitat')
    expect(facet).toMatchObject({ indicator: 'part_passoires', label: 'Part de passoires thermiques', unit: '%', direction: 'low', detail: null })
    expect(dispatchIndicatorFamily(page as any, { theme: 'habitat', facts: [] })).toMatchObject({ family: 'distribution', status: 'unavailable' })
  })
})
