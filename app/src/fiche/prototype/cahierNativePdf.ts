import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { jsPDF } from 'jspdf'
import { AEDAR_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import { CAHIER_NATIVE_RENDER, supportsStagedNativeRender } from './cahierNativeRenderContext'
import type { CahierCaptureMapItem, CahierExportRequest } from './cahierExportCapture'
import { evaluerDisponibiliteExportPdf } from './cahierPdfExport'
import { chargerPolicePdf } from './cahierPdfFonts'
import { LARGEUR_CORPS_PT, PAGE_APPROUVEE, ptDepuisCssPx } from './cahierPdfGrammaire'
import type { OptionsCompositionCahierPdf } from './cahierPdfComposer'

export class CahierNativePdfError extends Error {
  constructor(readonly reason: string, cause?: unknown) { super(reason, { cause }); this.name = 'CahierNativePdfError' }
}

/** Explicit reason → controller-compatible composition error code mapping. */
export function codeErreurNativePdf(reason: string): 'incomplete-capture' | 'inconsistent-capture' | 'asset' | 'layout' | 'serialization' {
  if (/^(map|legend|asset|reference|source|section|comparison|equipment|resource)/.test(reason)) {
    return /^(asset|map|legend|resource)/.test(reason) ? 'asset' : 'incomplete-capture'
  }
  if (/^(unsupported-native|unbreakable|native-width)/.test(reason)) return /unbreakable|native-width/.test(reason) ? 'layout' : 'inconsistent-capture'
  if (reason === 'missing-rendered-section') return 'serialization'
  return 'inconsistent-capture'
}

interface NativePdfOptions {
  readonly signal: AbortSignal
  /** Supplies settled bytes for the exact owner observation; the mount never fetches them. */
  readonly readAsset?: (item: CahierCaptureMapItem, signal: AbortSignal) => Promise<Blob>
}

/** Default reader: only the bytes frozen in the capture. No owner re-contact. */
async function readAssetParDefaut(item: CahierCaptureMapItem, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted()
  if (!item.bytes) throw new CahierNativePdfError('asset-unfrozen')
  return new Blob([item.bytes], { type: 'image/webp' })
}

export interface CorpsNatifMesure {
  readonly heightPt: number
  readonly widthPt: number
  paint(doc: jsPDF, x: number, y: number): Promise<void>
}

/**
 * Find native break opportunities in the mounted section without changing its
 * layout: each element is kept whole, and children sharing a layout row are
 * grouped so paired figures stay atomic. Only a single unbreakable element
 * taller than the useful area is refused.
 */
function nativeBreakBlocks(root: HTMLElement, scale: number, maxHeight: number): HTMLElement[][] {
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
      && rect.width > 0 && rect.height > 0
  }
  const height = (elements: readonly HTMLElement[]) => {
    const boxes = elements.map((element) => element.getBoundingClientRect())
    return Math.max(...boxes.map((r) => r.bottom)) - Math.min(...boxes.map((r) => r.top))
  }
  const walk = (element: HTMLElement): HTMLElement[][] => {
    if (height([element]) * scale <= maxHeight) return [[element]]
    const children = [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement && visible(child))
    if (!children.length) throw new CahierNativePdfError('unbreakable-native-content')
    const rows: HTMLElement[][] = []
    for (const child of children) {
      const top = child.getBoundingClientRect().top
      const row = rows.find((candidate) => Math.abs(candidate[0]!.getBoundingClientRect().top - top) < 2)
      if (row) row.push(child)
      else rows.push([child])
    }
    return rows.flatMap((row) => height(row) * scale <= maxHeight ? [row] : row.flatMap(walk))
  }
  return walk(root)
}

/** Resolve the frozen ramp-mode selection for every section kind. */
export function modesNatifDepuisCapture(
  request: CahierExportRequest,
  capture: CahierExportRequest['capture'],
  isAccess: boolean,
): readonly (typeof AEDAR_RAMP_MODES)[number][] {
  const selected = new Set(request.modeIds)
  // Non-access sections (notably the equipment profile/waffle) publish their
  // selected modes in the AEDAR capture state, not in `request.modeIds`.
  return isAccess ? AEDAR_RAMP_MODES.filter((id) => selected.has(id))
    : (capture.aedar?.modes ?? []).filter((id) => AEDAR_RAMP_MODES.includes(id as any))
}

async function avecCorpsNatif<T>(request: CahierExportRequest, options: NativePdfOptions,
  layout: { readonly widthPt: number; readonly document: boolean; readonly maxHeightPt?: number },
  use: (bodies: readonly CorpsNatifMesure[]) => Promise<T>,
): Promise<T> {
  const { capture } = request, { signal } = options
  signal.throwIfAborted()
  const activation = evaluerDisponibiliteExportPdf(capture)
  if (!activation.ready) throw new CahierNativePdfError(activation.reason)
  const snapshot = capture.nativeRender
  const unit = snapshot?.content.units[0], section = unit?.sections[0]
  if (!snapshot || snapshot.content.units.length !== 1 || unit?.sections.length !== 1
    || section?.key !== capture.identity.sectionKey || !supportsStagedNativeRender(section?.evidence?.kind)) throw new CahierNativePdfError('unsupported-native-input')
  // Every section gets its real frozen ramp-mode selection: the profile and
  // waffle figures select modes through the same shared section context.
  const isAccess = section.evidence?.kind === 'aedar-access'
  const modes = modesNatifDepuisCapture(request, capture, isAccess)
  if (isAccess && (!modes.length || modes.length !== request.modeIds.length)) {
    throw new CahierNativePdfError('unsupported-native-modes')
  }
  const [{ default: Shell }, { paintCahierNativeDom }] = await Promise.all([
    import('./VarianteCahierLibre.vue'), import('./cahierNativeDomPaint'),
  ])
  const scale = ptDepuisCssPx(1)
  const width = layout.widthPt
  const host = document.createElement('div')
  host.className = 'cahier-native-pdf-host'
  host.inert = true
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1440px;pointer-events:none'
  const sheet = document.createElement('style')
  const scope = layout.document ? '.cahier-native-pdf-host[data-native-document]' : '.cahier-native-pdf-host:not([data-native-document])'
  if (layout.document) host.dataset.nativeDocument = ''
  sheet.textContent = `${scope} .concept-group { max-width:${width / scale}px; margin-inline:auto;${layout.document ? 'padding:0!important;border:0!important;box-shadow:none!important;background:transparent!important' : ''} }
${scope} .cahier-page, ${scope} .page-layout, ${scope} .page-main, ${scope} .page-heading { padding:0!important;margin:0!important;border:0!important;box-shadow:none!important;position:static!important }
${scope} .cahier-section-footer, ${scope} [role=tooltip], ${scope} .cahier-rank { display:none!important }
/* Owner decision: PDF exports carry no explanatory prose. One generic rule on
   the shared prose roles; figure titles, captions, axis/legend text, scalar
   labels and figure-attached reading notes keep their own classes and remain. */
${scope} .argument-copy, ${scope} .page-subtitle { display:none!important }
${layout.document ? `${scope} .cahier-evidence-source:not(.cahier-map-legend__note) { display:none!important }` : ''}`
  const target = document.createElement('div')
  host.append(sheet, target)
  // The mounted sections resolve exploration links by named routes. They are
  // inert here (no navigation), but must exist so a render cannot throw.
  const inert = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/indicateurs', name: 'indicateurs', component: inert },
    { path: '/indicateurs/:theme/:indicator', name: 'indicateur', component: inert },
    { path: '/territoire/:type/:code', name: 'territoire', component: inert },
    { path: '/:pathMatch(.*)*', component: inert },
  ] })
  const comparison = { status: capture.comparison.status, error: capture.comparison.error ?? undefined }
  const declared = capture.capabilities.maps.items.filter((map) => map.declared)
  const app = createApp({ render: () => h(Shell, {
    content: snapshot.content,
    pagination: { currentPage: 1, totalPages: 1, entries: [] },
    layoutVariant: snapshot.layoutVariant,
    presentation: snapshot.presentation,
    aedarAccessEnabled: true,
    // A section that actually has declared maps must not be blanked because the
    // screen chapter happens to be inactive: the export is the requested view.
    aedarChapterActive: declared.length > 0,
    aedarStatus: 'ready',
    comparisonStatus: comparison.status === 'unavailable' ? 'idle' : comparison.status,
    comparisonError: comparison.error,
    nativeComparisonStatus: comparison.status,
    nativeComparisonError: comparison.error,
  }) })
  const urls: string[] = []
  let assetObserver: MutationObserver | null = null
  try {
    const maps = capture.capabilities.maps
    const readAsset = options.readAsset ?? readAssetParDefaut
    const assets: Record<string, string> = {}
    for (const item of declared) {
      if (!item.loaded || item.unavailable) throw new CahierNativePdfError('map-unavailable')
      if (!item.inlineUrl) throw new CahierNativePdfError('asset-unfrozen')
      try {
        const bitmap = await readAsset(item, signal)
        if (!/^image\/(webp|png|jpeg)$/.test(bitmap.type) || !bitmap.size) throw Error('Raster vide ou non pris en charge')
        const src = URL.createObjectURL(bitmap)
        urls.push(src)
        assets[item.id] = src
      }
      catch (cause) { signal.throwIfAborted(); throw new CahierNativePdfError('asset', cause) }
    }
    app.provide(CAHIER_NATIVE_RENDER, {
      modes,
      comparisonVisible: capture.aedar?.comparisonVisible ?? false,
      comparisonEligible: capture.comparison.eligible,
      sectionIndex: snapshot.sectionIndex,
      carMap: declared[0] ? { src: assets[declared[0].id]!, legend: maps.legendDetail } : null,
      assets,
      comparisonNone: capture.comparison.none ?? false,
      barToggles: Object.fromEntries(capture.comparison.display.layers.flatMap((layer) => layer.toggle === null ? [] : [[layer.slot, layer.toggle]])),
    })
    await router.push('/')
    app.use(router)
    signal.throwIfAborted()
    document.body.append(host)
    // Wire every declared map to its settled object URL, generically: sections
    // may reference their owner URL directly instead of the shared carMap prop.
    assetObserver = new MutationObserver(() => {
      for (const img of target.querySelectorAll<HTMLImageElement>('img[src]')) {
        if (img.dataset.cahierNativeAsset) continue
        const current = img.getAttribute('src') ?? ''
        const item = declared.find((map) => map.inlineUrl && current.includes(map.inlineUrl))
        const settled = item && assets[item.id]
        if (settled) {
          img.dataset.cahierNativeAsset = 'true'
          img.src = settled
        }
      }
    })
    assetObserver.observe(target, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
    app.mount(target)
    await nextTick()
    const root = target.querySelector<HTMLElement>(layout.document ? '.concept-group > [data-figure]' : '.concept-group')
    if (!root) throw new CahierNativePdfError('missing-rendered-section')
    try {
      const images = [...root.querySelectorAll<HTMLImageElement>('img[src]')]
      if (images.length > declared.length) throw Error('Le nombre de rasters montés ne correspond pas à la capture')
      await Promise.all(images.map((img) => new Promise<void>((resolve, reject) => {
        const done = () => {
          img.removeEventListener('load', done)
          img.removeEventListener('error', done)
          signal.removeEventListener('abort', done)
          if (signal.aborted) reject(signal.reason)
          else if (img.naturalWidth > 0) resolve()
          else reject(Error('Raster natif non décodable'))
        }
        img.addEventListener('load', done)
        img.addEventListener('error', done)
        signal.addEventListener('abort', done, { once: true })
        if (img.complete || signal.aborted) done()
      })))
    }
    catch (cause) { signal.throwIfAborted(); throw new CahierNativePdfError('asset', cause) }
    if (document.fonts) await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const rect = root.getBoundingClientRect()
    signal.throwIfAborted()
    if (rect.width * scale > width + .1 || rect.height <= 0 || rect.width <= 0) throw new CahierNativePdfError('native-width')
    const maxHeight = layout.maxHeightPt ?? (PAGE_APPROUVEE.hauteurPt - PAGE_APPROUVEE.hautContenuPt - PAGE_APPROUVEE.basContenuPt) * 0.72
    const bodies = nativeBreakBlocks(root, scale, maxHeight).map((elements) => {
      const boxes = elements.map((element) => element.getBoundingClientRect())
      const left = Math.min(...boxes.map((r) => r.x))
      const top = Math.min(...boxes.map((r) => r.y))
      const right = Math.max(...boxes.map((r) => r.right))
      const bottom = Math.max(...boxes.map((r) => r.bottom))
      return {
        heightPt: (bottom - top) * scale,
        widthPt: (right - left) * scale,
        paint: (doc: jsPDF, x: number, y: number) => paintCahierNativeDom(doc, elements,
          { x, y, scale: scale / doc.internal.scaleFactor }, signal),
      }
    })
    return await use(bodies)
  } finally {
    assetObserver?.disconnect()
    if (target.isConnected) app.unmount()
    host.remove()
    for (const url of urls) URL.revokeObjectURL(url)
  }
}

/** Body-only witness; the production composer does not route here. */
export async function rendreCorpsNatifPdf(request: CahierExportRequest, options: NativePdfOptions): Promise<Blob> {
  const [{ jsPDF }, { enregistrerPolices }] = await Promise.all([import('jspdf'), import('./cahierPdfComposer'), import('svg2pdf.js')])
  const { insetGauchePt: side, hautContenuPt: top, basContenuPt: bottom } = PAGE_APPROUVEE
  void bottom
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true })
  const width = doc.internal.pageSize.getWidth() - side * 2
  return avecCorpsNatif(request, options, { widthPt: width, document: false }, async (bodies) => {
    await enregistrerPolices(doc, chargerPolicePdf, options.signal)
    for (const [index, body] of bodies.entries()) {
      if (index) doc.addPage('a4', 'portrait')
      await body.paint(doc, side + (width - body.widthPt) / 2, top)
    }
    return doc.output('blob')
  })
}

/** The one document entry: one measured native body + the existing table/document grammar. */
export async function composerCahierPdfNatif(request: CahierExportRequest, options: OptionsCompositionCahierPdf) {
  const { composerDocumentAvecCorpsNatif } = await import('./cahierPdfComposer')
  return avecCorpsNatif(request, options, { widthPt: LARGEUR_CORPS_PT, document: true },
    (bodies) => composerDocumentAvecCorpsNatif(request, options, bodies))
}
