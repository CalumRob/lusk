import { afterEach, describe, expect, it, vi } from 'vitest'
import { aedarComparisonRank, fetchAedarComparison } from '@/fiche/content/aedarComparisonClient'
import captured from './fixtures/aedar-selected-comparison-captured.json'
const aggregateMeasures = ['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) => [5, 10, 15, 20]
  .flatMap((horizon) => ['Diversity', 'Volume'].map((kind) => mode === 'car' && horizon === 15
    ? kind === 'Diversity' ? 'meanDiversity' : 'meanVolume' : `${mode}${horizon}${kind}`)))
const aggregateCatalogue = { contract: 'semantic-resource-catalogue-v1', resources: [{ resource_id: 'aedar_territorial_aggregate',
  theme_id: '', indicator_id: 'aedar_territorial_aggregate', label: 'AEDAR aggregate', unit: '', direction: 'none',
  allowed_levels: ['commune', 'epci', 'departement', 'region'], sources: [], shapes: ['aedar_source_grain'],
  target_kinds: ['territory'], fields: ['group_value', 'rank', 'rank_size', 'rank_ties'], intents: ['fixed_comparison', 'selected_comparison'],
  measure_facets: Object.fromEntries(aggregateMeasures.map((measure) => [measure,
    { facet: measure.toLowerCase().includes('diversity') ? 'diversity' : 'volume', direction: 'high', ranked: true }])) }] }
const isCatalogue = (url: RequestInfo | URL) => String(url) === '/api/resources'

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
  summary_content_version: 'summary-v1', aedar_content_version: 'facts-v1', reference_content_version: 'reference-v1', source_snapshot_id: '2026-v1',
  selection: members, scope: { kind: 'explicit_selection', member_count: 3, territory_type: 'commune' }, comparisons: [cell] }

function mockResponse(data: unknown) {
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (isCatalogue(url)) return new Response(JSON.stringify(aggregateCatalogue))
    const { items } = JSON.parse(init!.body as string)
    return { ok: true, json: async () => ({ contract: 'semantic-read-batch-v1',
      results: items.map((item: { id: string }) => ({ id: item.id, data })) }) } as Response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const options = { intent: { kind: 'selected_comparison' as const, members }, label: 'Moyenne de la sélection',
  typequ: ['A104'], measures: ['count_5_walk_mean'], expectedContentVersion: 'facts-v1',
  expectedSummaryContentVersion: 'summary-v1', expectedReferenceContentVersion: 'reference-v1' }
// Fixed per-cell reads (#951/PR #957): one typequ+measure cell per item, no selection scope.
const fixedCellRow = (overrides: Record<string, unknown> = {}) => ({ ...cell,
  comparison_context: 'density_class', ...overrides })
const fixedCellResponse = (comparison: Record<string, unknown>) => ({ ...envelope,
  target: { kind: 'territory', type: 'commune', id: '22001' },
  selection: undefined, scope: undefined, comparisons: undefined, comparison })
const fixedCellRequest = { ...options, intent: { kind: 'fixed_comparison' as const, context: 'density_class' as const },
  label: 'Classe de densité' }
afterEach(() => vi.unstubAllGlobals())

describe('lecture AEDAR de la Sélection', () => {
  it('acquiert les 40 lectures agrégées en une requête de lot sans coordonnée TYPEQU', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => isCatalogue(url)
      ? new Response(JSON.stringify(aggregateCatalogue))
      : ({ ok: false, json: async () => ({ detail: 'fixture stop' }) }) as Response)
    vi.stubGlobal('fetch', fetcher)
    const measures = aggregateMeasures
    const result = await fetchAedarComparison('commune', '22001', { ...options,
      intent: { kind: 'fixed_comparison', context: 'density_class' }, label: 'Classe de densité', typequ: [], measures })
    expect(result.status).toBe('error')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![0]).toBe('/api/resources')
    const post = fetcher.mock.calls.find(([url]) => !isCatalogue(url))!
    const items = JSON.parse(post[1]!.body as string).items
    expect(items).toHaveLength(40)
    expect(items.every((item: { coordinates: Record<string, unknown> }) => !('typequ' in item.coordinates))).toBe(true)
    expect(items.map((item: { coordinates: { measure: string[] } }) => item.coordinates.measure[0])).toEqual(measures)
    // Ranks are tooltip-wide: with no `rankMeasures` allow-list the client ranks
    // every requested aggregate measure, never a narrow default.
    expect(items.every((item: { fields: string[] }) => item.fields.includes('rank'))).toBe(true)
  })
  it('valide le groupe agrégé fixed avec sommes observées dépassant les adresses et 40 valeurs distinctes', async () => {
    const measures = aggregateMeasures
    const request = { ...options, intent: { kind: 'fixed_comparison' as const, context: 'density_class' as const },
      label: 'Classe', typequ: [], measures }
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (isCatalogue(url)) return new Response(JSON.stringify(aggregateCatalogue))
      const { items } = JSON.parse(String(init?.body))
      return { ok: true, json: async () => ({ contract: 'semantic-read-batch-v1', results: items.map((item: any) => {
        const measure = item.coordinates.measure[0]
        const index = measures.indexOf(measure)
        return { id: item.id, data: { resource: item.resource, target: item.target,
          content_version: 'comparison-v1', summary_content_version: 'summary-v1', aedar_content_version: 'facts-v1', reference_content_version: 'reference-v1',
          comparison: { ...cell, typequ: null, measure, comparison_context: 'density_class',
            group_value: index + 0.25, group_n_addresses: 40, group_n_observed: 67,
            rank: 2, rank_size: 3, rank_ties: 1, direction: undefined } } }
      }) }) } as Response
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchAedarComparison('commune', 'sel-c1', request)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a ready aggregate response')
    expect(result.evidence.cells).toHaveLength(40)
    for (const [index, measure] of measures.entries()) {
      expect(result.evidence.cells.find((candidate) => candidate.measure === measure)).toMatchObject({
        typequ: null, measure, group_value: index + 0.25, group_n_addresses: 40, group_n_observed: 67,
        rank: 2, rank_size: 3, rank_ties: 1, direction: 'high',
      })
    }
    expect(fetcher).toHaveBeenCalledTimes(2)
    const post = fetcher.mock.calls.find(([url]) => !isCatalogue(url))!
    expect(JSON.parse(String(post[1]!.body)).items).toHaveLength(40)
    await fetchAedarComparison('commune', 'sel-c1', request)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('projette les rangs servis de chaque lecture fixe et conserve les 40 valeurs de groupe', async () => {
    const request = { ...options, intent: { kind: 'fixed_comparison' as const, context: 'density_class' as const },
      label: 'Classe', typequ: [], measures: aggregateMeasures }
    let sent: any[] = []
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (isCatalogue(url)) return new Response(JSON.stringify(aggregateCatalogue))
      const { items } = JSON.parse(String(init?.body))
      sent = items
      return { ok: true, json: async () => ({ contract: 'semantic-read-batch-v1', results: items.map((item: any) => {
        const measure = item.coordinates.measure[0]
        const index = aggregateMeasures.indexOf(measure)
        return { id: item.id, data: { resource: item.resource, target: item.target,
          content_version: 'comparison-v1', summary_content_version: 'summary-v1', aedar_content_version: 'facts-v1', reference_content_version: 'reference-v1',
          comparison: { ...cell, typequ: null, measure, comparison_context: 'density_class',
            group_value: index + 0.25, group_n_addresses: 40, group_n_observed: 67,
            rank: 2, rank_size: 3, rank_ties: 1, direction: undefined } } }
      }) }) } as Response
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchAedarComparison('commune', 'sel-c1', request)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected ready grouped aggregate response')
    expect(fetcher.mock.calls.filter(([url]) => !isCatalogue(url))).toHaveLength(1)
    expect(sent).toHaveLength(40)
    expect(sent.every((item) => item.fields.includes('rank'))).toBe(true)
    expect(result.evidence.cells).toHaveLength(40)
    for (const [index, measure] of aggregateMeasures.entries()) {
      const cellResult = result.evidence.cells.find((candidate) => candidate.measure === measure)!
      expect(cellResult.group_value).toBe(index + 0.25)
      expect(cellResult).toMatchObject({ rank: 2, rank_size: 3, rank_ties: 1 })
    }
  })
  it('valide un lot agrégé selected de 40 mesures, direction high et indisponibilité par mesure', async () => {
    const measures = aggregateMeasures
    const request = { ...options, typequ: [], measures }
    let allIneligible = false
    let selectedDirection: 'high' | 'low' = 'high'
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (isCatalogue(url)) return new Response(JSON.stringify(aggregateCatalogue))
      const { items } = JSON.parse(String(init?.body))
      const item = items[0]
      const comparisons = measures.map((measure, index) => {
        const unavailable = allIneligible || index === 1
        return { ...cell, typequ: null, measure, direction: selectedDirection,
          group_value: unavailable ? null : 12 + index, group_n_addresses: unavailable ? 0 : 40,
          group_n_observed: unavailable ? 0 : 67, group_coverage_status: unavailable ? null : 'covered',
          rank: unavailable ? null : 2, rank_size: unavailable ? null : 3, rank_ties: unavailable ? null : 1 }
      })
      return { ok: true, json: async () => ({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, data: {
        resource: item.resource, target: item.target, content_version: 'comparison-v1', summary_content_version: 'summary-v1', aedar_content_version: 'facts-v1',
        reference_content_version: 'reference-v1', selection: members,
        scope: { kind: 'explicit_selection', member_count: members.length }, comparisons,
      } }] }) } as Response
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchAedarComparison('commune', 'sel-c1', request)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a ready aggregate response')
    expect(result.evidence.cells).toHaveLength(40)
    expect(result.evidence.cells.find((candidate) => candidate.measure === measures[0])).toMatchObject({
      group_value: 12, group_n_addresses: 40, group_n_observed: 67, direction: 'high', rank: 2, rank_size: 3,
    })
    expect(result.evidence.cells.find((candidate) => candidate.measure === measures[1])).toMatchObject({
      group_value: null, group_n_addresses: 0, group_n_observed: 0, direction: 'high', rank: null,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const post = fetcher.mock.calls.find(([url]) => !isCatalogue(url))!
    expect(JSON.parse(String(post[1]!.body)).items).toHaveLength(1)
    expect(JSON.parse(String(post[1]!.body)).items[0].coordinates.measure).toHaveLength(40)
    allIneligible = true
    const empty = await fetchAedarComparison('commune', 'sel-c1', { ...request, label: 'Moyenne sans membre admissible' })
    expect(empty.status).toBe('ready')
    if (empty.status !== 'ready') throw new Error('Expected an unavailable aggregate response')
    expect(empty.evidence.cells).toHaveLength(40)
    expect(empty.evidence.cells[0]).toMatchObject({ group_value: null, group_n_addresses: 0,
      group_n_observed: 0, rank: null, rank_size: null, rank_ties: null })
    expect(fetcher.mock.calls.filter(([url]) => isCatalogue(url))).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => !isCatalogue(url))).toHaveLength(2)
    selectedDirection = 'low'
    expect(await fetchAedarComparison('commune', 'sel-c1', { ...request, label: 'Direction mismatched' }))
      .toMatchObject({ status: 'error' })
  })
  it('envoie la matrice selected des 40 rangs en un seul item et projette chaque rang servi', async () => {
    const measures = aggregateMeasures
    const request = { ...options, typequ: [], measures }
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (isCatalogue(url)) return new Response(JSON.stringify(aggregateCatalogue))
      const { items } = JSON.parse(String(init?.body))
      return { ok: true, json: async () => ({ contract: 'semantic-read-batch-v1', results: items.map((item: any) => ({
        id: item.id, data: { resource: item.resource, target: item.target, content_version: 'comparison-v1',
          summary_content_version: 'summary-v1', aedar_content_version: 'facts-v1', reference_content_version: 'reference-v1', selection: members,
          scope: { kind: 'explicit_selection', member_count: members.length },
          comparisons: item.coordinates.measure.map((measure: string) => ({ ...cell, typequ: null, measure,
            group_value: measures.indexOf(measure) + 1, group_n_addresses: 50, group_n_observed: 42,
            direction: 'high', rank: 3, rank_size: 3, rank_ties: 1 })) },
      })) }) } as Response
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchAedarComparison('commune', 'sel-c1', request)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected ready selected aggregate response')
    expect(fetcher.mock.calls.filter(([url]) => !isCatalogue(url))).toHaveLength(1)
    const posted = JSON.parse(String(fetcher.mock.calls.find(([url]) => !isCatalogue(url))![1]?.body)).items
    expect(posted).toHaveLength(1)
    expect(posted[0].coordinates.measure).toEqual(measures)
    expect(posted[0].fields).toEqual(['group_value', 'rank', 'rank_size', 'rank_ties'])
    expect(result.evidence.cells).toHaveLength(40)
    for (const [index, measure] of measures.entries()) {
      const cellResult = result.evidence.cells.find((candidate) => candidate.measure === measure)!
      expect(cellResult.group_value).toBe(index + 1)
      expect(cellResult).toMatchObject({ rank: 3, rank_size: 3, rank_ties: 1 })
    }
  })
  it('accepte un agrégat fixe indisponible aux adresses incompatibles mais refuse le dépassement per-TYPEQU', async () => {
    const fixedData = { ...envelope, selection: undefined, scope: undefined, comparisons: undefined,
      comparison: { ...cell, typequ: null, measure: 'meanDiversity', comparison_context: 'density_class',
        group_value: null, group_n_addresses: null, group_n_observed: null, group_coverage_status: null,
        rank: null, rank_size: null, rank_ties: null, direction: undefined } }
    mockResponse(fixedData)
    expect(await fetchAedarComparison('commune', 'sel-c1', { ...options,
      intent: { kind: 'fixed_comparison', context: 'density_class' }, typequ: [], measures: ['meanDiversity'] }))
      .toMatchObject({ status: 'ready', evidence: { cells: [expect.objectContaining({ group_value: null, group_n_addresses: null, group_n_observed: null })] } })

    mockResponse({ ...envelope, comparisons: [{ ...cell, group_n_observed: 51 }] })
    expect(await fetchAedarComparison('commune', 'sel-c1', options)).toMatchObject({ status: 'error' })
  })
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
  it('accepte les rangs agrégés avec direction sélectionnée et sans direction fixe', async () => {
    const selected = { ...envelope, comparisons: [{ ...cell, typequ: null, measure: 'meanDiversity' }] }
    mockResponse(selected)
    expect(await fetchAedarComparison('commune', 'sel-c1', { ...options, typequ: [], measures: ['meanDiversity'] }))
      .toMatchObject({ status: 'ready', evidence: { cells: [expect.objectContaining({ rank: 3, rank_size: 3, rank_ties: 1, direction: 'high' })] } })
    const fixed = { ...envelope, selection: undefined, scope: undefined, comparisons: undefined,
      comparison: { ...cell, typequ: null, measure: 'meanDiversity', comparison_context: 'density_class', direction: undefined } }
    mockResponse(fixed)
    expect(await fetchAedarComparison('commune', 'sel-c1', { ...options, intent: { kind: 'fixed_comparison', context: 'density_class' }, typequ: [], measures: ['meanDiversity'] }))
      .toMatchObject({ status: 'ready', evidence: { cells: [expect.objectContaining({ rank: 3, rank_size: 3, rank_ties: 1 })] } })
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
  it('échoue fermé devant une comparaison agrégée liée à une autre horloge de synthèse', async () => {
    mockResponse({ ...envelope, summary_content_version: 'stale-summary',
      comparisons: [{ ...cell, typequ: null, measure: 'meanDiversity' }] })
    expect(await fetchAedarComparison('commune', 'sel-c1', { ...options, typequ: [], measures: ['meanDiversity'] }))
      .toMatchObject({ status: 'error' })
  })
  it('conserve le membre nommé par un échec API sans inventer de référence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ detail: 'Selected comparison member commune/nope has no published value' }) })))
    expect(await fetchAedarComparison('commune', 'sel-c1', options)).toEqual({ status: 'error',
      message: 'Selected comparison member commune/nope has no published value' })
  })
  it('lit le preset same_level comme agrégat direct de la Région en demandant ses rangs fixes', async () => {
    const fetcher = mockResponse({ ...envelope, target: { kind: 'territory', type: 'epci', id: 'sel-e1' },
      comparisons: undefined, selection: undefined, comparison: { ...cell, comparison_context: 'same_level',
        territory_type: 'region', group_id: '53', statistic: 'direct', group_value: 13 } })
    const result = await fetchAedarComparison('epci', 'sel-e1', { ...options,
      intent: { kind: 'fixed_comparison', context: 'same_level' }, label: 'Moyenne de Bretagne' })
    expect(result).toMatchObject({ status: 'ready', evidence: { cells: [expect.objectContaining({
      group_value: 13, statistic: 'direct', rank: 3, rank_size: 3, rank_ties: 1 })] } })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).items[0].fields)
      .toEqual(['group_value', 'rank', 'rank_size', 'rank_ties'])
  })
  it('demande et projette les rangs servis d’une comparaison fixe par cellule', async () => {
    // 2e sur 41 pairs : aucun rang n’est calculable depuis group_value, la
    // cellule ne peut donc porter que l’ordinal renvoyé par le producteur.
    const fetcher = mockResponse(fixedCellResponse(fixedCellRow({ rank: 2, rank_size: 41, rank_ties: 1 })))
    const result = await fetchAedarComparison('commune', '22001', fixedCellRequest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a ready fixed per-cell response')
    const item = JSON.parse(fetcher.mock.calls[0]![1]!.body as string).items[0]
    expect(item.fields).toEqual(['group_value', 'rank', 'rank_size', 'rank_ties'])
    expect(item.coordinates).toEqual({ typequ: ['A104'], measure: ['count_5_walk_mean'] })
    expect(item.intent).toEqual({ kind: 'fixed_comparison', context: 'density_class' })
    expect(result.evidence.cells).toHaveLength(1)
    expect(result.evidence.cells[0]).toMatchObject({ typequ: 'A104', measure: 'count_5_walk_mean',
      group_value: 7.4, rank: 2, rank_size: 41, rank_ties: 1 })
    expect(aedarComparisonRank(result.evidence.cells[0])).toEqual({ position: 2, size: 41, ties: 1 })
  })
  it('admet une comparaison fixe par cellule sans rang servi et laisse la ligne valeur-seule', async () => {
    mockResponse(fixedCellResponse(fixedCellRow({ rank: null, rank_size: null, rank_ties: null })))
    const result = await fetchAedarComparison('commune', '22001', fixedCellRequest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected an unranked fixed per-cell response')
    expect(result.evidence.cells[0]).toMatchObject({ group_value: 7.4,
      rank: null, rank_size: null, rank_ties: null })
    expect(aedarComparisonRank(result.evidence.cells[0])).toBeNull()
  })
  it.each([
    ['rang unique', { rank: 2, rank_size: 41, rank_ties: 1 }],
    ['égalités comprises dans la population', { rank: 2, rank_size: 41, rank_ties: 2 }],
    ['dernier rang de la population', { rank: 41, rank_size: 41, rank_ties: 1 }],
  ])('admet un rang fixe servi dans sa population (%s)', async (_label, overrides) => {
    mockResponse(fixedCellResponse(fixedCellRow(overrides)))
    const result = await fetchAedarComparison('commune', '22001', fixedCellRequest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a ranked fixed per-cell response')
    expect(result.evidence.cells[0]).toMatchObject({ group_value: 7.4, ...overrides })
  })
  it('admet une population d’un seul territoire servie 1/1 et n’affiche aucun badge', async () => {
    // Le producteur classe une population éligible singleton (seule la focale
    // publie la cellule) : 1er/1 est une preuve valide, mais le tooltip n’a
    // aucun pair contre qui se positionner, donc l’affichage replie sur rien.
    mockResponse(fixedCellResponse(fixedCellRow({ rank: 1, rank_size: 1, rank_ties: 1 })))
    const result = await fetchAedarComparison('commune', '22001', fixedCellRequest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a singleton-population fixed per-cell response')
    expect(result.evidence.cells[0]).toMatchObject({ group_value: 7.4,
      rank: 1, rank_size: 1, rank_ties: 1 })
    expect(aedarComparisonRank(result.evidence.cells[0])).toBeNull()
  })
  it('conserve l’acceptation d’une population singleton sur une lecture selected', async () => {
    // Même loi partagée : un seul membre éligible sert 1/1 sans invalider la
    // lecture (régression du seuil d’affichage appliqué à la validation).
    mockResponse({ ...envelope, comparisons: [{ ...cell, rank: 1, rank_size: 1, rank_ties: 1 }] })
    const result = await fetchAedarComparison('commune', 'sel-c1', options)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected a singleton-population selected response')
    expect(result.evidence.cells[0]).toMatchObject({ rank: 1, rank_size: 1, rank_ties: 1 })
    expect(aedarComparisonRank(result.evidence.cells[0])).toBeNull()
  })
  it.each([
    ['rang sans taille ni égalités', { rank: 2, rank_size: null, rank_ties: null }],
    ['taille sans rang', { rank: null, rank_size: 3, rank_ties: 1 }],
    ['rangs explicitement indéfinis', { rank: undefined, rank_size: undefined, rank_ties: undefined }],
    ['rangs absents de la réponse', (() => { const row = fixedCellRow()
      delete (row as Record<string, unknown>).rank; delete (row as Record<string, unknown>).rank_size
      delete (row as Record<string, unknown>).rank_ties; return row })()],
  ])('refuse un rang fixe partiel (%s)', async (_label, row) => {
    mockResponse(fixedCellResponse(row as Record<string, unknown>))
    expect(await fetchAedarComparison('commune', '22001', fixedCellRequest)).toMatchObject({ status: 'error' })
  })
  it.each([
    ['rang nul', { rank: 0, rank_size: 3, rank_ties: 1 }],
    ['rang hors population', { rank: 4, rank_size: 3, rank_ties: 1 }],
    ['égalités débordant la population', { rank: 3, rank_size: 3, rank_ties: 2 }],
    ['population vide', { rank: 1, rank_size: 0, rank_ties: 1 }],
    ['rang non entier', { rank: 1.5, rank_size: 3, rank_ties: 1 }],
  ])('refuse un rang fixe hors bornes (%s)', async (_label, overrides) => {
    mockResponse(fixedCellResponse(fixedCellRow(overrides)))
    expect(await fetchAedarComparison('commune', '22001', fixedCellRequest)).toMatchObject({ status: 'error' })
  })
  it('lance les lots fixed_comparison en parallèle et conserve le nombre minimal de lots de 12 cellules', async () => {
    const typequ = Array.from({ length: 25 }, (_, index) => `T${index}`)
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      ({ ok: false, json: async () => ({ detail: 'fixture stop' }) }) as Response)
    vi.stubGlobal('fetch', fetcher)
    const resultPromise = fetchAedarComparison('commune', '22001', { ...options,
      intent: { kind: 'fixed_comparison', context: 'density_class' }, typequ,
      measures: ['count_5_walk_mean'], label: 'Classe de densité' })
    // All 3 requests (ceil(25 cells / 12)) are dispatched before any response
    // is awaited; the prior loop issued one request at a time.
    expect(fetcher).toHaveBeenCalledTimes(3)
    const result = await resultPromise
    expect(result).toMatchObject({ status: 'error' })
    const dispatched = fetcher.mock.calls.flatMap(([, init]) =>
      JSON.parse(init!.body as string).items as Array<{ coordinates: { typequ: string[]; measure: string[] } }>)
    expect(dispatched).toHaveLength(25)
    expect(dispatched.every((item) => item.coordinates.typequ.length === 1 && item.coordinates.measure.length === 1)).toBe(true)
  })
})
