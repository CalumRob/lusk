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
