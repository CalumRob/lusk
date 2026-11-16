import { computed, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { AcquisitionDemandScheduler } from '@/payload/acquisitionDemand'
import type { ChapitreDemandStatus } from './content/demandInventory'

/** Registered presentation order + acquisition capability, not producer facts. */
export interface CahierChapter {
  key: string
  /** Safe default: demand-only, even if the chapter has numerical indicators. */
  prefetch?: 'ordinary'
  /** Optional companion demand for a chapter with its own specialised reader. */
  demandChapter?: string
}

interface CahierLoadingOptions<Scope, Result> {
  chapters: Readonly<Ref<readonly CahierChapter[]>>
  /** Actual page intent from the navigation owner; no DOM/hash ownership here. */
  current: Readonly<Ref<string | null | undefined>>
  /** Stable scope includes territory/theme/selection/publication identity. */
  scope: Readonly<Ref<Scope | null>>
  scheduler: AcquisitionDemandScheduler
  /** Existing cache adapter owns coalescing, deadlines, missing items and bounds. */
  read: (scope: Scope, chapter: string, priority: 'critical' | 'background') => Promise<Result>
  apply: (result: Result, scope: Scope) => void
  reset?: (scope: Scope | null, previous: Scope | null | undefined) => void
  useful?: (scope: Scope) => void
}

/** Chapter admission only. No request engine, cache, navigation or numerical policy. */
export function useCahierLoading<Scope, Result>(options: CahierLoadingOptions<Scope, Result>) {
  const statuses = ref<Record<string, ChapitreDemandStatus>>({})
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const retryCount = ref(0)
  const current = computed(() => options.chapters.value.find((chapter) =>
    chapter.key === options.current.value)?.key ?? options.chapters.value[0]?.key)
  const requested = computed(() => {
    const chapter = options.chapters.value.find((chapter) => chapter.key === current.value)
    return chapter?.demandChapter ?? chapter?.key
  })
  let epoch = 0
  let disposed = false
  onScopeDispose(() => { disposed = true; epoch += 1 })
  function setStatus(chapter: string, value: ChapitreDemandStatus): void {
    statuses.value = { ...statuses.value, [chapter]: value }
  }

  function warmNext(): void {
    const scope = options.scope.value
    const displayed = current.value
    if (disposed || scope === null || displayed !== requested.value ||
        !displayed || statuses.value[displayed] !== 'ready') return
    const index = options.chapters.value.findIndex((chapter) => chapter.key === displayed)
    const next = options.chapters.value[index + 1]
    // Immediate neighbour only: never skip a heavy/demand-only page.
    if (next?.prefetch !== 'ordinary') return
    const generation = options.scheduler.generation
    options.scheduler.enqueue({ key: `chapter:${next.key}`, priority: 'deferred', run: async () => {
      if (disposed || scope !== options.scope.value || current.value !== displayed ||
          generation !== options.scheduler.generation) return
      // Deliberately no apply/status/useful callback: a warm never chains.
      await options.read(scope, next.demandChapter ?? next.key, 'background').catch(() => undefined)
    } })
  }

  watch([options.scope, requested, retryCount], async ([scope, chapter], previous, onCleanup) => {
    const request = ++epoch
    let cancelled = false
    onCleanup(() => { cancelled = true })
    if (scope !== previous?.[0]) {
      statuses.value = {}
      status.value = 'loading'
      options.scheduler.reset()
      options.reset?.(scope, previous?.[0])
    }
    if (scope === null || !chapter) return
    options.scheduler.critical()
    if (status.value !== 'ready') status.value = 'loading'
    setStatus(chapter, 'loading')
    try {
      const result = await options.read(scope, chapter, 'critical')
      if (cancelled || request !== epoch || scope !== options.scope.value) return
      options.apply(result, scope)
      if (disposed) return
      setStatus(chapter, 'ready')
      status.value = 'ready'
      options.scheduler.unlockIdle()
      warmNext()
      options.useful?.(scope)
    } catch {
      if (cancelled || request !== epoch || scope !== options.scope.value) return
      setStatus(chapter, 'error')
      // An initial failure has ONE page-level recovery surface. A later failure
      // retains useful data and belongs only to the requested chapter's alert.
      if (status.value !== 'ready') status.value = 'error'
    }
  }, { immediate: true })
  // Display can change while its companion demand stays the same.
  watch([current, statuses], warmNext)

  function retry(chapter: string): void {
    if (chapter !== current.value || chapter !== requested.value ||
        statuses.value[chapter] !== 'error') return
    retryCount.value += 1
  }
  return { current, requested, statuses, status, retry }
}
