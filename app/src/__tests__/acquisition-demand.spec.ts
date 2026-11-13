import { describe, expect, it, vi } from 'vitest'

import { AcquisitionDemandScheduler } from '@/payload/acquisitionDemand'

/**
 * #986 — the demand gate for work that is NOT the requested chapter. The shared
 * semantic client already bounds the HTTP concurrency; this scheduler only
 * decides which background work may start, and keeps it behind the critical
 * demand of the requested chapter.
 */

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('AcquisitionDemandScheduler', () => {
  it('refuses background work before the first useful requested chapter', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AcquisitionDemandScheduler()
    expect(scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run })).toBe(false)
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(scheduler.snapshot()).toMatchObject({ queued: [], idleUnlocked: false })
  })

  it('runs deferred chapter demand before idle theme warming, one unit at a time', async () => {
    const order: string[] = []
    const scheduler = new AcquisitionDemandScheduler()
    scheduler.unlockIdle()
    scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run: async () => { order.push('habitat') } })
    scheduler.enqueue({ key: 'chapter:offre-transports-commun', priority: 'deferred',
      run: async () => { order.push('chapter') } })
    await settle()
    expect(order).toEqual(['chapter', 'habitat'])
  })

  it('coalesces an identical pending unit instead of running it twice', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AcquisitionDemandScheduler()
    scheduler.unlockIdle()
    expect(scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run })).toBe(true)
    expect(scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run })).toBe(false)
    await settle()
    expect(run).toHaveBeenCalledTimes(1)
    expect(scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run })).toBe(true)
  })

  it('drops every queued idle unit when the critical demand appears, and re-closes the gate', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AcquisitionDemandScheduler()
    scheduler.unlockIdle()
    scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run })
    scheduler.enqueue({ key: 'chapter:offre', priority: 'deferred', run })
    expect(scheduler.critical()).toBe(1)
    await settle()
    // The deferred chapter is not competing background: it survives one
    // preemption, the unrelated theme warming does not.
    expect(run).toHaveBeenCalledTimes(1)
    expect(scheduler.snapshot().idleUnlocked).toBe(false)
    expect(scheduler.enqueue({ key: 'theme:milieux', priority: 'idle', run })).toBe(false)
  })

  it('caps unrelated idle warming at the documented budget', async () => {
    const scheduler = new AcquisitionDemandScheduler({ maxIdleUnits: 5 })
    scheduler.unlockIdle()
    const results = Array.from({ length: 6 }, (_, index) =>
      scheduler.enqueue({ key: `theme:${index}`, priority: 'idle', run: async () => undefined }))
    expect(results).toEqual([true, true, true, true, true, false])
    await settle()
    expect(scheduler.snapshot()).toMatchObject({ idleUsed: 5, idleUnlocked: true })
  })

  it('fences a running background unit when the route/theme/territory changes', async () => {
    let release!: () => void
    const applied: number[] = []
    const scheduler = new AcquisitionDemandScheduler()
    scheduler.unlockIdle()
    const generation = scheduler.generation
    scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run: async () => {
      await new Promise<void>((resolve) => { release = resolve })
      if (scheduler.generation === generation) applied.push(1)
    } })
    scheduler.enqueue({ key: 'theme:milieux', priority: 'idle', run: async () => { applied.push(2) } })
    await settle()
    expect(scheduler.reset()).toBe(1)
    release()
    await settle()
    expect(applied).toEqual([])
    expect(scheduler.snapshot()).toMatchObject({ queued: [], idleUsed: 0, idleUnlocked: false })
  })

  it('keeps draining after a background unit fails', async () => {
    const ok = vi.fn(async () => undefined)
    const scheduler = new AcquisitionDemandScheduler()
    scheduler.unlockIdle()
    scheduler.enqueue({ key: 'theme:broken', priority: 'idle', run: async () => { throw new Error('boom') } })
    scheduler.enqueue({ key: 'theme:habitat', priority: 'idle', run: ok })
    await settle()
    for (let index = 0; index < 6; index += 1) await settle()
    expect(ok).toHaveBeenCalledTimes(1)
  })
})
