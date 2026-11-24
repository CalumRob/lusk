import { describe, expect, it } from 'vitest'

import { nativeReadFixture, nativeResources } from './semanticApiFixtures'

/**
 * The memoisation is a test-cost optimisation, not a change in fixture
 * semantics: two requests with the same resource/target/intent but different
 * wire IDs must observe the very same facts, and neither may be able to mutate
 * the other through the shared cache (specs deliberately corrupt responses to
 * prove that consumers fail closed).
 */
describe('native semantic fixtures — memoised builders', () => {
  const resource = nativeResources('habitat').find((candidate) => candidate.resource_id === 'mix_logements')!
  const request = (id: string) => ({
    id,
    resource: resource.resource_id,
    target: { kind: 'territory_cohort', type: 'commune' },
    intent: { kind: 'facts' },
  })

  it('reuses the response across wire IDs without sharing mutable state', () => {
    const first = nativeReadFixture(request('first'), resource)
    const second = nativeReadFixture(request('second'), resource)

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second.profiles).not.toBe(first.profiles)

    first.profiles[0].cells[0].value = -999
    const third = nativeReadFixture(request('third'), resource)
    expect(third).toEqual(second)
    expect(third.profiles[0].cells[0].value).not.toBe(-999)
  })

  it('keys injected fixture tables by identity, never by the wire ID', () => {
    const emptyTerritories: Array<Record<string, any>> = []
    const empty = nativeReadFixture(request('empty'), resource, { territories: emptyTerritories })
    expect(empty.cohort.member_count).toBe(0)
    expect(nativeReadFixture(request('default'), resource).cohort.member_count).toBeGreaterThan(0)
    expect(nativeReadFixture(request('empty-again'), resource, { territories: emptyTerritories })).toEqual(empty)
  })
})
