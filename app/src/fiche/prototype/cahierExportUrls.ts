/**
 * Public URL policy for Cahier exports: use the current environment's origin
 * (so a preview PDF links back to that preview) and forward its query string.
 * No deployment hostname is hardcoded here.
 */
export function urlAccueilDepuisEnvironnement(): string | null {
  const location = globalThis.location
  return location ? new URL('/', location.origin).href : null
}

export function urlPubliqueDepuisEnvironnement(capture: {
  identity: { territory: { type: string; code: string } }
}, hash: string): string | null {
  const location = globalThis.location
  if (!location) return null
  const url = new URL(`/territoire/${capture.identity.territory.type}/${capture.identity.territory.code}`, location.origin)
  for (const [key, value] of new URLSearchParams(location.search)) url.searchParams.set(key, value)
  url.hash = hash
  return url.href
}
