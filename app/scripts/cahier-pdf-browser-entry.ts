/**
 * Test-only browser entry for the bounded PDF harness (#1024).
 *
 * It is built into a temporary static page by `verify-cahier-pdf-browser.mjs`;
 * it is never imported by the app and never ships in production.
 */
import { composerCahierPdf } from '../src/fiche/prototype/cahierPdfComposer'
import '../src/styles/tokens.css'
import { CAHIER_COLOR_ROLES } from '../src/fiche/prototype/cahierColorRoles'
import { PALETTE_PDF } from '../src/fiche/prototype/cahierPdfPalette'
import { projeterRequeteExport } from '../src/fiche/prototype/cahierExportCapture'
import { capturePdfFixture, PDF_FIXTURE_SECTION_KEYS } from '../src/__tests__/helpers/cahierPdfFixtures'
import {
  captureBarresDense,
  captureCourbeDense,
  captureCourbeTrous,
  capturePartDense,
  captureRampeDense,
  captureWaffleDense,
} from '../src/__tests__/helpers/cahierPdfFixtures'
import type { PdfFixtureSectionKey } from '../src/__tests__/helpers/cahierPdfFixtures'

const capturesDenses: Record<string, ReturnType<typeof captureCourbeDense>> = {
  'dense-curve': captureCourbeDense(),
  'dense-curve-gaps': captureCourbeTrous(),
  'dense-share': capturePartDense(),
  'dense-ramp': captureRampeDense(),
  'populated-comparison': captureRampeDense(),
  'dense-bars': captureBarresDense(),
  'dense-waffle': captureWaffleDense(),
}

const assetPath = '/cahier-pdf-fixture-map.png'
const imageReceipt = { created: 0, closed: 0, width: 0, height: 0 }
;(window as any).__cahierImages = imageReceipt
let afterDecode: (() => void) | undefined

// Record the production decoder result for the harness receipt; the loader
// itself is untouched and still fetches the served asset.
const createBitmap = globalThis.createImageBitmap
if (typeof createBitmap === 'function') {
  globalThis.createImageBitmap = (async (...args: Parameters<typeof createBitmap>) => {
    const bitmap = await createBitmap(...args)
    imageReceipt.created += 1
    imageReceipt.width = bitmap.width
    imageReceipt.height = bitmap.height
    const close = bitmap.close.bind(bitmap)
    bitmap.close = () => { imageReceipt.closed += 1; close() }
    ;(window as unknown as { __cahierDerniereImage?: { width: number; height: number } }).__cahierDerniereImage = {
      width: bitmap.width,
      height: bitmap.height,
    }
    afterDecode?.()
    return bitmap
  }) as typeof createImageBitmap
}

function withServedMaps(capture: any, url = assetPath): any {
  const maps = capture?.capabilities?.maps
  if (!maps?.items?.length) return capture
  return {
    ...capture,
    capabilities: {
      ...capture.capabilities,
      maps: {
        ...maps,
        items: maps.items.map((item: any) => ({ ...item, inlineUrl: url })),
      },
    },
  }
}

interface ResultatPdf {
  readonly fileName: string
  readonly bytes: number[]
  readonly ms: number
  readonly heap?: number
}

async function generer(
  key: string,
  captureOverride?: any,
  abort = false,
  served = true,
  abortAfterDecode = false,
): Promise<ResultatPdf> {
  const memoire = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
  const source = captureOverride ?? capturesDenses[key] ?? capturePdfFixture(key as PdfFixtureSectionKey)
  const capture = served ? withServedMaps(source) : source
  const modes = capture.capabilities.selectableSeries.slice(0, key === 'populated-comparison' ? 2 : 3).map((serie: any) => serie.id)
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(projection.reason)
  const controller = new AbortController()
  if (abort) controller.abort()
  const debut = performance.now()
  if (abortAfterDecode) afterDecode = () => controller.abort()
  try {
  const artifact = await composerCahierPdf(projection.request, {
    signal: controller.signal,
    urlPublique: `https://lusk.test/territoire/commune/22001?theme=mobilite#section-${key}`,
    urlAccueil: 'https://lusk.test/',
  })
  return {
    fileName: artifact.fileName,
    bytes: [...new Uint8Array(await artifact.blob.arrayBuffer())],
    ms: performance.now() - debut,
    heap: memoire,
  }
  } finally {
    afterDecode = undefined
  }
}

;(window as unknown as {
  genererCahierPdf: (key: string) => Promise<ResultatPdf>
  genererCahierPdfAvecCarte: (url: string) => Promise<ResultatPdf>
  genererCahierPdfAnnule: (key: string) => Promise<ResultatPdf>
  clesPdfCahier: readonly PdfFixtureSectionKey[]
}).genererCahierPdf = (key) => generer(key)

;(window as unknown as {
  genererCahierPdfAvecCarte: (url: string) => Promise<ResultatPdf>
}).genererCahierPdfAvecCarte = async (url) => {
  const capture: any = capturePdfFixture('aedar-car-overview')
  const maps = capture.capabilities.maps
  return generer('asset-failure', {
    ...capture,
    capabilities: {
      ...capture.capabilities,
      maps: { ...maps, items: maps.items.map((item: any) => ({ ...item, inlineUrl: url })) },
    },
  }, false, false)
}

;(window as unknown as {
  genererCahierPdfAnnule: (key: string) => Promise<ResultatPdf>
}).genererCahierPdfAnnule = (key) => generer(key, undefined, true)

;(window as any).genererCahierPdfAnnulePendantDecodage = () => generer('aedar-car-overview', undefined, false, true, true)

// Independent browser CSS engine, not the PDF resolver, owns the expected RGB.
;(window as any).auditerCahierCouleurs = () => {
  const element = document.createElement('div')
  for (const [key, value] of Object.entries(CAHIER_COLOR_ROLES)) element.style.setProperty(key, value)
  document.body.append(element)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')!
  try {
    return Object.entries({ paper: '--paper', paperDeep: '--paper-deep', ink: '--ink', muted: '--muted',
      margin: '--red', marginSoft: '--red-soft', brand200: '--brand-200', brand500: '--brand-500',
      themeMobilite: '--cahier-theme', themeMobiliteStrong: '--cahier-theme-strong',
      modeFoot: '--cahier-mode-foot', modeBike: '--cahier-mode-bike', modeCar: '--cahier-mode-car',
    }).map(([key, role]) => {
      element.style.color = 'var(--paper)'
      context.fillStyle = getComputedStyle(element).color
      context.fillRect(0, 0, 1, 1)
      element.style.color = `var(${role})`
      context.fillStyle = getComputedStyle(element).color
      context.fillRect(0, 0, 1, 1)
      const browserRgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      const pdfHex = PALETTE_PDF[key as keyof typeof PALETTE_PDF]
      const pdfRgb = [1, 3, 5].map((start) => Number.parseInt(pdfHex.slice(start, start + 2), 16))
      if (browserRgb.some((value, index) => Math.abs(value - pdfRgb[index]!) > 1)) {
        throw new Error(`CSS/PDF colour mismatch ${role}: ${browserRgb} / ${pdfRgb}`)
      }
      return { role, browserRgb, pdfHex }
    })
  } finally { element.remove() }
}

;(window as unknown as { clesPdfCahier: readonly PdfFixtureSectionKey[] }).clesPdfCahier = PDF_FIXTURE_SECTION_KEYS

export { PDF_FIXTURE_SECTION_KEYS }
