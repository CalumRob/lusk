import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adapterProfilComparaison, adapterProfilDeclare, type ProfileTarget } from '@/payload/profileAcquisition'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import { nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'

const wire = JSON.parse(readFileSync(join(process.cwd(), 'src', '__tests__', 'fixtures',
  'native-dpe-profile-responses.json'), 'utf8'))
const catalogue = JSON.parse(readFileSync(join(process.cwd(), 'src', '__tests__', 'fixtures',
  'native-catalogue.json'), 'utf8'))

describe('native DPE API → app adapter bridge', () => {
  it('adapts the captured API facts and explicit-selection comparison without synthetic wire fields', () => {
    const declaration = catalogue.resources.find((resource: SemanticResourceDeclaration) =>
      resource.resource_id === 'distribution_dpe')
    const scalarDeclaration = catalogue.resources.find((resource: SemanticResourceDeclaration) =>
      resource.resource_id === 'part_passoires')
    expect(declaration).toBeDefined()
    expect(scalarDeclaration).toBeDefined()

    const territories = wire.facts.cohort.members.map((member: { id: string; type: string; name: string }) => ({
      territoire: member.id, type: member.type, nom: member.name,
    }))
    const target = { type: 'commune' as const, department_id: null, epci_id: null }
    const acquired = adapterProfilDeclare({ declaration, cohort: wire.facts, territories, target })

    expect(acquired.facts).toHaveLength(28)
    expect(acquired.identity).toEqual({ contentVersion: 'profiles-v1', referenceContentVersion: 'ref-v1' })
    expect(wire.comparison.content_version).toBeNull()
    expect(wire.comparison.scope).toEqual({ kind: 'explicit_selection', member_count: 2 })
    expect(wire.comparison).not.toHaveProperty('scope.territory_type')

    const comparison = adapterProfilComparaison({
      declaration,
      descriptor: acquired.descriptor,
      identity: acquired.identity,
      comparison: wire.comparison,
      focal: { type: 'commune', id: '29001' },
      memberIds: ['29001', '29002'],
      coordinate: null,
      scalarDeclaration,
    })
    expect(comparison).toMatchObject({
      status: 'available', median: .2, rank: 2, rankSize: 2, rankTies: 1,
      selectedMemberCount: 2, eligibleCount: 2, missingCount: 0,
      contentVersion: null, profileContentVersion: 'profiles-v1',
      scalarContentVersion: 'scalar-v1', referenceContentVersion: 'ref-v1',
    })
    expect(comparison.memberRanks.map((row) => [row.territoryId, row.rank, row.rankSize])).toEqual([
      ['29001', 2, 2], ['29002', 1, 2],
    ])
    expect(comparison.comparisonSources[0]).toMatchObject({ sourceId: 'dpe_22', vintageId: 'dpe_22' })
  })

  it.each(['mix_logements', 'distribution_dpe', 'reseaux'])
  ('keeps synthetic producer-derived %s profile fixtures accepted at the real adapter seam', (resourceId) => {
    const declaration = nativeResources().find((resource) => resource.resource_id === resourceId) as
      SemanticResourceDeclaration
    const territories = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'territoires.json'), 'utf8'))
    const target: ProfileTarget = { type: 'commune', department_id: '22', epci_id: null }
    const cohortTarget = { kind: 'territory_cohort', type: target.type,
      department_id: target.department_id, epci_id: target.epci_id }
    const facts = nativeReadFixture({ target: cohortTarget, intent: { kind: 'facts' } },
      nativeResources().find((resource) => resource.resource_id === declaration.resource_id)!)
    const acquired = adapterProfilDeclare({ declaration, target, territories, cohort: facts })
    expect(acquired.memberIds.length).toBeGreaterThan(1)

    const selectedIds = acquired.memberIds.slice(0, 2)
    const focal = { type: 'commune' as const, id: selectedIds[0]! }
    const coordinate = acquired.descriptor.comparison_scalar ? null : acquired.descriptor.comparison_point
      ? { detail: acquired.descriptor.comparison_point.detail, sex: acquired.descriptor.comparison_point.sex }
      : { detail: 'principales', sex: null }
    const scalarDeclaration = acquired.descriptor.comparison_scalar
      ? nativeResources().find((resource) => resource.resource_id === acquired.descriptor.comparison_scalar) as SemanticResourceDeclaration
      : undefined
    const comparison = nativeReadFixture({ resource: declaration.resource_id,
      target: { kind: 'territory', type: focal.type, id: focal.id },
      ...(coordinate ? { coordinates: { detail: [coordinate.detail],
        ...(coordinate.sex ? { sex: [coordinate.sex] } : {}) } } : {}),
      intent: { kind: 'selected_comparison', members: selectedIds.map((id) => ({ type: focal.type, id })) } },
    nativeResources().find((resource) => resource.resource_id === declaration.resource_id)!)
    expect(() => adapterProfilComparaison({ declaration, descriptor: acquired.descriptor,
      identity: acquired.identity, comparison, focal, memberIds: selectedIds,
      coordinate, scalarDeclaration })).not.toThrow()
  })
})
