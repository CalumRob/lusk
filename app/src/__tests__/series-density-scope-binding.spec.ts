import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createOrderedSeriesSemanticSession,
  reacquireOrderedSeriesComparison,
  SeriesComparisonRejectedError,
} from '@/payload/seriesSemanticAcquisition'
import type { OrderedSeriesFactsEvidence } from '@/payload/seriesSemanticAcquisition'
import type { Territoire } from '@/payload/types'
import { nativeBatchResponse, nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'

afterEach(() => vi.unstubAllGlobals())

/**
 * Contrat fail-closed de la portée de comparaison au seam de binding
 * (#892) — lu dans le producteur, pas deviné :
 * api/snapshot_reads.py::_comparison_cohort + api/theme-read-contract.md.
 *
 *   intent de requête        niveau        scope.kind attendu   champs d'identité requis
 *   fixed_comparison         commune       density_class        territory_type 'commune' + density_class_code non vide = classe du focal acquis
 *   fixed_comparison         epci/dept     same_level           territory_type exact du niveau acquis (jamais absent)
 *   selected_comparison      commune       explicit_selection   écho de sélection exact
 *   fixed_comparison         région        AUCUNE comparaison publiée -> fail-closed
 *
 * Toute réponse malformée est rejetée — comparaison seule, faits admis,
 * aucun rang, aucune note.
 */

const territories = JSON.parse(
  readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8')) as Territoire[]
const focal = territories.find((territory) => territory.territoire === '22001' && territory.type === 'commune')!
const focalEpci = territories.find((territory) => territory.territoire === '200027027' && territory.type === 'epci')!
const focalDept = territories.find((territory) => territory.territoire === '22' && territory.type === 'departement')!
const resource = nativeResources().find((candidate) => candidate.resource_id === 'prix_m2')!
const input = { resource: resource!.resource_id, level: 'commune' as const, focal, territories }

function serveWithMutation(mutate?: (data: Record<string, any>) => void) {
  return vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
    const { items } = JSON.parse(String(init?.body))
    return nativeBatchResponse(items, (item, declaration) => {
      const data = nativeReadFixture(item, declaration, { territories })
      if (mutate && item.intent?.kind !== 'facts') mutate(data)
      return data
    })
  })
}

describe('density_class comparison scope — fail-closed au seam de binding (#892)', () => {
  it('admet une portée density_class valide (les deux champs émis par le producteur)', async () => {
    vi.stubGlobal('fetch', serveWithMutation())
    const read = await createOrderedSeriesSemanticSession().acquire(input)
    expect(read.comparison?.scope).toMatchObject({
      kind: 'density_class',
      density_class_code: focal.classe_densite_code,
      territory_type: 'commune',
    })
  })

  const corruptions: Array<[string, (data: Record<string, any>) => void]> = [
    ['territory_type absent', (data) => { delete data.scope.territory_type }],
    ['territory_type erroné (epci)', (data) => { data.scope.territory_type = 'epci' }],
    ['density_class_code absent', (data) => { delete data.scope.density_class_code }],
    ['density_class_code vide', (data) => { data.scope.density_class_code = '' }],
    ['density_class_code différent du focal acquis', (data) => { data.scope.density_class_code = '1' }],
  ]

  for (const [label, mutate] of corruptions) {
    it(`rejette la comparaison seule (faits admis, aucun rang) : ${label}`, async () => {
      vi.stubGlobal('fetch', serveWithMutation(mutate))
      let rejected: unknown
      try {
        await createOrderedSeriesSemanticSession().acquire(input)
      } catch (cause) { rejected = cause }
      expect(rejected, label).toBeInstanceOf(SeriesComparisonRejectedError)
      const admitted = (rejected as SeriesComparisonRejectedError).facts
      expect(admitted.scope_series.length, `${label}: les faits restent admis`).toBeGreaterThan(0)
      expect(admitted.territory.id, `${label}: le focal admis est conservé`).toBe(focal.territoire)
    })
  }
})

describe('matrice intent de requête -> scope.kind (#892 fail-closed)', () => {
  const inputs: Record<string, any> = {
    fixedCommune: { resource: 'prix_m2', level: 'commune', focal, territories },
    selectedCommune: { resource: 'prix_m2', level: 'commune', focal, territories, departmentId: '22' },
    fixedEpci: { resource: 'subventions_annuelles', level: 'epci', focal: focalEpci, territories },
    fixedDepartement: { resource: 'subventions_annuelles', level: 'departement', focal: focalDept, territories },
  }
  const expectedByInput: Record<string, string> = {
    fixedCommune: 'density_class',
    selectedCommune: 'explicit_selection',
    fixedEpci: 'same_level',
    fixedDepartement: 'same_level',
  }

  async function acquireWith(nom: string, mutate?: (data: Record<string, any>) => void) {
    vi.stubGlobal('fetch', serveWithMutation(mutate))
    try {
      return { read: await createOrderedSeriesSemanticSession().acquire(inputs[nom]) as any, rejected: undefined as unknown }
    } catch (cause) {
      return { read: undefined as any, rejected: cause }
    }
  }

  for (const nom of Object.keys(inputs)) {
    it(`${nom} : la portée valide « ${expectedByInput[nom]} » est admise`, async () => {
      const { read, rejected } = await acquireWith(nom)
      expect(rejected).toBeUndefined()
      expect(read.comparison?.scope?.kind).toBe(expectedByInput[nom])
    })
    for (const kind of ['inconnu', 'same_level', 'density_class', 'explicit_selection']) {
      if (kind === expectedByInput[nom]) continue
      it(`${nom} : kind « ${kind} » (connu mais faux) ou inconnu est rejeté, comparaison seule`, async () => {
        const { read, rejected } = await acquireWith(nom, (data) => { data.scope.kind = kind })
        expect(read, `kind ${kind} sur ${nom}`).toBeUndefined()
        expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
        expect((rejected as SeriesComparisonRejectedError).facts.scope_series.length).toBeGreaterThan(0)
      })
    }
    it(`${nom} : kind absent est rejeté`, async () => {
      const { rejected } = await acquireWith(nom, (data) => { delete data.scope.kind })
      expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
    })
  }

  it('selected_comparison avec same_level ET sélection échoée ne passe plus (cas signalé)', async () => {
    const { rejected } = await acquireWith('selectedCommune', (data) => { data.scope.kind = 'same_level' })
    expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
  })
})

describe('same_level : territory_type exact requis + identité de cohorte (epci ET département)', () => {
  for (const nom of ['fixedEpci', 'fixedDepartement'] as const) {
    const inputs: Record<string, any> = {
      fixedEpci: { resource: 'subventions_annuelles', level: 'epci', focal: focalEpci, territories },
      fixedDepartement: { resource: 'subventions_annuelles', level: 'departement', focal: focalDept, territories },
    }
    it(`${nom} : territory_type absent sur same_level est rejeté (champ requis par le producteur)`, async () => {
      vi.stubGlobal('fetch', serveWithMutation((data) => { delete data.scope.territory_type }))
      let rejected: unknown
      try { await createOrderedSeriesSemanticSession().acquire(inputs[nom]) } catch (cause) { rejected = cause }
      expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
    })
    it(`${nom} : territory_type erroné est rejeté`, async () => {
      vi.stubGlobal('fetch', serveWithMutation((data) => {
        data.scope.territory_type = data.scope.territory_type === 'epci' ? 'departement' : 'epci'
      }))
      let rejected: unknown
      try { await createOrderedSeriesSemanticSession().acquire(inputs[nom]) } catch (cause) { rejected = cause }
      expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
    })
    it(`${nom} : un ID de rang étranger (même compte) est rejeté — l'identité de cohorte est vérifiée, pas seulement le compte`, async () => {
      vi.stubGlobal('fetch', serveWithMutation((data) => {
        const axes = data.result.axis_comparisons
        const premier = axes.find((a: any) => Array.isArray(a.member_ranks) && a.member_ranks.length > 0)
        premier.member_ranks[0] = { ...premier.member_ranks[0], territory_id: 'epci-etranger' }
      }))
      let rejected: unknown
      try { await createOrderedSeriesSemanticSession().acquire(inputs[nom]) } catch (cause) { rejected = cause }
      expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
    })
  }
})

describe('région fixed_comparison : fail-closed (niveau non supporté par les ressources série ordinaires)', () => {
  // Ressource série ordinaire : la région n'est pas dans allowed_levels — le
  // producteur renvoie scope null / cohorte vide / unavailable. On ne traite
  // PAS la région comme un contrat supporté : toute réponse de comparaison
  // régional est rejetée fail-closed au seam (le raccordement régional a son
  // propre contrat owner, hors de ce seam).
  const regionFacts: OrderedSeriesFactsEvidence = {
    indicator_id: 'prix_m2', axis_kind: 'year', unit: '€/m²',
    territory: { id: '53', type: 'region' },
    points: [], scope_series: [],
    native_descriptor: { label: 'Prix', unit: '€/m²', direction: 'low', axis_kind: 'year', axis_values: [], comparison_point: null },
    descriptor: { descriptor_version: 'dv1' },
    content_version: 'cv1', reference_content_version: 'rv1',
    role_axes: [], declared_source_ids: ['s1'],
    resolved_cohort_type: 'region', resolved_cohort_members: [], cohort_is_filtered: false,
  }
  const regionInput = { resource: 'prix_m2', level: 'region' as const, focal: territories.find((t) => t.territoire === '53')!, territories, facts: regionFacts }

  function serveRawComparison(comparisonData: Record<string, any>) {
    return vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      const { items } = JSON.parse(String(init?.body))
      const item = items[0]
      // écho d'identité exacte exigé par le client de lot (corrélation requête/réponse)
      comparisonData.target = item.target
      return Response.json({ contract: 'semantic-read-batch-v1',
        results: [{ id: item.id, resource: item.resource, data: comparisonData }] }, { status: 200 })
    })
  }
  const baseComparison: Record<string, any> = {
    resource: 'prix_m2', target: { kind: 'territory', type: 'region', id: '53' },
    content_version: 'cv1', reference_content_version: 'rv1',
    scope: null,
    result: { indicator_id: 'prix_m2', descriptor_version: 'dv1', statistic: 'median',
      status: 'unavailable', reason: 'unsupported_comparison_contract',
      selected_member_count: 0, eligible_count: 0, missing_count: 0,
      rank: null, rank_size: null, axis_comparisons: [] },
  }

  it('rejette même la forme exacte du producteur (scope null, zéro membre, unavailable)', async () => {
    vi.stubGlobal('fetch', serveRawComparison(structuredClone(baseComparison)))
    await expect(reacquireOrderedSeriesComparison(regionInput)).rejects.toThrow(/niveau/i)
  })
  it('rejette une réponse régionale avec scope présent', async () => {
    const data = structuredClone(baseComparison)
    data.scope = { kind: 'same_level', territory_type: 'region', member_count: 1 }
    vi.stubGlobal('fetch', serveRawComparison(data))
    await expect(reacquireOrderedSeriesComparison(regionInput)).rejects.toThrow()
  })
  it('rejette une variante régionale « available » avec rangs', async () => {
    const data = structuredClone(baseComparison)
    data.scope = { kind: 'same_level', territory_type: 'region', member_count: 1 }
    data.result.status = 'available'
    data.result.selected_member_count = 1
    data.result.axis_comparisons = [{ axis: '2025', statistic: 'median', status: 'available', value: 1,
      min: 1, max: 1, selected_member_count: 1, eligible_count: 1, missing_count: 0,
      member_ranks: [{ territory_id: '53', rank: 1, rank_size: 1, rank_ties: 1 }], sources: [] }]
    vi.stubGlobal('fetch', serveRawComparison(data))
    await expect(reacquireOrderedSeriesComparison(regionInput)).rejects.toThrow()
  })
  it('un scope null hors région reste rejeté aussi (non-record)', async () => {
    vi.stubGlobal('fetch', serveWithMutation((data) => { data.scope = null }))
    let rejected: unknown
    try { await createOrderedSeriesSemanticSession().acquire(input) } catch (cause) { rejected = cause }
    expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
  })
})
