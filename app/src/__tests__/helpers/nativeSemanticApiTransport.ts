import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture } from './semanticApiFixtures'

export type NativeBatchObserver = (items: Array<Record<string, any>>, response: Record<string, any>) => void

/** Opt-in, bounded semantic API responses for tests that need a healthy server. */
export function createNativeSemanticApiTransport(observer?: NativeBatchObserver):
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
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
      const response = await nativeBatchResponse(body.items, nativeReadFixture)
      if (observer) {
        const wire = await response.clone().json() as Record<string, any>
        const byId = new Map((wire.results as Array<Record<string, any>>).map((result) => [result.id, result]))
        observer(body.items, { ...wire, results: body.items.map((item) => byId.get(item.id)) })
      }
      return response
    }
    return new Response('', { status: 404 })
  }
}
