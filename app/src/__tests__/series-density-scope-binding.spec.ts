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

describe('invariants de rang exactes au seam (#892)', () => {
  async function acquireFixedCommune(mutate?: (data: Record<string, any>) => void) {
    vi.stubGlobal('fetch', serveWithMutation(mutate))
    try {
      return { read: await createOrderedSeriesSemanticSession().acquire(input) as any, rejected: undefined as unknown }
    } catch (cause) {
      return { read: undefined as any, rejected: cause }
    }
  }

  it('density_class : un ID de rang d’une AUTRE classe (même compte, dans la cohorte résolue) est rejeté', async () => {
    // 22002 est dans la cohorte résolue (faits) mais classe 5, pas la classe 7 du focal 22001
    expect(territories.find((t) => t.territoire === '22002')!.classe_densite_code)
      .not.toBe(focal.classe_densite_code)
    const { read, rejected } = await acquireFixedCommune((data) => {
      const axe = data.result.axis_comparisons.find((a: any) => a.member_ranks.length > 1)
      axe.member_ranks[0] = { ...axe.member_ranks[0], territory_id: '22002' }
    })
    expect(read).toBeUndefined()
    expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
  })

  it('density_class : la cohorte exacte = membres de la classe du focal (sous-ensemble éligible valide admis)', async () => {
    const { read, rejected } = await acquireFixedCommune()
    expect(rejected).toBeUndefined()
    const scope = read.comparison?.scope
    expect(scope?.kind).toBe('density_class')
    // chaque rang publié appartient à la classe du focal (résolue via la référence validée)
    const classe = new Map(territories.map((t) => [t.territoire, t.classe_densite_code ?? null]))
    for (const axe of read.comparison?.axis_comparisons ?? []) {
      for (const rang of axe.member_ranks) {
        expect(classe.get(rang.territory_id), `${rang.territory_id} hors classe`).toBe(scope.density_class_code)
      }
      expect(axe.selected_member_count).toBe(scope.member_count)
    }
  })

  it('seuil available/unavailable exact par axe : unavailable avec >= 2 éligibles est rejeté', async () => {
    const { rejected } = await acquireFixedCommune((data) => {
      const axe = data.result.axis_comparisons.find((a: any) => a.status === 'available')
      axe.status = 'unavailable'
      axe.value = null; axe.min = null; axe.max = null
      // eligible_count >= 2 conservé : incohérent avec unavailable (producteur : available = eligible >= 2)
      expect(axe.eligible_count).toBeGreaterThanOrEqual(2)
      axe.member_ranks = axe.member_ranks.map((r: any) => ({ territory_id: r.territory_id, rank: null, rank_size: null, rank_ties: null }))
    })
    expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
  })

  it('seuil : available avec < 2 éligibles est rejeté ; unavailable avec 0/1 éligibles est admis', async () => {
    const { rejected: rejete } = await acquireFixedCommune((data) => {
      const axe = data.result.axis_comparisons.find((a: any) => a.status === 'available')
      axe.eligible_count = 1
      axe.missing_count = axe.selected_member_count - 1
      // rankedCount doit suivre l'éligibilité : un seul rang porté
      const mesures = axe.member_ranks.map((r: any, i: number) => i === 0 ? r : { ...r, rank: null, rank_size: null, rank_ties: null })
      axe.member_ranks = mesures
    })
    expect(rejete).toBeInstanceOf(SeriesComparisonRejectedError)

    const { read, rejected } = await acquireFixedCommune((data) => {
      const axe = data.result.axis_comparisons.find((a: any) => a.status === 'available')
      axe.status = 'unavailable'
      axe.value = null; axe.min = null; axe.max = null
      axe.eligible_count = 1
      axe.missing_count = axe.selected_member_count - 1
      axe.member_ranks = axe.member_ranks.map((r: any) => ({ territory_id: r.territory_id, rank: null, rank_size: null, rank_ties: null }))
    })
    expect(rejected).toBeUndefined()
    expect(read.comparison?.axis_comparisons.some((a: any) => a.status === 'unavailable' && a.eligible_count === 1)).toBe(true)
  })

  it('écho de sélection : doublon [A,…,A] rejeté même à longueur égale', async () => {
    vi.stubGlobal('fetch', serveWithMutation((data) => {
      const s = data.selection as any[]
      s[s.length - 1] = { ...s[0] } // doublon du premier, dernier perdu : même longueur
    }))
    let rejected: unknown
    try {
      await createOrderedSeriesSemanticSession().acquire({ ...input, departmentId: '22' })
    } catch (cause) { rejected = cause }
    expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
  })

  it('écho de sélection : membre remplacé par un étranger (même longueur) rejeté', async () => {
    vi.stubGlobal('fetch', serveWithMutation((data) => {
      const s = data.selection as any[]
      s[0] = { territory_type: 'commune', territory_id: '29001' } // hors département 22 demandé
    }))
    let rejected: unknown
    try {
      await createOrderedSeriesSemanticSession().acquire({ ...input, departmentId: '22' })
    } catch (cause) { rejected = cause }
    expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
  })

  it('écho de sélection valide (ensemble exact, ordre quelconque) admis', async () => {
    vi.stubGlobal('fetch', serveWithMutation((data) => {
      const s = data.selection as any[]
      data.selection = [...s].reverse() // ordre différent, même ensemble
    }))
    const read = await createOrderedSeriesSemanticSession().acquire({ ...input, departmentId: '22' })
    expect(read.comparison?.scope?.kind).toBe('explicit_selection')
  })
})

describe('identité d’axe, tuple de rang, repli de résumé (#892)', () => {
  async function acquirePrix(mutate?: (data: Record<string, any>) => void) {
    vi.stubGlobal('fetch', serveWithMutation(mutate))
    try {
      return { read: await createOrderedSeriesSemanticSession().acquire(input) as any, rejected: undefined as unknown }
    } catch (cause) {
      return { read: undefined as any, rejected: cause }
    }
  }
  const premierAxe = (data: Record<string, any>) =>
    data.result.axis_comparisons.find((a: any) => a.status === 'available' && a.member_ranks.length > 0)

  it('axe manquant, invalide, dupliqué ou non déclaré : rejeté', async () => {
    for (const [label, mutate] of [
      ['axe absent', (data: any) => { delete premierAxe(data).axis }],
      ['axe non texte', (data: any) => { premierAxe(data).axis = 2025 }],
      ['axe dupliqué', (data: any) => { data.result.axis_comparisons.push({ ...premierAxe(data) }) }],
      ['axe non déclaré (1999)', (data: any) => { premierAxe(data).axis = '1999' }],
    ] as const) {
      const { read, rejected } = await acquirePrix(mutate)
      expect(read, label).toBeUndefined()
      expect(rejected, label).toBeInstanceOf(SeriesComparisonRejectedError)
    }
  })

  it('couverture clairsemée valide : un axe publié unavailable (0 éligible) reste admis', async () => {
    const { read, rejected } = await acquirePrix((data) => {
      const axe = data.result.axis_comparisons.find((a: any) => a.status === 'available')
      axe.status = 'unavailable'
      axe.value = null; axe.min = null; axe.max = null
      axe.eligible_count = 0
      axe.missing_count = axe.selected_member_count
      axe.member_ranks = axe.member_ranks.map((r: any) => ({ territory_id: r.territory_id, rank: null, rank_size: null, rank_ties: null }))
    })
    expect(rejected).toBeUndefined()
    expect(read.comparison.axis_comparisons.some((a: any) => a.status === 'unavailable' && a.eligible_count === 0)).toBe(true)
  })

  it('tuple de rang all-or-nothing : rank null avec size/ties renseignés est rejeté', async () => {
    for (const [label, patch] of [
      ['rank_size renseigné', (r: any) => ({ ...r, rank: null, rank_size: r.rank_size ?? 3, rank_ties: null })],
      ['rank_ties renseigné', (r: any) => ({ ...r, rank: null, rank_size: null, rank_ties: r.rank_ties ?? 1 })],
    ] as const) {
      const { read, rejected } = await acquirePrix((data) => {
        const axe = premierAxe(data)
        axe.member_ranks[0] = patch(axe.member_ranks[0])
      })
      expect(read, label).toBeUndefined()
      expect(rejected, label).toBeInstanceOf(SeriesComparisonRejectedError)
    }
  })

  it('tuple valide : membre non mesuré all-null admis, membre classé all-renseigné admis', async () => {
    const { read, rejected } = await acquirePrix()
    expect(rejected).toBeUndefined()
    for (const axe of read.comparison.axis_comparisons) {
      for (const rang of axe.member_ranks) {
        const valeurs = [rang.rank, rang.rank_size, rang.rank_ties]
        expect(valeurs.every((v) => v === null) || valeurs.every((v) => v !== null), 'tuple all-or-nothing').toBe(true)
      }
    }
  })

  it('résumé fixe : point déclaré publié -> point conservé (prix_m2 2025)', async () => {
    const { read, rejected } = await acquirePrix()
    expect(rejected).toBeUndefined()
    expect(read.comparison.point).toBe('2025')
  })

  it('résumé fixe OCS-GE : point déclaré 2025 non publié -> repli dernier axe publié (M3), valeur/rang de M3', async () => {
    // artif_par_habitant : axes publiés = états M2/M3, point déclaré = 2025
    const artifInput = { resource: 'artif_par_habitant', level: 'commune' as const, focal, territories }
    vi.stubGlobal('fetch', serveWithMutation())
    const read = await createOrderedSeriesSemanticSession().acquire(artifInput)
    const axes = read.comparison?.axis_comparisons?.map((a: any) => a.axis)
    expect(axes).toEqual(['M2', 'M3'])
    // repli producteur (snapshot_reads.py:1707-1713) : point effectif = M3
    expect(read.comparison?.point).toBe('M3')
    const axeM3 = read.comparison?.axis_comparisons?.find((a: any) => a.axis === 'M3')
    expect(read.comparison?.value).toBe(axeM3?.value)
    const rangFocalM3 = axeM3?.member_ranks?.find((r: any) => r.territory_id === focal.territoire)
    expect(read.comparison?.rank).toBe(rangFocalM3?.rank ?? null)
    expect(read.comparison?.comparable_count).toBe(axeM3?.eligible_count)
  })
})
