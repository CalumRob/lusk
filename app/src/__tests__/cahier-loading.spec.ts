import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcquisitionDemandScheduler } from '@/payload/acquisitionDemand'
import { useCahierLoading } from '@/fiche/useCahierLoading'
import { acquireThemeFacts, ThemeAcquisitionCache } from '@/payload/themeAcquisition'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture } from './helpers/semanticApiFixtures'

afterEach(() => vi.unstubAllGlobals())

const chapters = [
  { key: 'population', prefetch: 'ordinary' as const },
  { key: 'households', prefetch: 'ordinary' as const },
  // Deliberately AFTER ordinary pages, with a real demand: never background.
  { key: 'address-explorer' },
  { key: 'history', prefetch: 'ordinary' as const },
]
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('registered cahier loading (non-Mobility fixture, not numerical producer evidence)', () => {
  it.each(['territory', 'selection', 'publication'])('fences a late old %s result and does not warm from it', async (change) => {
    const old = deferred<string>()
    const identity = ref('demographie/a/default/v1')
    const calls: string[] = []
    const applied: string[] = []
    const owner = effectScope()
    const loading = owner.run(() => useCahierLoading({
      chapters: ref(chapters), current: ref('population'), scope: identity,
      scheduler: new AcquisitionDemandScheduler(),
      read: async (key, chapter) => {
        calls.push(`${key}/${chapter}`)
        return key === 'demographie/a/default/v1' ? old.promise : `${key}/${chapter}`
      },
      apply: (value) => { applied.push(value) },
      reset: () => { applied.length = 0 },
    }))!
    await flushPromises()
    identity.value = { territory: 'demographie/b/default/v1', selection: 'demographie/a/custom/v1',
      publication: 'demographie/a/default/v2' }[change]!
    await flushPromises()
    expect(loading.status.value).toBe('ready')
    old.resolve('stale')
    await flushPromises()
    expect(applied).toEqual([`${identity.value}/population`])
    expect(calls).toEqual(['demographie/a/default/v1/population',
      `${identity.value}/population`, `${identity.value}/households`])
    owner.stop()
  })
  it('distinguishes initial failure, explicit retry pending, absence and later chapter-only failure', async () => {
    const retry = deferred<{ availability: string }>()
    const calls: string[] = []
    const applied: string[] = []
    const current = ref('population')
    const owner = effectScope()
    const loading = owner.run(() => useCahierLoading({
      chapters: ref(chapters.map(({ key }) => ({ key }))), current, scope: ref('demographie/a'),
      scheduler: new AcquisitionDemandScheduler(),
      read: async (_identity, chapter) => {
        calls.push(chapter)
        if (chapter !== 'population' || calls.length === 1) throw new Error('transport failed')
        return retry.promise
      },
      apply: (value) => { applied.push(value.availability) },
    }))!
    await flushPromises()
    expect(loading.status.value).toBe('error')
    expect(loading.statuses.value.population).toBe('error')
    expect(calls).toEqual(['population'])
    loading.retry('history')
    await flushPromises()
    expect(calls).toHaveLength(1)
    loading.retry('population')
    await flushPromises()
    expect(loading.status.value).toBe('loading')
    retry.resolve({ availability: 'publication_unavailable' })
    await flushPromises()
    expect(loading.status.value).toBe('ready')
    expect(applied).toEqual(['publication_unavailable'])
    loading.retry('population')
    await flushPromises()
    expect(calls).toHaveLength(2) // Absence is not a retryable transport error.
    current.value = 'households'
    await flushPromises()
    expect(loading.status.value).toBe('ready') // Retained page, no second global alert.
    expect(loading.statuses.value.households).toBe('error')
    loading.retry('population')
    loading.retry('households')
    await flushPromises()
    expect(calls).toEqual(['population', 'population', 'households', 'households'])
    expect(applied).toEqual(['publication_unavailable'])
    owner.stop()
  })
  it('joins an arriving reader to the live warm through the real theme cache and retains settled chapters', async () => {
    const warm = deferred<void>()
    const reads: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/resources') return nativeCatalogueResponse()
      const { items } = JSON.parse(String(init?.body))
      reads.push(...items.map((item: { resource: string }) => item.resource))
      if (items.some((item: { resource: string }) => item.resource === 'taille_menages')) await warm.promise
      return nativeBatchResponse(items, (item, resource) => nativeReadFixture(item, resource))
    })
    const cache = new ThemeAcquisitionCache((theme, key, demand) =>
      acquireThemeFacts(key!.type, key!.id, theme, demand))
    const demands: Record<string, string[]> = {
      population: ['densite'], households: ['taille_menages'],
      'address-explorer': ['structure_age'], history: ['evolution_1968'],
    }
    const current = ref('population')
    const applied: string[][] = []
    const owner = effectScope()
    const loading = owner.run(() => useCahierLoading({
      chapters: ref(chapters), current, scope: ref('35238'), scheduler: new AcquisitionDemandScheduler(),
      read: (id, chapter, priority) => cache.get('commune', id, 'demographie', {
        indicators: demands[chapter], selection: null, priority,
      }),
      apply: (entry) => { applied.push(entry.focal.resource_reads?.map((read) => read.resource) ?? []) },
    }))!
    await flushPromises()
    expect(reads).toEqual(['densite', 'taille_menages'])
    expect(applied).toEqual([['densite']])
    current.value = 'households'
    await flushPromises()
    expect(loading.statuses.value.households).toBe('loading')
    expect(applied).toEqual([['densite']])
    warm.resolve()
    await flushPromises()
    expect(reads).toEqual(['densite', 'taille_menages'])
    expect(applied.at(-1)).toEqual(['densite', 'taille_menages'])
    current.value = 'address-explorer'
    await flushPromises()
    expect(reads).toEqual(['densite', 'taille_menages', 'structure_age', 'evolution_1968'])
    expect(applied.at(-1)).not.toContain('evolution_1968')
    current.value = 'history'
    await flushPromises()
    current.value = 'population'
    await flushPromises()
    expect(reads).toHaveLength(4)
    expect(applied.at(-1)).toContain('structure_age')
    owner.stop()
  })
  it('does not start queued chapter warming after its owner is disposed', async () => {
    const calls: string[] = []
    const scope = effectScope()
    scope.run(() => useCahierLoading({
      chapters: ref(chapters), current: ref('population'), scope: ref('demographie/a'),
      scheduler: new AcquisitionDemandScheduler(),
      read: async (_identity, chapter) => { calls.push(chapter); return chapter },
      apply: () => { scope.stop() },
    }))
    await flushPromises()
    expect(calls).toEqual(['population'])
  })
  it('admits the initial page, then only its immediate eligible neighbour after usefulness', async () => {
    const initial = deferred<string>()
    const calls: string[] = []
    const applied: string[] = []
    const scope = effectScope()
    const current = ref<string | null>('obsolete-section')
    const loading = scope.run(() => useCahierLoading({
      chapters: ref(chapters), current, scope: ref('demographie/commune/a/v1'),
      scheduler: new AcquisitionDemandScheduler(),
      read: async (_identity, chapter, priority) => {
        calls.push(`${chapter}:${priority}`)
        return chapter === 'population' ? initial.promise : chapter
      },
      apply: (value) => { applied.push(value) },
    }))!
    await flushPromises()
    expect(loading.current.value).toBe('population')
    expect(calls).toEqual(['population:critical'])
    expect(loading.statuses.value.population).toBe('loading')
    initial.resolve('population')
    await flushPromises()
    expect(calls).toEqual(['population:critical', 'households:background'])
    expect(applied).toEqual(['population'])
    // Warming is cache-only and cannot recursively warm even a fourth page.
    current.value = 'households'
    await nextTick(); await flushPromises()
    expect(applied).toEqual(['population', 'households'])
    expect(calls).not.toContain('address-explorer:background')
    expect(calls).not.toContain('history:background')
    scope.stop()
  })
})
