import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAedarComparison } from '@/fiche/content/aedarComparisonClient'
import captured from './fixtures/aedar-selected-comparison-captured.json'

// Bridge of #904's guarded HTTP fixture: 10, 30 and 10 addresses,
// published means 5, 8 and 8; the API serves 7.4 and focal rank 3/3.
const members = ['sel-c1', 'sel-c2', 'sel-c3'].map((id) => ({ territory_type: 'commune' as const, territory_id: id }))
const source = { source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
  licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: null }
const cell = { ...source, comparison_context: 'selected_comparison', group_id: null, territory_type: 'commune',
  typequ: 'A104', typequ_label: 'Équipement', measure: 'count_5_walk_mean', statistic: 'pooled',
  group_value: 7.4, group_n_addresses: 50, group_n_observed: 42, group_coverage_status: 'covered',
  direction: 'high', comparison_facet: 'volume', rank: 3, rank_size: 3, rank_ties: 1,
  status: 'measured', n_addresses: 10, n_observed: 8, coverage_status: 'covered' }
const envelope = { resource: 'aedar_territorial_aggregate', target: { kind: 'territory', type: 'commune', id: 'sel-c1' },
  territory: { territory_type: 'commune', territory_id: 'sel-c1' }, content_version: 'comparison-v1',
  aedar_content_version: 'facts-v1', reference_content_version: 'reference-v1', source_snapshot_id: '2026-v1',
  selection: members, scope: { kind: 'explicit_selection', member_count: 3, territory_type: 'commune' }, comparisons: [cell] }

function mockResponse(data: unknown) {
  const fetcher = vi.fn(async (_url, init) => {
    const { items } = JSON.parse(init!.body as string)
    return { ok: true, json: async () => ({ contract: 'semantic-read-batch-v1',
      results: items.map((item: { id: string }) => ({ id: item.id, data })) }) } as Response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const options = { intent: { kind: 'selected_comparison' as const, members }, label: 'Moyenne de la sélection',
  typequ: ['A104'], measures: ['count_5_walk_mean'], expectedContentVersion: 'facts-v1', expectedReferenceContentVersion: 'reference-v1' }
afterEach(() => vi.unstubAllGlobals())

describe('lecture AEDAR de la Sélection', () => {
  it('admet la réponse capturée du lecteur API #904, scalaire et courbe sur le même instantané', async () => {
    // Captured with python -B from _aedar_selected_comparison_snapshot using
    // api/tests/test_aedar_contract.py's _AedarSelectedConnection,
    // _aedar_selected_state and _aedar_facets. No live/serving database.
    mockResponse({ ...captured, resource: 'aedar_territorial_aggregate', target: { kind: 'territory', type: 'commune', id: '22001' } })
    const result = await fetchAedarComparison('commune', '22001', { ...options,
      intent: { kind: 'selected_comparison', members: captured.selection as typeof members },
      measures: ['count_5_walk_mean', 'count_5_walk_decile1'], expectedContentVersion: 'aed-v1', expectedReferenceContentVersion: 'ref-v1' })
    expect(result).toMatchObject({ status: 'ready', evidence: { cells: [
      expect.objectContaining({ measure: 'count_5_walk_decile1', group_value: 2.2, rank: null }),
      expect.objectContaining({ measure: 'count_5_walk_mean', group_value: 7.4, rank: 3, rank_size: 3 }),
    ] } })
  })
  it('réutilise une lecture réussie seulement pour la même sélection, les mêmes coordonnées et publications', async () => {
    const fetcher = mockResponse(envelope)
    await fetchAedarComparison('commune', 'sel-c1', options)
    await fetchAedarComparison('commune', 'sel-c1', options)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await fetchAedarComparison('commune', 'sel-c1', { ...options, expectedContentVersion: 'new-publication' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('consomme la moyenne pondérée et le rang servis, sans observation focale dans la requête', async () => {
    const fetcher = mockResponse(envelope)
    const result = await fetchAedarComparison('commune', 'sel-c1', options)
    expect(result).toMatchObject({ status: 'ready', evidence: { label: 'Moyenne de la sélection',
      cells: [expect.objectContaining({ group_value: 7.4, rank: 3, rank_size: 3, rank_ties: 1 })] } })
    const item = JSON.parse(fetcher.mock.calls[0]![1]!.body as string).items[0]
    expect(item.intent).toEqual({ kind: 'selected_comparison', members: members.map((m) => ({ type: m.territory_type, id: m.territory_id })) })
    expect(item.coordinates).toEqual({ typequ: ['A104'], measure: ['count_5_walk_mean'] })
    expect(item.fields).toEqual(['group_value', 'rank', 'rank_size', 'rank_ties'])
  })
  it.each([
    { ...envelope, aedar_content_version: 'stale' },
    { ...envelope, reference_content_version: 'stale' },
    { ...envelope, selection: members.slice(1) },
    { ...envelope, comparisons: [] },
    { ...envelope, comparisons: [{ ...cell, typequ: 'B207' }] },
    { ...envelope, comparisons: [{ ...cell, rank: 4 }] },
  ])('échoue fermé devant une preuve incompatible ($aedar_content_version)', async (body) => {
    mockResponse(body)
    expect(await fetchAedarComparison('commune', 'sel-c1', options)).toMatchObject({ status: 'error' })
  })
  it('conserve le membre nommé par un échec API sans inventer de référence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ detail: 'Selected comparison member commune/nope has no published value' }) })))
    expect(await fetchAedarComparison('commune', 'sel-c1', options)).toEqual({ status: 'error',
      message: 'Selected comparison member commune/nope has no published value' })
  })
  it('lit le preset same_level comme agrégat direct de la Région sans demander de rang interdit', async () => {
    const fetcher = mockResponse({ ...envelope, target: { kind: 'territory', type: 'epci', id: 'sel-e1' },
      comparisons: undefined, selection: undefined, comparison: { ...cell, comparison_context: 'same_level',
        territory_type: 'region', group_id: '53', statistic: 'direct', group_value: 13 } })
    const result = await fetchAedarComparison('epci', 'sel-e1', { ...options,
      intent: { kind: 'fixed_comparison', context: 'same_level' }, label: 'Moyenne de Bretagne' })
    expect(result).toMatchObject({ status: 'ready', evidence: { cells: [expect.objectContaining({ group_value: 13, statistic: 'direct' })] } })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).items[0].fields).toEqual(['group_value'])
  })
})
