import { afterEach, expect, it, vi } from 'vitest'
import { acquireThemeFacts, ThemeAcquisitionCache } from '@/payload/themeAcquisition'
import capture from './fixtures/mobility-cross-level-served.json'
import { nativeCatalogueResponse } from './helpers/semanticApiFixtures'

afterEach(() => vi.unstubAllGlobals())

it.each([['epci', '243500725'], ['departement', '35']])(
  'retains native %s default comparisons when a later chapter extends the facts cache', async (type, id) => {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url) === '/api/resources') return nativeCatalogueResponse()
      const { items } = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v2', results: items.map((item: any) => {
        const found = capture.entries.find(({ item: saved }) => saved.resource === item.resource &&
          JSON.stringify(saved.target) === JSON.stringify(item.target) &&
          JSON.stringify(saved.intent) === JSON.stringify(item.intent) &&
          JSON.stringify(saved.coordinates) === JSON.stringify(item.coordinates))
        if (!found) throw new Error(`Uncaptured native read ${JSON.stringify(item)}`)
        return { id: item.id, resource: item.resource, status: 'available', data: found.data }
      }) }))
    }))
    const cache = new ThemeAcquisitionCache((theme, key, demand) =>
      acquireThemeFacts(key!.type, key!.id, theme, demand))
    const page2 = { indicators: ['reseaux_par_habitant'], auxiliary: false }
    const page3 = { indicators: ['offre_tc'], auxiliary: false }
    const first = await cache.get(type!, id!, 'mobilite', page2)
    const firstReads = first.comparisons.get('omitted')!.comparison_reads!
    expect(firstReads, JSON.stringify(first.focal)).toHaveLength(3)
    const later = await cache.get(type!, id!, 'mobilite', page3)
    const reads = later.comparisons.get('omitted')!.comparison_reads!
    expect(reads.map(read => read.resource)).toContain('offre_tc')
    expect(reads.filter(read => read.resource === 'reseaux_par_habitant')).toEqual(firstReads)
    const coverage = reads.find(read => read.resource === 'offre_tc')!.data as any
    expect(coverage.scope).toMatchObject({ kind: 'same_level', territory_type: type })
    expect(coverage.result.status).toBe('available')
    expect(coverage.result.median).toBe(type === 'epci' ? 0.44458717739110126 : 0.5653743245748843)
    expect((await cache.get(type!, id!, 'mobilite', page2)).comparisons.get('omitted')).toEqual(later.comparisons.get('omitted'))
  })
