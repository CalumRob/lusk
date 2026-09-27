import { describe, expect, it } from 'vitest'
import { applyBuildingApiFacts, clearBuildingApiPeers } from '@/fiche/content/buildingApiFacts'
import type { TerritoryFacts } from '@/fiche/content/territoryFacts'

const facts = (): TerritoryFacts => ({ territory: { code: '22001', type: 'commune', name: 'Test', department: null, epci: null }, theme: 'mobilite', mobility: {
  indicators: [], access: {} as TerritoryFacts['mobility']['access'], bpeAccess: {} as TerritoryFacts['mobility']['bpeAccess'], losses: {} as TerritoryFacts['mobility']['losses'],
  accessRamp: { availability: 'complete', xAxisLabel: 'q', yAxisLabel: 'types', totalBuildings: 10, provenance: { sourceId: 'focal', source: 'local', version: '1', referenceDate: null, publicationDate: null }, comparisonLabel: null, comparisonTotalBuildings: null,
    curves: { car: { mode: 'car', modeLabel: 'Car', points: [{ quantile: 0.5, quantileLabel: '50 %', accessibleTypes: 3, comparisonAccessibleTypes: 99 }] }, bike: { mode: 'bike', modeLabel: 'Bike', points: [] }, walkTransit: { mode: 'walkTransit', modeLabel: 'Walk', points: [] } } },
  buildingDistribution: { availability: 'complete', mode: 't', modeLabel: 'Walk', breadthAxisLabel: 'b', depthAxisLabel: 'd', breadthBins: [], depthBins: [], cells: [{ breadthBucket: 'b1', depthBucket: 'd1', buildingCount: 4, share: 0.4, comparisonBuildingCount: 99, comparisonShare: 0.99 }], totalBuildings: 10, provenance: null, comparisonLabel: null, comparisonTotalBuildings: null },
} })
const response = (overrides: Record<string, unknown> = {}) => ({ publication_id: 'pub', territory: { id: '22001', type: 'commune', name: 'Test' }, scope: { kind: 'custom', direction: 'high', level: 'commune', members: ['22002'] }, ramp: { statistic: 'mean', member_count: 2, total_buildings: 5, points: ['c', 'b', 't'].flatMap((mode) => Array.from({ length: 11 }, (_, index) => ({ mode, quantile: index / 10, accessible_types: index === 5 ? 2.5 : index / 2 }))) }, distribution: { statistic: 'mean', member_count: 2, total_buildings: 5, cells: Array.from({ length: 30 }, (_, index) => ({ breadth_bucket: `b${index + 1}`, depth_bucket: `d${index + 1}`, building_count: index === 0 ? 2 : 0, share: index === 0 ? 0.4 : 0 })) }, ...overrides })

describe('applyBuildingApiFacts', () => {
  it('overlays peer values without changing focal values or provenance, and clears unmatched fallback values', () => {
    const before = facts()
    const result = applyBuildingApiFacts(before, response())
    expect(result.mobility.accessRamp?.curves.car.points[0]).toMatchObject({ accessibleTypes: 3, comparisonAccessibleTypes: 2.5 })
    expect(result.mobility.accessRamp?.provenance?.sourceId).toBe('focal')
    expect(result.mobility.accessRamp?.curves.bike.points).toEqual([])
    expect(result.mobility.buildingDistribution?.cells[0]).toMatchObject({ buildingCount: 4, comparisonBuildingCount: 2, comparisonShare: 0.4 })
    expect(result.mobility.accessRamp?.comparisonStatistic).toBe('mean')
    expect(applyBuildingApiFacts(before, response({ ramp: null, distribution: null })).mobility.accessRamp?.curves.car.points[0]?.comparisonAccessibleTypes).toBeNull()
  })
  it('fails closed for malformed data and mismatched expected publication', () => {
    expect(() => applyBuildingApiFacts(facts(), response(), 'other')).toThrow()
    expect(() => applyBuildingApiFacts(facts(), response({ ramp: { statistic: 'median' } }))).toThrow()
    expect(() => applyBuildingApiFacts(facts(), response({ ramp: { statistic: 'mean', member_count: 2, total_buildings: 5, points: [] } }))).toThrow()
  })
  it('does not show static peers while an explicit group is loading or failed', () => {
    const result = clearBuildingApiPeers(facts())
    expect(result.mobility.accessRamp?.curves.car.points[0]?.comparisonAccessibleTypes).toBeNull()
    expect(result.mobility.buildingDistribution?.cells[0]?.comparisonShare).toBeNull()
    expect(result.mobility.accessRamp?.curves.car.points[0]?.accessibleTypes).toBe(3)
    expect(result.mobility.accessRamp?.comparisonStatistic).toBe('mean')
  })
})
