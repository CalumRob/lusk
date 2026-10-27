import { afterEach, describe, expect, it, vi } from 'vitest'
import { adapterProfilComparaison, adapterProfilDeclare, chargerCohorteProfilDeclare,
  chargerComparaisonProfilDeclare, adapterProfilFocalDeclare, chargerFaitFocalProfilDeclare } from '@/payload/profileAcquisition'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import type { Territoire } from '@/payload/types'

const declaration: SemanticResourceDeclaration = {
  resource_id: 'mix_logements', theme_id: 'habitat', indicator_id: 'mix_logements',
  label: 'Mix natif API', unit: '%', direction: 'high',
  allowed_levels: ['commune', 'epci', 'departement'], sources: ['logements'],
  shapes: ['declared_profile'], target_kinds: ['territory', 'territory_cohort'],
  axes: ['detail'], axis_values: [['detail', ['principales', 'vacantes']]],
  fields: ['value'], intents: ['facts', 'selected_comparison'],
}

afterEach(() => vi.unstubAllGlobals())

const territories: Territoire[] = [
  { territoire: '22001', type: 'commune', nom: 'Focal', departement: '22', epci: 'E1' },
  { territoire: '22002', type: 'commune', nom: 'Pair', departement: '22', epci: 'E1' },
  { territoire: '29001', type: 'commune', nom: 'Other', departement: '29', epci: 'E2' },
]

const source = { source_id: 'logements', vintage_id: 'rp-2023', name: 'INSEE — Logements',
  version: '2023', reference_date: '2023-01-01', publication_date: '2026-06-30' }
const descriptor = {
  indicator: 'mix_logements', label: 'Mix natif API', unit: '%',
  allowed_levels: ['commune', 'epci', 'departement'], completeness: 'dense_complete',
  descriptor_version: 'profile-d1', denominator_semantics: 'logements',
  comparison_scalar: null, required_scalar_version: null,
  comparison_point: { detail: 'principales', sex: null, direction: 'high', unit: '%' },
  axes: [
    { name: 'detail', key: 'principales', label: 'Résidences principales', order: 0, unit: '%' },
    { name: 'detail', key: 'vacantes', label: 'Logements vacants', order: 1, unit: '%' },
  ],
}

function cell(detail: string, value: number | null, status = 'measured') {
  return { detail, sex: null, unit: '%', denominator_semantics: 'logements', status,
    value: status === 'measured' ? value : null, sources: [source] }
}

function cohortResponse() {
  const members = [
    { id: '22001', type: 'commune', name: 'Focal' },
    { id: '22002', type: 'commune', name: 'Pair' },
  ]
  return { resource: 'mix_logements', shape: 'declared_profile',
    target: { kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: null },
    content_version: 'profile-c1', reference_content_version: 'territories-r1', descriptor,
    cohort: { territory_type: 'commune', department_id: '22', epci_id: null,
      member_count: 2, members, reference_content_version: 'territories-r1' },
    profiles: members.map((territory) => ({ territory,
      cells: territory.id === '22001' ? [cell('principales', .72), cell('vacantes', .08)]
        : [cell('principales', .61), cell('vacantes', .12)] })) }
}

function comparisonResponse() {
  return { resource: 'mix_logements', target: { kind: 'territory', type: 'commune', id: '22001' },
    contract: 'indicator-comparison-v1', indicator_id: 'mix_logements', shape: 'profile',
    content_version: null, profile_content_version: 'profile-c1',
    reference_content_version: 'territories-r1', scalar_content_version: null,
    selection: [{ territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'commune', territory_id: '22002' }],
    scope: { kind: 'explicit_selection', member_count: 2 },
    result: { indicator_id: 'mix_logements', status: 'available', reason: null,
      source_facet: { detail: 'principales', sex: null }, unit: '%', direction: 'high', statistic: 'median',
      profile_descriptor_version: 'profile-d1', denominator_semantics: 'logements',
      focal_in_selection: true, selected_member_count: 2, eligible_count: 2, missing_count: 0,
      median: .665, rank: 1, rank_size: 2, rank_ties: 1,
      member_ranks: [
        { territory_id: '22001', rank: 1, rank_size: 2, rank_ties: 1 },
        { territory_id: '22002', rank: 2, rank_size: 2, rank_ties: 1 },
      ],
      comparison_sources: [source] } }
}

describe('l’acquisition du profil déclaré', () => {
  it('adapte les faits natifs du cohort en conservant axes, unités, statuts, provenance et horloges', () => {
    const result = adapterProfilDeclare({
      declaration, target: { type: 'commune', department_id: '22', epci_id: null }, territories,
      cohort: cohortResponse(),
    })

    expect(result.facts.map(({ territoire, detail, value, unit, fact_status, vintage_source }) =>
      [territoire, detail, value, unit, fact_status, vintage_source])).toEqual([
      ['22001', 'principales', .72, '%', 'measured', 'INSEE — Logements'],
      ['22001', 'vacantes', .08, '%', 'measured', 'INSEE — Logements'],
      ['22002', 'principales', .61, '%', 'measured', 'INSEE — Logements'],
      ['22002', 'vacantes', .12, '%', 'measured', 'INSEE — Logements'],
    ])
    expect(result.descriptor.axes.map(({ key, label, order, unit }) => [key, label, order, unit])).toEqual([
      ['principales', 'Résidences principales', 0, '%'], ['vacantes', 'Logements vacants', 1, '%'],
    ])
    expect(result.facts[0]).toMatchObject({ denominator_semantics: 'logements', nativeContract: {
      completeness: 'dense_complete', denominatorSemantics: 'logements', descriptorVersion: 'profile-d1',
      contentVersion: 'profile-c1', referenceContentVersion: 'territories-r1',
    } })
    expect(result.facts[0]?.fact_sources?.[0]).toMatchObject({ sourceId: 'logements', vintageId: 'rp-2023',
      version: '2023', referenceDate: '2023-01-01', publicationDate: '2026-06-30' })
    expect(result.identity).toEqual({ contentVersion: 'profile-c1', referenceContentVersion: 'territories-r1' })
  })

  it('retient les statuts natifs sans inventer une valeur', () => {
    const unavailable = cohortResponse()
    unavailable.profiles[0]!.cells[1] = cell('vacantes', null, 'suppressed')
    const result = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: unavailable })
    expect(result.facts[1]).toMatchObject({ value: null, fact_status: 'suppressed', observation_status: 'missing' })
  })

  it('refuse une cellule manquante au lieu de réutiliser une ligne statique', () => {
    const broken = cohortResponse()
    broken.profiles[0]!.cells = broken.profiles[0]!.cells.slice(1)
    expect(() => adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: broken })).toThrow(/incomplet|cellule/i)
  })

  it('refuse un cohort dont les membres ne correspondent pas exactement aux filtres', () => {
    const broken = cohortResponse()
    broken.cohort.members.push({ id: '29001', type: 'commune', name: 'Other' })
    expect(() => adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: broken })).toThrow(/membres|cohort/i)
  })

  it('adapte une lecture focale native hors cohort sans modifier les membres comparés', () => {
    const acquired = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: cohortResponse() })
    const focalDescriptor = { ...descriptor }
    delete (focalDescriptor as { completeness?: string }).completeness
    const raw = { resource: 'mix_logements', target: { kind: 'territory', type: 'commune', id: '29001' },
      content_version: 'profile-c1', reference_content_version: 'territories-r1',
      descriptor: focalDescriptor, observations: [cell('principales', .55), cell('vacantes', .09)] }

    const facts = adapterProfilFocalDeclare({ declaration, descriptor: acquired.descriptor, identity: acquired.identity,
      focal: { type: 'commune', id: '29001' }, territories, result: raw })

    expect(acquired.memberIds).toEqual(['22001', '22002'])
    expect(facts.map(({ territoire, detail, value }) => [territoire, detail, value])).toEqual([
      ['29001', 'principales', .55], ['29001', 'vacantes', .09],
    ])
    expect(() => adapterProfilFocalDeclare({ declaration, descriptor: acquired.descriptor, identity: acquired.identity,
      focal: { type: 'commune', id: '29001' }, territories,
      result: { ...raw, content_version: 'stale-profile' } })).toThrow(/publication/i)
  })

  it('adapte la comparaison sélectionnée seulement si sa facette et sa version correspondent au cohort', () => {
    const acquired = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: cohortResponse() })
    const result = adapterProfilComparaison({ declaration, descriptor: acquired.descriptor, identity: acquired.identity,
      focal: { type: 'commune', id: '22001' }, memberIds: acquired.memberIds,
      coordinate: { detail: 'principales', sex: null }, comparison: comparisonResponse() })
    expect(result).toMatchObject({ status: 'available', median: .665, rank: 1, rankSize: 2, rankTies: 1,
      selectedMemberCount: 2, eligibleCount: 2, missingCount: 0, unit: '%', direction: 'high',
      facet: { detail: 'principales', sex: null }, contentVersion: null })
    expect(result.comparisonSources[0]).toMatchObject({ sourceId: 'logements', vintageId: 'rp-2023',
      version: '2023', referenceDate: '2023-01-01', publicationDate: '2026-06-30' })
    expect(adapterProfilComparaison({ declaration, descriptor: acquired.descriptor, identity: acquired.identity,
      focal: { type: 'commune', id: '22001' }, memberIds: acquired.memberIds,
      coordinate: { detail: 'principales', sex: null },
      comparison: { ...comparisonResponse(), content_version: 'unrelated-global-token' } }))
      .toMatchObject({ profileContentVersion: 'profile-c1', referenceContentVersion: 'territories-r1', contentVersion: null })
  })

  it('refuse une comparaison de profil d’une autre facette ou d’une publication différente', () => {
    const acquired = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: cohortResponse() })
    const input = { declaration, descriptor: acquired.descriptor, identity: acquired.identity,
      focal: { type: 'commune' as const, id: '22001' }, memberIds: acquired.memberIds,
      coordinate: { detail: 'principales', sex: null }, comparison: comparisonResponse() }
    expect(() => adapterProfilComparaison({ ...input, comparison: { ...comparisonResponse(),
      result: { ...comparisonResponse().result, source_facet: { detail: 'vacantes', sex: null } } } })).toThrow(/facette/i)
    expect(() => adapterProfilComparaison({ ...input, comparison: { ...comparisonResponse(),
      profile_content_version: 'stale-profile' } })).toThrow(/version/i)
  })

  it('refuse un intervalle de rangs à ex-aequo impossible pour une comparaison native', () => {
    const acquired = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: cohortResponse() })
    const input = { declaration, descriptor: acquired.descriptor, identity: acquired.identity,
      focal: { type: 'commune' as const, id: '22001' }, memberIds: acquired.memberIds,
      coordinate: { detail: 'principales', sex: null }, comparison: comparisonResponse() }
    const brokenFocal = comparisonResponse()
    brokenFocal.result.rank = 2
    brokenFocal.result.rank_ties = 2
    expect(() => adapterProfilComparaison({ ...input, comparison: brokenFocal })).toThrow(/rang|cohérent/i)

    const brokenPeer = comparisonResponse()
    brokenPeer.result.member_ranks[1]!.rank = 2
    brokenPeer.result.member_ranks[1]!.rank_ties = 2
    expect(() => adapterProfilComparaison({ ...input, comparison: brokenPeer })).toThrow(/rang individuel|incohérent/i)
  })

  it('lit le cohort de faits d’une seule ressource à la cible filtrée du contrat', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { items: Array<Record<string, unknown>> }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: request.items.map((item) =>
        ({ id: item.id, resource: item.resource, data: cohortResponse() })) }))
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await chargerCohorteProfilDeclare(declaration,
      { type: 'commune', department_id: '22', epci_id: null }, territories)
    const call = fetcher.mock.calls[0]!
    expect(String(call[0])).toBe('/api/resources/read-batch')
    expect(JSON.parse((call[1] as RequestInit).body as string).items).toEqual([expect.objectContaining({
      resource: 'mix_logements',
      target: { kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: null },
      fields: ['value'], intent: { kind: 'facts' },
    })])
    expect(result.facts).toHaveLength(4)
  })

  it('lit uniquement le territoire focal quand une sélection explicite le place hors du cohort', async () => {
    const raw = { resource: 'mix_logements', target: { kind: 'territory', type: 'commune', id: '29001' },
      content_version: 'profile-c1', reference_content_version: 'territories-r1',
      descriptor: { ...descriptor, completeness: undefined }, observations: [cell('principales', .55), cell('vacantes', .09)] }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { items: Array<Record<string, unknown>> }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: request.items.map((item) =>
        ({ id: item.id, resource: item.resource, data: raw })) }))
    })
    vi.stubGlobal('fetch', fetcher)
    const acquired = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: cohortResponse() })
    const facts = await chargerFaitFocalProfilDeclare({ declaration, descriptor: acquired.descriptor,
      identity: acquired.identity, focal: { type: 'commune', id: '29001' }, territories })

    expect(JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string).items).toEqual([expect.objectContaining({
      resource: 'mix_logements', target: { kind: 'territory', type: 'commune', id: '29001' },
      fields: ['value'], intent: { kind: 'facts' },
    })])
    expect(facts.map(({ territoire }) => territoire)).toEqual(['29001', '29001'])
  })

  it('relit seulement la comparaison explicite au détail sélectionné', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { items: Array<Record<string, unknown>> }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: request.items.map((item) =>
        ({ id: item.id, resource: item.resource, data: comparisonResponse() })) }))
    })
    vi.stubGlobal('fetch', fetcher)
    const acquired = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: cohortResponse() })
    await chargerComparaisonProfilDeclare({ declaration, descriptor: acquired.descriptor, identity: acquired.identity,
      focal: { type: 'commune', id: '22001' }, memberIds: acquired.memberIds,
      coordinate: { detail: 'principales', sex: null } })
    const request = JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]).toMatchObject({ resource: 'mix_logements',
      target: { kind: 'territory', type: 'commune', id: '22001' },
      coordinates: { detail: ['principales'] },
      intent: { kind: 'selected_comparison', members: [
        { type: 'commune', id: '22001' }, { type: 'commune', id: '22002' },
      ] } })
  })
})
