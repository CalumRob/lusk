/**
 * Test-only browser entry for the bounded PDF harness (#1024).
 *
 * It is built into a temporary static page by `verify-cahier-pdf-browser.mjs`;
 * it is never imported by the app and never ships in production.
 */
import { composerCahierPdf } from '../src/fiche/prototype/cahierPdfComposer'
import { createApp, h, nextTick } from 'vue'
import AccessRampFigureCahier from '../src/fiche/prototype/AccessRampFigureCahier.vue'
import CahierGroupedVerticalBarChart from '../src/fiche/prototype/CahierGroupedVerticalBarChart.vue'
import CahierMobiliteComparisonBars from '../src/fiche/prototype/CahierMobiliteComparisonBars.vue'
import CahierMobiliteRaccordementCurve from '../src/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import { cahierFigureStrokeVars } from '../src/fiche/prototype/cahierFigureNativeGeometry'
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

/**
 * Rendered receipt for the shared screen stroke grammar (#1024).
 *
 * Mounts the four native stroke consumers in the real CSS engine and checks,
 * per painted metric: the SVG carries the owner's injected value, the computed
 * property equals it, a mutated injected value is followed, and the legacy
 * axis-geometry variable cannot reach the native rule. The vitest source
 * contract remains the suite gate; this is the rendered counterpart.
 */
;(window as unknown as { auditerGrammaireTraitEcran: () => Promise<unknown> }).auditerGrammaireTraitEcran = async () => {
  const racineStyle = cahierFigureStrokeVars()
  const hotes: Array<{ arreter: () => void }> = []
  const hote = document.createElement('div')
  hote.style.cssText = 'position:fixed;left:-20000px;top:0;width:920px'
  document.body.append(hote)

  const monter = (composant: unknown, props: Record<string, unknown>): HTMLElement => {
    const racine = document.createElement('div')
    hote.append(racine)
    const application = createApp(composant as any, props as any)
    application.mount(racine)
    hotes.push({ arreter: () => application.unmount() })
    return racine
  }

  const rampeFigure = () => ({
    availability: 'incomplete',
    xAxis: { label: 'Temps d’accès', unit: 'minutes' },
    yAxis: { label: 'Diversité accessible', unit: 'types' },
    series: [{
      key: 'car',
      label: 'Voiture',
      points: [5, 10, 15].map((minute) => ({
        xValue: minute,
        xLabel: `${minute} min`,
        value: minute / 5,
        referenceValue: minute / 6,
      })),
    }],
    provenance: null,
    comparisonLabel: 'Territoires comparables',
  })
  const groupeeFigure = () => ({
    categories: [
      { key: 'early', label: 'Début', axisLabel: 'Début' },
      { key: 'late', label: 'Fin', axisLabel: 'Fin' },
    ],
    series: [
      { key: 'north', label: 'Nord', color: '#356a83', values: [2, 5] },
      { key: 'south', label: 'Sud', color: '#a94b65', values: [3, 4] },
    ],
    xAxisTitle: 'Période',
    yAxisTitle: 'Mesure',
    description: 'Comparaison groupée de deux séries.',
  })

  const courbeCapture = captureCourbeTrous() as any
  const courbeModele = courbeCapture.figures.find((figure: any) => figure.family === 'mobilite-curve').model
  const barresModele = (captureBarresDense() as any).figures
    .find((figure: any) => figure.family === 'mobilite-bars').model.figure

  const figures = [
    { nom: 'rampe', racine: monter(AccessRampFigureCahier, { timeRamp: rampeFigure(), territoryName: 'Rennes' }), svg: '.access-ramp-svg' },
    { nom: 'courbe', racine: monter(CahierMobiliteRaccordementCurve, { figure: courbeModele, comparison: { status: 'ready' } }), svg: '.mobilite-raccordement-curve__svg' },
    { nom: 'barres', racine: monter(CahierMobiliteComparisonBars, { figure: barresModele, comparison: { status: 'ready' } }), svg: '.mobilite-comparison-bars__svg' },
    { nom: 'groupees', racine: monter(CahierGroupedVerticalBarChart, { figure: groupeeFigure() }), svg: '.cahier-grouped-vertical-bar-chart__svg' },
  ]

  type Genre = 'longueur' | 'mot' | 'tirets' | 'nombre'
  type Controle = { figure: string; selecteur: string; variable: string; propriete: string; genre: Genre; sentinelle: string }
  const controles: Controle[] = [
    { figure: 'rampe', selecteur: '.access-ramp-line--territory', variable: '--cahier-figure-stroke-series-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '7px' },
    { figure: 'rampe', selecteur: '.access-ramp-line--territory', variable: '--cahier-figure-stroke-series-cap', propriete: 'stroke-linecap', genre: 'mot', sentinelle: 'butt' },
    { figure: 'rampe', selecteur: '.access-ramp-line--territory', variable: '--cahier-figure-stroke-series-join', propriete: 'stroke-linejoin', genre: 'mot', sentinelle: 'miter' },
    { figure: 'rampe', selecteur: '.access-ramp-line--comparison', variable: '--cahier-figure-stroke-comparison-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '6px' },
    { figure: 'rampe', selecteur: '.access-ramp-line--comparison', variable: '--cahier-figure-stroke-comparison-dash', propriete: 'stroke-dasharray', genre: 'tirets', sentinelle: '13 8' },
    { figure: 'rampe', selecteur: '.access-ramp-line--comparison', variable: '--cahier-figure-stroke-comparison-opacity', propriete: 'opacity', genre: 'nombre', sentinelle: '0.4' },
    { figure: 'rampe', selecteur: '.access-ramp-grid line', variable: '--cahier-figure-stroke-grid-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '5px' },
    { figure: 'rampe', selecteur: '.access-ramp-grid .access-ramp-axis', variable: '--cahier-figure-stroke-axis-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '4px' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__territory', variable: '--cahier-figure-stroke-series-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '7px' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__territory', variable: '--cahier-figure-stroke-series-cap', propriete: 'stroke-linecap', genre: 'mot', sentinelle: 'butt' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__territory', variable: '--cahier-figure-stroke-series-join', propriete: 'stroke-linejoin', genre: 'mot', sentinelle: 'miter' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__comparison', variable: '--cahier-figure-stroke-comparison-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '6px' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__comparison', variable: '--cahier-figure-stroke-comparison-dash', propriete: 'stroke-dasharray', genre: 'tirets', sentinelle: '13 8' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__comparison', variable: '--cahier-figure-stroke-comparison-opacity', propriete: 'opacity', genre: 'nombre', sentinelle: '0.4' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__comparison', variable: '--cahier-figure-stroke-series-cap', propriete: 'stroke-linecap', genre: 'mot', sentinelle: 'square' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__comparison', variable: '--cahier-figure-stroke-series-join', propriete: 'stroke-linejoin', genre: 'mot', sentinelle: 'bevel' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__marker-line', variable: '--cahier-figure-stroke-marker-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '9px' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__marker-line', variable: '--cahier-figure-stroke-marker-dash', propriete: 'stroke-dasharray', genre: 'tirets', sentinelle: '2 6' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__grid line', variable: '--cahier-figure-stroke-grid-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '5px' },
    { figure: 'courbe', selecteur: '.mobilite-raccordement-curve__grid .mobilite-raccordement-curve__axis', variable: '--cahier-figure-stroke-axis-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '4px' },
    { figure: 'barres', selecteur: '.mobilite-comparison-bars__grid line', variable: '--cahier-figure-stroke-grid-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '5px' },
    { figure: 'barres', selecteur: '.mobilite-comparison-bars__grid .mobilite-comparison-bars__axis', variable: '--cahier-figure-stroke-axis-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '4px' },
    { figure: 'groupees', selecteur: '.cahier-grouped-vertical-bar-chart__grid line', variable: '--cahier-figure-stroke-grid-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '5px' },
    { figure: 'groupees', selecteur: '.cahier-grouped-vertical-bar-chart__grid .cahier-grouped-vertical-bar-chart__axis', variable: '--cahier-figure-stroke-axis-width', propriete: 'stroke-width', genre: 'longueur', sentinelle: '4px' },
  ]

  const normaliser = (valeur: string, genre: Genre): string => genre === 'tirets'
    ? valeur.trim().split(/[,\s]+/).filter(Boolean).map((nombre) => String(Number.parseFloat(nombre))).join(' ')
    : valeur.trim()
  const lire = (element: Element, propriete: string, genre: Genre): string =>
    normaliser(getComputedStyle(element).getPropertyValue(propriete), genre)
  const exiger = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(`Grammaire de trait écran : ${message}`)
  }

  await nextTick()
  await new Promise((resoudre) => requestAnimationFrame(() => resoudre(null)))

  const receptions: Array<Record<string, string>> = []
  try {
    for (const { nom, racine, svg: selecteurSvg } of figures) {
      const svg = racine.querySelector(selecteurSvg) as SVGElement | null
      exiger(Boolean(svg), `${nom} : svg introuvable`)
      // One owner object: every property is bound on the figure's own SVG.
      for (const [variable, attendu] of Object.entries(racineStyle)) {
        exiger(svg!.style.getPropertyValue(variable).trim() === attendu,
          `${nom} : ${variable} injecté ${svg!.style.getPropertyValue(variable)} ≠ ${attendu}`)
      }
      for (const controle of controles.filter((candidat) => candidat.figure === nom)) {
        const element = svg!.querySelector(controle.selecteur)
        exiger(Boolean(element), `${nom} : ${controle.selecteur} introuvable`)
        const attendu = normaliser(racineStyle[controle.variable]!, controle.genre)
        const calcule = lire(element!, controle.propriete, controle.genre)
        exiger(calcule === attendu,
          `${nom} ${controle.selecteur} { ${controle.propriete} } calculé ${calcule} ≠ propriétaire ${attendu}`)

        svg!.style.setProperty(controle.variable, controle.sentinelle)
        void svg!.getBoundingClientRect()
        const mute = lire(element!, controle.propriete, controle.genre)
        exiger(mute === normaliser(controle.sentinelle, controle.genre),
          `${nom} ${controle.selecteur} { ${controle.propriete} } ne suit pas la mutation : ${mute}`)
        svg!.style.setProperty(controle.variable, racineStyle[controle.variable]!)
        void svg!.getBoundingClientRect()
        receptions.push({
          figure: nom,
          selecteur: controle.selecteur,
          variable: controle.variable,
          propriete: controle.propriete,
          injecte: racineStyle[controle.variable]!,
          calcule: attendu,
          mute: normaliser(controle.sentinelle, controle.genre),
        })
      }
    }

    // Removing the injection must fall back to the CSS initial value: a copied
    // literal would keep painting the owner's metric without the variable.
    const courbe = figures.find((candidate) => candidate.nom === 'courbe')!
    const svgCourbe = courbe.racine.querySelector(courbe.svg) as SVGElement
    const territoire = svgCourbe.querySelector('.mobilite-raccordement-curve__territory')!
    const largeurInitiale = lire(territoire, 'stroke-width', 'longueur')
    const capInitial = lire(territoire, 'stroke-linecap', 'mot')
    svgCourbe.style.removeProperty('--cahier-figure-stroke-series-width')
    svgCourbe.style.removeProperty('--cahier-figure-stroke-series-cap')
    void svgCourbe.getBoundingClientRect()
    const sansInjection = {
      'stroke-width': lire(territoire, 'stroke-width', 'longueur'),
      'stroke-linecap': lire(territoire, 'stroke-linecap', 'mot'),
    }
    exiger(sansInjection['stroke-width'] === '1px',
      `retrait de l'injection : stroke-width ${sansInjection['stroke-width']} ≠ 1px initial`)
    exiger(sansInjection['stroke-linecap'] === 'butt',
      `retrait de l'injection : stroke-linecap ${sansInjection['stroke-linecap']} ≠ butt initial`)
    svgCourbe.style.setProperty('--cahier-figure-stroke-series-width', racineStyle['--cahier-figure-stroke-series-width']!)
    svgCourbe.style.setProperty('--cahier-figure-stroke-series-cap', racineStyle['--cahier-figure-stroke-series-cap']!)

    // The legacy 1 px axis-geometry grammar lives in another scope and must not
    // reach the native 1.5 px axis stroke when both are present (nested case).
    hote.style.setProperty('--cahier-figure-axis-width', '9')
    void hote.getBoundingClientRect()
    const axesRendus: Array<Record<string, string>> = []
    for (const { nom, racine, svg: selecteurSvg } of figures) {
      const svg = racine.querySelector(selecteurSvg) as SVGElement
      const axe = svg.querySelector([
        '.access-ramp-grid .access-ramp-axis',
        '.mobilite-raccordement-curve__grid .mobilite-raccordement-curve__axis',
        '.mobilite-comparison-bars__grid .mobilite-comparison-bars__axis',
        '.cahier-grouped-vertical-bar-chart__grid .cahier-grouped-vertical-bar-chart__axis',
      ].join(', '))
      exiger(Boolean(axe), `${nom} : axe introuvable`)
      const largeur = lire(axe!, 'stroke-width', 'longueur')
      exiger(largeur === racineStyle['--cahier-figure-stroke-axis-width'],
        `${nom} : la variable d'axe historique a atteint le trait natif (${largeur})`)
      axesRendus.push({ figure: nom, strokeWidth: largeur })
    }
    hote.style.removeProperty('--cahier-figure-axis-width')

    return { proprietaire: racineStyle, largeurInitiale, capInitial, sansInjection, receptions, axesRendus }
  } finally {
    for (const { arreter } of hotes.reverse()) arreter()
    hote.remove()
  }
}

export { PDF_FIXTURE_SECTION_KEYS }
