import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture } from './semanticApiFixtures'

/** Opt-in, bounded semantic API responses for tests that need a healthy server. */
export function createNativeSemanticApiTransport(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, nativeReadFixture)
    }
    return new Response('', { status: 404 })
  }
}
