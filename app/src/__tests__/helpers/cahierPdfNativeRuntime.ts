/**
 * Real-browser execution of the shared native Vue -> DOM-paint composer.
 *
 * happy-dom has no layout, so a browser's resolved boxes cannot exist there.
 * This helper talks to one child Node process (cahierPdfNativeServer.mjs),
 * started once per `test:browser` run by browser/globalSetup.ts, that keeps one
 * headless Chromium and one in-memory Vite bundle of the production seam. There is no second PDF template and no hand-built figure painter: the
 * Vue section layout is the only figure input. The synthetic 2x2 PNG used for
 * captured map geometry is TEST-ONLY, never a published map or an approval
 * artifact.
 */
import { request as httpRequest } from 'node:http'
import { inject } from 'vitest'
import type { CahierExportRequest } from '../../fiche/prototype/cahierExportCapture'
import type { CahierPdfArtifact } from '../../fiche/prototype/cahierPdfExportController'
import type { OptionsCompositionCahierPdf } from '../../fiche/prototype/cahierPdfComposer'

class NativeComposerError extends Error {
  readonly code?: string
  readonly reason?: string
  readonly name: string
  constructor(shape: { name?: string; code?: string; reason?: string; message?: string; cause?: string }) {
    super(`${shape.message ?? 'native composer failure'}${shape.cause ? ` (cause: ${shape.cause})` : ''}`)
    this.name = shape.name ?? 'Error'
    this.code = shape.code ?? shape.reason
    this.reason = shape.reason
  }
}

/**
 * One round trip to the harness started once per run by browser/globalSetup.ts
 * (the `browser` Vitest project). A spec file never starts a browser or a build.
 */
async function appeler<T extends object>(payload: object): Promise<T> {
  // node:http, not fetch: the shared test setup stubs global fetch (fail closed).
  const text = await new Promise<string>((resolve, reject) => {
    const request = httpRequest(inject('nativePdfBridge'), { method: 'POST' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end(JSON.stringify(payload))
  })
  const result = JSON.parse(text) as T & { error?: ConstructorParameters<typeof NativeComposerError>[0] }
  if (result.error) throw new NativeComposerError(result.error)
  return result
}

/** Render generated PDF bytes to a PNG via the same browser (visual inspection). */
export async function rendrePngNatif(bytes: Uint8Array, scale = 1.7, pageNumber = 1): Promise<Buffer> {
  const { png } = await appeler<{ png?: string }>({ kind: 'render', bytes: Array.from(bytes), scale, pageNumber })
  if (!png) throw new Error('No PNG returned')
  return Buffer.from(png, 'base64')
}
/** Structural transfer of frozen ArrayBuffers across the JSON harness line. */
function transfertRequest(request: CahierExportRequest) {
  const clone: any = structuredClone(request)
  for (const item of clone.capture.capabilities.maps.items) {
    if (item.bytes instanceof ArrayBuffer) {
      item.bytes = { __luskBytes: Array.from(new Uint8Array(item.bytes)) }
    }
  }
  return clone
}

/** Generate a real PDF through the native path, returning the artifact bytes. */
export async function composerCahierPdfNativedansNavigateur(
  request: CahierExportRequest,
  options: Pick<OptionsCompositionCahierPdf, 'signal' | 'urlAccueil' | 'urlPublique'>,
): Promise<CahierPdfArtifact> {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const result = await appeler<{ bytes?: number[]; fileName?: string }>({
    request: transfertRequest(request),
    options: { urlAccueil: options.urlAccueil ?? null, urlPublique: options.urlPublique ?? null },
  })
  if (!result.bytes?.length) throw new Error('Empty native PDF')
  return { blob: new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }),
    fileName: result.fileName ?? 'native-section.pdf' }
}
