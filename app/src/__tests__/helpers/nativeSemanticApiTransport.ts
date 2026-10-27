import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture } from './semanticApiFixtures'

/** Opt-in, bounded semantic API responses for tests that need a healthy server. */
export function createNativeSemanticApiTransport(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    const presentation = url.match(/^\/data\/(theme_[a-z]+\.json)$/u)
    if (presentation) {
      try {
        const file = resolve(process.cwd(), '../public/data', presentation[1]!)
        return new Response(readFileSync(file, 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } })
      } catch {
        return new Response('', { status: 404 })
      }
    }
    if (url === '/api/resources/read-batch') {
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, nativeReadFixture)
    }
    return new Response('', { status: 404 })
  }
}
