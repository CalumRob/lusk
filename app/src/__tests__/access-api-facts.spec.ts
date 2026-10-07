import { describe, expect, it } from 'vitest'
import { applyAccessApiFacts } from '@/fiche/content/accessApiFacts'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type { Payload } from '@/payload/types'

// API publication IDs follow the canonical share_* keys, not the French page IDs.
const services = ['admin', 'food', 'health', 'bank', 'school']
const responseFor = (overrides: Record<string, unknown> = {}) => ({
  publication_id: 'publication-api', territory: { id: '22001', name: 'Test', type: 'commune' },
  scope: { kind: 'communes-epci', label: 'Pairs API', member_count: 2 },
  services: services.map((id) => ({ id, modes: Object.fromEntries([
    ['car', 0.8], ['bike', 0.5], ['walk_transit', 0.2],
  ].map(([mode, value]) => [mode, { value, median: 0.4, rank: { position: 1, size: 2 }, direction: 'high', indicator_label: `${id}-${mode}`, source_id: `api-${id}-${mode}`, source_name: 'API source', source_version: 'v1', reference_date: null, source_publication_date: '2026-01-01' }])), peer_median_car_gap: 0.3, peer_median_bike_gain: 0.1 })),
  ...overrides,
})
const facts = () => territoryFactsFor({
  territoires: [{ territoire: '22001', type: 'commune', nom: 'Test', departement: '22', epci: null }],
  indicateurs: [], histoires: [], apercu: null, runReport: null, vintages: [], programmes: null,
} as Payload, '22001')!

describe('applyAccessApiFacts', () => {
  it('uses API shares, provenance, ranks and peer medians, not static facts', () => {
    const base = facts()
    const result = applyAccessApiFacts(base, responseFor(), 'communes-epci', 'Pairs API')
    const access = result.mobility.access
    expect(access.byService.administration.car.value).toBe(0.8)
    expect(access.byService.administration.car.provenance?.sourceId).toBe('api-admin-car')
    expect(access.byService.administration.car.comparison?.rank).toEqual({ position: 1, size: 2 })
    expect(access.gapsByService.administration.carGap.value).toBeCloseTo(0.6)
    expect(access.gapsByService.administration.carGap.comparison?.reference?.value).toBe(0.3)
    expect(access.summary).toBe(base.mobility.access.summary)
  })

  it('preserves nulls and omits comparisons for region facts', () => {
    const base = { ...facts(), territory: { ...facts().territory, code: '53', type: 'region' as const } }
    const body = responseFor({ territory: { id: '53', name: 'Bretagne', type: 'region' }, scope: { kind: 'aucune' } }) as any
    body.services[0].modes.car.value = null
    body.services[0].modes.car.median = null
    body.services[0].modes.car.rank = null
    for (const service of body.services) {
      service.peer_median_car_gap = null
      service.peer_median_bike_gain = null
      for (const mode of Object.values(service.modes) as any[]) {
        mode.median = null
        mode.rank = null
      }
    }
    body.scope = null
    const result = applyAccessApiFacts(base, body, null, null)
    expect(result.mobility.access.byService.administration.car.value).toBeNull()
    expect(result.mobility.access.byService.administration.car.availability).toBe('incomplete')
    expect(result.mobility.access.byService.administration.car.comparison).toBeNull()
    expect(result.mobility.access.gapsByService.administration.carGap.comparison).toBeNull()
  })

  it('accepts bounded scope kinds and fails closed on mismatches or malformed incomplete shapes', () => {
    const base = facts()
    expect(applyAccessApiFacts(base, responseFor({ scope: { kind: 'communes-densite', member_count: 2 } }), 'communes-densite', 'Published density label').mobility.access.byService.administration.car.comparison?.scope.label).toBe('Published density label')
    expect(() => applyAccessApiFacts(base, responseFor({ territory: { id: 'wrong', type: 'commune' } }), 'communes-epci', 'Pairs API')).toThrow()
    const invalid = responseFor() as any
    invalid.services[4].modes.walk_transit.value = 1.1
    expect(() => applyAccessApiFacts(base, invalid, 'communes-epci', 'Pairs API')).toThrow()
  })

  it.each([
    ['epcis-bretagne', 61, 'EPCI bretons'],
    ['departements-bretagne', 4, 'départements bretons'],
  ] as const)('accepts deployed %s scope without an optional display label', (kind, member_count, label) => {
    const body = responseFor({ scope: { kind, member_count } })
    const result = applyAccessApiFacts(facts(), body, kind, null)
    expect(result.mobility.access.byService.administration.car.value).toBe(0.8)
    expect(result.mobility.access.byService.administration.car.comparison?.scope.label).toBe(label)
  })
})
