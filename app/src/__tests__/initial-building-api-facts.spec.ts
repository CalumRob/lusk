import { describe, expect, it } from 'vitest'
import { applyInitialBuildingApiFacts } from '@/fiche/content/initialBuildingApiFacts'
import type { TerritoryFacts } from '@/fiche/content/territoryFacts'

const modes = { c: 'car', b: 'bike', t: 'walkTransit' } as const
const keys = Array.from({ length: 30 }, (_, i) => `b${i}`)
function facts(): TerritoryFacts {
  const curves = Object.fromEntries(Object.entries(modes).map(([, name]) => [name, {
    mode: name, modeLabel: name, points: Array.from({ length: 11 }, (_, i) => ({
      quantile: i / 10, quantileLabel: `${i * 10} %`, accessibleTypes: 999,
      comparisonAccessibleTypes: 999,
    })),
  }])) as unknown as NonNullable<TerritoryFacts['mobility']['accessRamp']>['curves']
  return { territory: { code: '22001', type: 'commune', name: 'Test', department: null, epci: null },
    theme: 'mobilite', mobility: { indicators: [], access: {} as TerritoryFacts['mobility']['access'],
      bpeAccess: {} as TerritoryFacts['mobility']['bpeAccess'], losses: {} as TerritoryFacts['mobility']['losses'],
      accessRamp: { availability: 'complete', xAxisLabel: 'x', yAxisLabel: 'y', curves,
        totalBuildings: 999, comparisonTotalBuildings: 999, comparisonLabel: 'stale', provenance: null },
      buildingDistribution: { availability: 'complete', mode: 't', modeLabel: 'Walk', breadthAxisLabel: 'b',
        depthAxisLabel: 'd', breadthBins: [], depthBins: [], totalBuildings: 999,
        comparisonTotalBuildings: 999, comparisonLabel: 'stale', provenance: null,
        cells: keys.map((key) => ({ breadthBucket: key, depthBucket: 'd', buildingCount: 999, share: 1,
          comparisonBuildingCount: 999, comparisonShare: 1 })) },
    } }
}
function response() {
  return { publication_id: 'building-v1', territory: { type: 'commune', id: '22001' },
    scope: { comparison_mode: 'densite', kind: 'communes-densite', label: 'communes peu denses' },
    ramp: Object.keys(modes).flatMap((mode) => Array.from({ length: 11 }, (_, i) => ({ mode,
      quantile_index: i, quantile: i / 10, accessible_types: 2, total_buildings: 30 }))),
    peer_ramp: { statistic: 'mean', member_count: 2, total_buildings: 60,
      points: Object.keys(modes).flatMap((mode) => Array.from({ length: 11 }, (_, i) => ({
        mode, quantile: i / 10, accessible_types: 1.5 }))) },
    distribution: keys.map((breadth_bucket) => ({ breadth_bucket, depth_bucket: 'd',
      building_count: 1, total_buildings: 30 })),
    peer_distribution: { statistic: 'mean', member_count: 2, total_buildings: 60,
      cells: keys.map((breadth_bucket) => ({ breadth_bucket, depth_bucket: 'd',
        building_count: 2, share: 1 / 30 })) },
  }
}

describe('initial building figures', () => {
  it('takes both focal and default peer numbers from API, never from JSON template', () => {
    const result = applyInitialBuildingApiFacts(facts(), response(), 'densite', 'communes-densite', 'communes peu denses')
    expect(result.mobility.accessRamp?.curves.car.points[0]).toMatchObject({ accessibleTypes: 2, comparisonAccessibleTypes: 1.5 })
    expect(result.mobility.buildingDistribution?.cells[0]).toMatchObject({ buildingCount: 1, comparisonBuildingCount: 2, comparisonShare: 1 / 30 })
    expect(result.mobility.accessRamp?.comparisonStatistic).toBe('mean')
    expect(result.mobility.buildingDistribution?.comparisonStatistic).toBe('mean')
  })
  it('rejects mismatched scope and incomplete published figures', () => {
    expect(() => applyInitialBuildingApiFacts(facts(), response(), 'epci', 'communes-densite', 'communes peu denses')).toThrow()
    const incomplete = response()
    incomplete.ramp.pop()
    expect(() => applyInitialBuildingApiFacts(facts(), incomplete, 'densite', 'communes-densite', 'communes peu denses')).toThrow()
  })
  it('keeps a region focal figure without inventing a peer group', () => {
    const regionFacts = facts()
    regionFacts.territory.type = 'region'
    const data = { ...response(), territory: { id: '22001', type: 'region' },
      scope: null, peer_ramp: null, peer_distribution: null }
    const result = applyInitialBuildingApiFacts(regionFacts, data, null, null, null)
    expect(result.mobility.accessRamp?.curves.car.points[0]).toMatchObject({ accessibleTypes: 2, comparisonAccessibleTypes: null })
    expect(result.mobility.buildingDistribution?.cells[0]?.comparisonShare).toBeNull()
  })
  it('keeps a focal figure when too few published members have a peer curve', () => {
    const data = { ...response(), peer_ramp: null, peer_distribution: null }
    const result = applyInitialBuildingApiFacts(facts(), data, 'densite', 'communes-densite', 'communes peu denses')
    expect(result.mobility.accessRamp?.curves.car.points[0]?.comparisonAccessibleTypes).toBeNull()
    expect(result.mobility.accessRamp?.comparisonStatistic).toBe('mean')
    expect(result.mobility.accessRamp?.comparisonLabel).toBe('communes peu denses')
  })
})
