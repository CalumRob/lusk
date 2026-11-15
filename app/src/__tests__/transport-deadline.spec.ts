import { afterEach, describe, expect, it, vi } from 'vitest'

import { TRANSPORT_DEADLINE_MS, withTransportDeadline } from '../payload/transportDeadline'

/**
 * #1012 — the one shared transport policy. The bootstrap GETs and the semantic
 * batches both rely on it, so its own guarantees are pinned here: the timer is
 * cleared on every path (including one that throws synchronously), the stalled
 * socket is aborted only on timeout, and the owner's typed error is what a
 * timeout surfaces.
 */
describe('shared transport deadline', () => {
  afterEach(() => { vi.useRealTimers() })

  it('clears its timer when the read settles', async () => {
    vi.useFakeTimers()
    await expect(withTransportDeadline(async () => 'ok', () => new Error('délai'))).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer when the read throws synchronously', async () => {
    vi.useFakeTimers()
    const failure = new Error('panne immédiate')
    const run = () => { throw failure }
    await expect(withTransportDeadline(run, () => new Error('délai'))).rejects.toBe(failure)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with the owner error, aborts the socket and clears the timer on timeout', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const failure = new Error('aucune réponse')
    const enAttente = withTransportDeadline(
      (deadlineSignal) => {
        signal = deadlineSignal
        return new Promise<string>(() => undefined)
      },
      () => failure,
    ).catch((cause: unknown) => cause)
    await vi.advanceTimersByTimeAsync(TRANSPORT_DEADLINE_MS)
    expect(await enAttente).toBe(failure)
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
