/**
 * #986 — demand gate for background acquisition.
 *
 * The shared semantic client (#985/#993) owns outcome correlation, per-item
 * caching, generation fences and the two-active-read HTTP bound. This module
 * decides WHICH work may start: the requested chapter's demand is critical and
 * never waits for background, a deferred chapter is read once after the first
 * useful chapter, and unrelated theme warming is idle — coalesced, capped, and
 * dropped the moment a new critical demand appears.
 */

export type DemandPriority = 'critical' | 'deferred' | 'idle'

/** One unit of background work: one semantic chapter pass or one theme warm. */
export interface DemandUnit {
  /** Coalescing identity. Two pending units with the same key run once. */
  key: string
  priority: Exclude<DemandPriority, 'critical'>
  run: () => Promise<unknown>
}

export interface DemandSnapshot {
  running: string | null
  queued: string[]
  idleUnlocked: boolean
  idleUsed: number
  idleBudget: number
}

export interface DemandSchedulerOptions {
  /** Unrelated-theme warming batch budget (#986: at most five coalesced batches). */
  maxIdleUnits?: number
}

const DEFAULT_MAX_IDLE_UNITS = 5

/**
 * A single sequential drain. Critical work is not queued here at all: callers
 * run it directly and call `critical()` so queued background stops competing.
 */
export class AcquisitionDemandScheduler {
  private readonly queue: DemandUnit[] = []
  private current: DemandUnit | null = null
  private running = false
  private idleUnlocked = false
  private idleUsed = 0
  private currentGeneration = 0
  private readonly maxIdleUnits: number

  constructor(options: DemandSchedulerOptions = {}) {
    this.maxIdleUnits = options.maxIdleUnits ?? DEFAULT_MAX_IDLE_UNITS
  }

  /** Bumped by `reset()`; a caller fences a settled unit against this value. */
  get generation(): number { return this.currentGeneration }

  /** The first useful requested chapter is rendered: background work may begin. */
  unlockIdle(): void {
    this.idleUnlocked = true
    this.schedule()
  }

  /**
   * A critical demand started for the requested chapter. Every queued idle unit
   * is dropped (never started behind the reader's critical need) and the gate
   * closes until the next useful chapter is rendered.
   */
  critical(): number {
    this.idleUnlocked = false
    const before = this.queue.length
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]!.priority === 'idle') this.queue.splice(index, 1)
    }
    return before - this.queue.length
  }

  /**
   * Route/theme/territory change: drop every queued background unit, reset the
   * idle budget and bump the generation so a running unit's result is fenced.
   */
  reset(): number {
    const dropped = this.queue.length
    this.queue.length = 0
    this.idleUnlocked = false
    this.idleUsed = 0
    this.currentGeneration += 1
    return dropped
  }

  enqueue(unit: DemandUnit): boolean {
    if (unit.priority === 'idle') {
      if (!this.idleUnlocked) return false
      if (this.idleUsed >= this.maxIdleUnits) return false
      if (this.current?.key === unit.key) return false
      if (this.queue.some((queued) => queued.key === unit.key)) return false
      this.idleUsed += 1
    } else {
      if (!this.idleUnlocked) return false
      if (this.current?.key === unit.key || this.queue.some((queued) => queued.key === unit.key)) {
        return false
      }
    }
    this.queue.push(unit)
    this.schedule()
    return true
  }

  snapshot(): DemandSnapshot {
    return {
      running: this.current?.key ?? null,
      queued: this.queue.map((unit) => unit.key),
      idleUnlocked: this.idleUnlocked,
      idleUsed: this.idleUsed,
      idleBudget: this.maxIdleUnits,
    }
  }

  private drainScheduled = false

  /**
   * Priority is only meaningful inside one turn: enqueues from the same tick
   * are collected first, so a deferred chapter enqueued after an unrelated
   * theme still runs first and a critical demand can drop a not-yet-started
   * idle unit.
   */
  private schedule(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      this.drain()
    })
  }

  private drain(): void {
    if (this.running) return
    const next = this.next()
    if (!next) return
    this.running = true
    this.current = next
    void next.run().catch(() => undefined).finally(() => {
      this.running = false
      this.current = null
      this.schedule()
    })
  }

  private next(): DemandUnit | undefined {
    const deferred = this.queue.findIndex((unit) => unit.priority === 'deferred')
    if (deferred >= 0) return this.queue.splice(deferred, 1)[0]
    if (!this.idleUnlocked) return undefined
    return this.queue.shift()
  }
}
