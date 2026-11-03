import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOrderedSeriesSemanticSession, SeriesComparisonRejectedError } from '@/payload/seriesSemanticAcquisition'
import type { Territoire } from '@/payload/types'
import { nativeBatchResponse, nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'

afterEach(() => vi.unstubAllGlobals())

/**
 * Fail-closed de la portée density_class au seam de binding de la comparaison
 * (#892 recheck) : le producteur valide émet TOUJOURS territory_type 'commune'
 * + un density_class_code non vide égal à la classe du focal acquis
 * (api/snapshot_reads.py:160-171, api/theme-read-contract.md:103-104).
 * Toute réponse malformée (champ absent, code vide, mauvais type, code
 * différent) est rejetée — comparaison seule, faits admis, aucun rang.
 */

const territories = JSON.parse(
  readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8')) as Territoire[]
const focal = territories.find((territory) => territory.territoire === '22001' && territory.type === 'commune')!
const resource = nativeResources().find((candidate) => candidate.resource_id === 'prix_m2')!
const input = { resource: resource!.resource_id, level: 'commune' as const, focal, territories }

function serveWithScopeMutation(mutate?: (scope: Record<string, any>) => void) {
  return vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
    const { items } = JSON.parse(String(init?.body))
    return nativeBatchResponse(items, (item, declaration) => {
      const data = nativeReadFixture(item, declaration, { territories })
      if (mutate && item.intent?.kind !== 'facts' && data?.scope) mutate(data.scope)
      return data
    })
  })
}

describe('density_class comparison scope — fail-closed au seam de binding (#892)', () => {
  it('admet une portée density_class valide (les deux champs émis par le producteur)', async () => {
    vi.stubGlobal('fetch', serveWithScopeMutation())
    const read = await createOrderedSeriesSemanticSession().acquire(input)
    expect(read.comparison?.scope).toMatchObject({
      kind: 'density_class',
      density_class_code: focal.classe_densite_code,
      territory_type: 'commune',
    })
  })

  const corruptions: Array<[string, (scope: Record<string, any>) => void]> = [
    ['territory_type absent', (scope) => { delete scope.territory_type }],
    ['territory_type erroné (epci)', (scope) => { scope.territory_type = 'epci' }],
    ['density_class_code absent', (scope) => { delete scope.density_class_code }],
    ['density_class_code vide', (scope) => { scope.density_class_code = '' }],
    ['density_class_code différent du focal acquis', (scope) => { scope.density_class_code = '1' }],
  ]

  for (const [label, mutate] of corruptions) {
    it(`rejette la comparaison seule (faits admis, aucun rang) : ${label}`, async () => {
      vi.stubGlobal('fetch', serveWithScopeMutation(mutate))
      let rejected: unknown
      try {
        await createOrderedSeriesSemanticSession().acquire(input)
      } catch (cause) { rejected = cause }
      expect(rejected, label).toBeInstanceOf(SeriesComparisonRejectedError)
      // la levée elle-même prouve que la comparaison n'a jamais été admise
      // (aucun read retourné) ; les faits, eux, restent admis
      const admitted = (rejected as SeriesComparisonRejectedError).facts
      expect(admitted.scope_series.length, `${label}: les faits restent admis`).toBeGreaterThan(0)
      expect(admitted.territory.id, `${label}: le focal admis est conservé`).toBe(focal.territoire)
    })
  }
})

describe('matrice intent de requête -> scope.kind (#892 fail-closed)', () => {
  // Contrat producteur (api/snapshot_reads.py _comparison_cohort) :
  //   selected_comparison        -> explicit_selection
  //   fixed_comparison commune   -> density_class
  //   fixed_comparison epci/dept -> same_level
  const focalDept = territories.find((t) => t.territoire === '22' && t.type === 'departement')!
  const inputs: Record<string, any> = {
    fixedCommune: { resource: 'prix_m2', level: 'commune', focal, territories },
    selectedCommune: { resource: 'prix_m2', level: 'commune', focal, territories, departmentId: '22' },
    // branche same_level : fixed_comparison au niveau département (ressource
    // programmes, une seule vintage publiée au niveau département)
    fixedDepartement: { resource: 'subventions_annuelles', level: 'departement', focal: focalDept, territories },
  }
  // kind attendu par intent (contrat producteur _comparison_cohort)
  const expectedByInput: Record<string, string> = {
    fixedCommune: 'density_class',
    selectedCommune: 'explicit_selection',
    fixedDepartement: 'same_level',
  }

  async function acquireWith(nom: string, kindOverride?: string | null) {
    const mutate = kindOverride === undefined ? undefined
      : (scope: Record<string, any>) => {
        if (kindOverride === null) delete scope.kind
        else scope.kind = kindOverride
      }
    vi.stubGlobal('fetch', serveWithScopeMutation(mutate))
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
        const { read, rejected } = await acquireWith(nom, kind)
        expect(read, `kind ${kind} sur ${nom}`).toBeUndefined()
        expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
        expect((rejected as SeriesComparisonRejectedError).facts.scope_series.length).toBeGreaterThan(0)
      })
    }
    it(`${nom} : kind absent est rejeté`, async () => {
      const { rejected } = await acquireWith(nom, null)
      expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
    })
  }

  it('selected_comparison avec same_level ET sélection échoée ne passe plus (cas signalé)', async () => {
    const { rejected } = await acquireWith('selectedCommune', 'same_level')
    expect(rejected).toBeInstanceOf(SeriesComparisonRejectedError)
  })
})
