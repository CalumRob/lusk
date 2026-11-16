/**
 * Test-only browser entry for the bounded PDF harness (#1024).
 *
 * It is built into a temporary static page by `verify-cahier-pdf-browser.mjs`;
 * it is never imported by the app and never ships in production.
 */
import { composerCahierPdf } from '../src/fiche/prototype/cahierPdfComposer'
import { projeterRequeteExport } from '../src/fiche/prototype/cahierExportCapture'
import { capturePdfFixture, PDF_FIXTURE_SECTION_KEYS } from '../src/__tests__/helpers/cahierPdfFixtures'
import {
  captureBarresDense,
  captureCourbeDense,
  capturePartDense,
  captureRampeDense,
  captureWaffleDense,
} from '../src/__tests__/helpers/cahierPdfFixtures'
import type { PdfFixtureSectionKey } from '../src/__tests__/helpers/cahierPdfFixtures'

const capturesDenses: Record<string, ReturnType<typeof captureCourbeDense>> = {
  'dense-curve': captureCourbeDense(),
  'dense-share': capturePartDense(),
  'dense-ramp': captureRampeDense(),
  'dense-bars': captureBarresDense(),
  'dense-waffle': captureWaffleDense(),
}

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGNMmXbiPwMDAwMTiABhACnkAsXTOyC6AAAAAElFTkSuQmCC'

;(window as unknown as {
  genererCahierPdf: (key: string) => Promise<{ fileName: string; bytes: number[]; ms: number; heap?: number }>
  clesPdfCahier: readonly PdfFixtureSectionKey[]
}).genererCahierPdf = async (key) => {
  const memoire = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
  const capture = capturesDenses[key] ?? capturePdfFixture(key as PdfFixtureSectionKey)
  const modes = capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(projection.reason)
  const debut = performance.now()
  const artifact = await composerCahierPdf(projection.request, {
    signal: new AbortController().signal,
    chargerImage: async () => ({ dataUrl: PNG, width: 2, height: 2 }),
    urlPublique: `https://lusk.test/territoire/commune/22001?theme=mobilite#section-${key}`,
    urlAccueil: 'https://lusk.test/',
  })
  return {
    fileName: artifact.fileName,
    bytes: [...new Uint8Array(await artifact.blob.arrayBuffer())],
    ms: performance.now() - debut,
    heap: memoire,
  }
}
;(window as unknown as { clesPdfCahier: readonly PdfFixtureSectionKey[] }).clesPdfCahier = PDF_FIXTURE_SECTION_KEYS

export { PDF_FIXTURE_SECTION_KEYS }
