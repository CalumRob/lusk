/**
 * #1012 — the one bounded transport deadline for the app's own reads.
 *
 * The fiche's requested chapter, its comparisons and AEDAR all read through the
 * shared semantic batch client; its identity bootstrap (`/data/territoires.json`)
 * and its producer discovery (`/api/resources`) are plain critical GETs awaited
 * by every theme acquisition. Without a bound, a stalled response left the page
 * loading forever. The deadline starts when the request is DISPATCHED, covers
 * the body read as well as the headers, aborts the stalled socket and clears its
 * timer in `finally`. A timeout is a failed request — never a settled absence and
 * never an automatic retry; the caller's explicit retry is the one recovery.
 *
 * 45 s stays below the 60 s read timeout of the API proxy
 * (`api/deploy/nginx-api.conf`, `proxy_read_timeout`), so a stalled response
 * surfaces as the app's honest retryable failure rather than a gateway timeout.
 */
export const TRANSPORT_DEADLINE_MS = 45_000

/**
 * Run one HTTP-shaped read under the shared deadline. `deadlineError` builds the
 * caller-owned typed failure (a `PayloadError` for the bootstrap GETs, the
 * semantic client's own deadline error for a read batch), so each owner keeps
 * its existing error surface. The losing side of the race never becomes an
 * unhandled rejection.
 */
export async function withTransportDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deadlineError: () => Error,
  deadlineMs = TRANSPORT_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController()
  let expired = false
  let errorAtDeadline: Error | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true
      errorAtDeadline = deadlineError()
      reject(errorAtDeadline)
    }, deadlineMs)
  })
  try {
    const request = run(controller.signal)
    request.catch(() => undefined)
    return await Promise.race([request, deadline])
  } catch (error) {
    // A timeout is the owner's own failure even when the transport reports its
    // abort first.
    if (expired) throw errorAtDeadline ?? deadlineError()
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // Release the stalled socket; a late reply is never applied.
    if (expired) controller.abort()
  }
}
