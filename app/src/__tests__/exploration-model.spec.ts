import { describe, expect, it } from 'vitest'
import { estimerDensite, hauteurDensite, mediane, modeleExploration, payloadPourCarte, positionDensite, rangsExAequo } from '../indicateurs/explorationModel'
import { normalizeComparisonFacet } from '../indicateurs/familySeam'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Indicateur, Territoire } from '../payload/types'

const territoires: Territoire[] = [
  { territoire: 'a', type: 'commune', nom: 'Alpha', departement: '22', epci: 'e' }, { territoire: 'b', type: 'commune', nom: 'Beta', departement: '22', epci: 'e' }, { territoire: 'c', type: 'commune', nom: 'Gamma', departement: '29', epci: 'f' }, { territoire: 'd', type: 'commune', nom: 'Delta', departement: '29', epci: 'f' },
  { territoire: 'e', type: 'epci', nom: 'E Bretagne', departement: null, epci: null }, { territoire: 'f', type: 'epci', nom: 'F Bretagne', departement: null, epci: null }, { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: null, epci: null }, { territoire: '29', type: 'departement', nom: 'Finistère', departement: null, epci: null },
]
const facts = (id: string, value: number | null, type: Indicateur['type'] = 'commune'): Indicateur => ({ territoire: id, type, theme: 'demographie', key: 'densite', detail: null, value, unit: 'hab./km²', rang_epci: null, rang_dep: null, rang_reg: null, rang_epci_n: null, rang_dep_n: null, rang_reg_n: null, vintage_source: 'INSEE', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2024-01-01' })
const facet = (requested: object = {}) => normalizeComparisonFacet(metadonneesThemesFixtures.demographie.indicator_pages!.densite, requested, 'demographie')

describe('modèle pur de Page d’indicateur', () => {
  it('keeps Bretagne EPCI and département scopes populated', () => { expect(modeleExploration([facts('e', 10, 'epci'), facts('f', 20, 'epci')], facet(), territoires, { niveau: 'epci' }).rows).toHaveLength(2); expect(modeleExploration([facts('22', 10, 'departement'), facts('29', 20, 'departement')], facet(), territoires, { niveau: 'departement' }).rows).toHaveLength(2) })
  it('filters communes and removes incompatible scope state at other levels', () => { const factsAll = [facts('a', 10), facts('b', 20), facts('c', 30)]; expect(modeleExploration(factsAll, facet(), territoires, { niveau: 'commune', departement: '22' }).rows).toHaveLength(2); const result = modeleExploration([facts('e', 10, 'epci')], facet(), territoires, { niveau: 'epci', departement: '22', epci: 'e' }); expect(result.state.departement).toBeUndefined(); expect(result.state.epci).toBeUndefined() })
  it('computes median, direction and ranks from the resolved facet', () => { const metadata = structuredClone(metadonneesThemesFixtures.demographie); metadata.indicator_pages!.densite.direction = 'low'; const lowFacet = normalizeComparisonFacet(metadata.indicator_pages!.densite, {}, 'demographie'); const result = modeleExploration([facts('a', 10), facts('b', 10), facts('c', 30), facts('d', 40)], lowFacet, territoires, { niveau: 'commune', tri: 'valeur', ordre: 'desc' }); expect(result.median).toBe(20); expect(result.direction).toBe('low'); expect(result.rows.map((row) => row.rang)).toEqual([4, 3, 1, 1]) })
  it('samples finite density coordinates', () => { const density = estimerDensite([10, 20, 30]); expect(density.every((point) => Number.isFinite(point.x) && Number.isFinite(point.density))).toBe(true); expect(positionDensite(density, 20)).toBeCloseTo(50); expect(hauteurDensite(density, 20)).not.toBeNull() })
  it('uses the same resolved facet for map filtering including dimensions', () => { const resolved = { ...facet(), detail: 'F', sex: 'F' as const, dimension: 'women', labels: { F: 'Femmes' } }; const matching = [{ ...facts('a', 10), detail: 'F', sex: 'F', dimension: 'women' }, { ...facts('b', 20), detail: 'F', sex: 'F', dimension: 'women' }] as unknown as Indicateur[]; const source = { territoires, indicateurs: matching, histoires: [], apercu: null, runReport: null, vintages: null, programmes: null }; const result = payloadPourCarte(source, resolved, { niveau: 'commune', departement: '22' }); expect(result.indicateurs).toEqual(matching.slice(0, 2)) })
  it('presents ties, null values and empty scopes honestly', () => { const tied = modeleExploration([facts('a', 0), facts('b', 0), facts('c', null)], facet(), territoires, { niveau: 'commune', territoire: 'c' }); expect(tied.high.count).toBe(2); expect(tied.median).toBe(0); expect(tied.markerX).toBeNull(); const empty = modeleExploration([], facet(), territoires, { niveau: 'commune' }); expect(empty.rows).toHaveLength(0); expect(empty.median).toBeNull() })
})

// Les helpers partagés du rang et de la médiane (issue #437) — LA seule
// implémentation du codebase : le rang ordinal directionnel ex-aequo
// (ADR-0015 / CONTEXT.md Rang — « 1 = meilleur », les égalités partagent le
// rang, le suivant saute : 1, 1, 3) et la médiane. La grammaire des quatre
// familles Repères (#438/#439/#440/#441) les réutilise, jamais une copie privée.
describe('helpers partagés rang ex-aequo et médiane (#437)', () => {
  it('classe en concurrence avec ex-aequo qui saute (1, 1, 3) — direction high couronne la plus haute valeur', () => {
    expect(rangsExAequo([10, 40, 40, 20], 'high')).toEqual([4, 1, 1, 3])
    expect(rangsExAequo([5], 'high')).toEqual([1])
  })

  it('est directionnel : direction low couronne la plus BASSE valeur « 1ᵉʳ »', () => {
    expect(rangsExAequo([10, 10, 30, 40], 'low')).toEqual([1, 1, 3, 4])
    expect(rangsExAequo([10, 10, 30, 40], 'high')).toEqual([3, 3, 2, 1])
  })

  it('calcule la médiane — série impaire, paire, vide', () => {
    expect(mediane([30, 10, 20])).toBe(20)
    expect(mediane([40, 10, 30, 20])).toBe(25)
    expect(mediane([])).toBeNull()
  })
})
