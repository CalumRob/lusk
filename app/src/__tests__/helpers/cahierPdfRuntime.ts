/**
 * Test-only runtime for the shared PDF composer.
 *
 * Fonts are the committed assets read from disk (same bytes the browser
 * fetches), and map images are decoded from a tiny PNG. Neither helper is
 * bundled in production.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'

import type { ChargeurPolicePdf, PdfFontFace } from '@/fiche/prototype/cahierPdfFonts'
import type { ChargeurImagePdf } from '@/fiche/prototype/cahierPdfFigures'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture, CahierExportRequest } from '@/fiche/prototype/cahierExportCapture'
import { capturePdfFixture, PDF_FIXTURE_SECTION_KEYS } from './cahierPdfFixtures'
import type { PdfFixtureSectionKey } from './cahierPdfFixtures'

const dossierPolices = resolve(process.cwd(), 'src/assets/fonts/pdf')

export const chargeurPoliceTest: ChargeurPolicePdf = async (face: PdfFontFace) => {
  const bytes = readFileSync(resolve(dossierPolices, face.file))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

// 2×2 PNG, generated once and stable. Production converts the real inline
// WebP/PNG assets; tests only exercise the same embedding path.
export const PNG_TEST =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGNMmXbiPwMDAwMTiABhACnkAsXTOyC6AAAAAElFTkSuQmCC'

export const chargeurImageTest: ChargeurImagePdf = async () => ({
  dataUrl: PNG_TEST,
  width: 2,
  height: 2,
})

export function requetePour(
  key: PdfFixtureSectionKey,
  modes?: readonly string[],
): CahierExportRequest {
  const capture = capturePdfFixture(key)
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const choisis = modes ?? (offered.length ? offered.slice(0, 3) : [])
  const projection = projeterRequeteExport(capture, choisis)
  if (projection.status !== 'ready') {
    throw new Error(`Projection invalide pour ${key} : ${projection.reason}`)
  }
  return projection.request
}

export function toutesLesRequetes(): readonly { key: PdfFixtureSectionKey; request: CahierExportRequest }[] {
  return PDF_FIXTURE_SECTION_KEYS.map((key) => ({ key, request: requetePour(key) }))
}

export interface TextePdf {
  readonly page: number
  readonly x: number
  readonly y: number
  readonly str: string
  readonly taille: number
  readonly largeur: number
  readonly rotation: number
}

export interface LignePdf {
  readonly page: number
  readonly y: number
  readonly items: readonly TextePdf[]
  readonly texte: string
}

export interface AnnotationPdf {
  readonly page: number
  readonly url: string | null
  readonly dest: unknown
  readonly rect: readonly number[]
}

export interface LecturePdf {
  readonly pages: number
  readonly textes: readonly TextePdf[]
  readonly lignes: readonly LignePdf[]
  readonly liens: readonly string[]
  readonly annotations: readonly AnnotationPdf[]
  readonly metadonnees: {
    readonly title?: string
    readonly subject?: string
    readonly author?: string
    readonly creator?: string
    readonly keywords?: string
  }
  readonly octets: Uint8Array
  readonly texteComplet: string
  readonly pagesFormat: readonly { readonly width: number; readonly height: number }[]
}

function normaliser(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export async function lirePdf(blob: Blob): Promise<LecturePdf> {
  const octets = new Uint8Array(await blob.arrayBuffer())
  const pdf = await getDocument({ data: Uint8Array.from(octets), useSystemFonts: false }).promise
  const textes: TextePdf[] = []
  const liens: string[] = []
  const annotations: AnnotationPdf[] = []
  const pagesFormat: { width: number; height: number }[] = []
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex)
    const viewport = page.getViewport({ scale: 1 })
    pagesFormat.push({ width: viewport.width, height: viewport.height })
    const content = await page.getTextContent()
    for (const item of content.items as Array<{ str: string; transform: number[]; width: number }>) {
      if (!item.str) continue
      textes.push({
        page: pageIndex,
        x: item.transform[4]!,
        y: item.transform[5]!,
        str: item.str,
        taille: Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0),
        largeur: item.width,
        rotation: Math.atan2(item.transform[1] ?? 0, item.transform[0] ?? 0),
      })
    }
    const pageAnnotations = await page.getAnnotations()
    for (const annotation of pageAnnotations as Array<{
      url?: string
      dest?: unknown
      rect?: number[]
    }>) {
      if (annotation.url) liens.push(annotation.url)
      if (annotation.dest !== undefined) {
        annotations.push({
          page: pageIndex,
          url: annotation.url ?? null,
          dest: annotation.dest,
          rect: annotation.rect ?? [],
        })
      }
    }
  }
  const lignes: LignePdf[] = []
  const parPage = new Map<number, TextePdf[]>()
  for (const item of textes) {
    const liste = parPage.get(item.page) ?? []
    liste.push(item)
    parPage.set(item.page, liste)
  }
  for (const [page, items] of parPage) {
    const parY = new Map<number, TextePdf[]>()
    for (const item of items) {
      const key = Math.round(item.y * 2) / 2
      const liste = parY.get(key) ?? []
      liste.push(item)
      parY.set(key, liste)
    }
    for (const [y, groupe] of parY) {
      const tri = [...groupe].sort((a, b) => a.x - b.x)
      lignes.push({
        page,
        y,
        items: tri,
        texte: normaliser(tri.map((item) => item.str).join(' ')),
      })
    }
  }
  lignes.sort((a, b) => a.page - b.page || b.y - a.y)
  const meta = await pdf.getMetadata()
  const info = (meta.info ?? {}) as Record<string, string>
  return {
    pages: pdf.numPages,
    textes,
    lignes,
    liens,
    annotations,
    metadonnees: {
      title: info.Title,
      subject: info.Subject,
      author: info.Author,
      creator: info.Creator,
      keywords: info.Keywords,
    },
    octets,
    texteComplet: normaliser(textes.map((item) => item.str).join(' ')),
    pagesFormat,
  }
}

export function lignesContenant(lecture: LecturePdf, value: string): readonly LignePdf[] {
  const needle = normaliser(value)
  return lecture.lignes.filter((ligne) => ligne.texte.includes(needle))
}

export interface CheminPdf {
  readonly page: number
  readonly kind: 'fill' | 'stroke'
  readonly colour: string | null
  readonly largeur: number | null
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

async function fluxPage(octets: Uint8Array, pageIndex: number): Promise<{ raw: string; height: number }> {
  const doc = await PDFDocument.load(Uint8Array.from(octets).buffer)
  const page = doc.getPages()[pageIndex]
  const height = page.getHeight()
  const contents = page.node.lookup(PDFName.of('Contents'))
  const chunks = contents instanceof PDFRawStream
    ? [contents]
    : Array.isArray(contents) ? contents as PDFRawStream[] : []
  let raw = ''
  for (const chunk of chunks) {
    const buffer = Buffer.from(chunk.getContents())
    try {
      raw += inflateSync(buffer).toString('latin1')
    } catch {
      raw += buffer.toString('latin1')
    }
  }
  return { raw, height }
}

function composante(value: string): string {
  return Math.max(0, Math.min(255, Math.round(Number(value) * 255))).toString(16).padStart(2, '0')
}

/**
 * Paths actually emitted by the PDF, read from the page content streams.
 * jsPDF writes coordinates in points (its page `cm` maps its internal unit);
 * a path is collected until its fill/stroke paint operator. Test-only: this is
 * how the suite checks the approved surface/mark geometry, not the composer's
 * own layout objects.
 */
export async function cheminsPdf(octets: Uint8Array, pages = 1): Promise<readonly CheminPdf[]> {
  const chemins: CheminPdf[] = []
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const { raw, height: hauteurPage } = await fluxPage(octets, pageIndex)
    const lignes = raw.split('\n')
    let stroke: string | null = null
    let fill: string | null = null
    let largeur: number | null = null
    let points: [number, number][] = []
    let kind: 'fill' | 'stroke' | null = null
    const ajouter = (values: number[]) => {
      if (values.length >= 2) points.push([values[0]!, values[1]!])
    }
    for (const brut of lignes) {
      const ligne = brut.trim()
      if (!ligne) continue
      const rgbStroke = /^([\d.]+) ([\d.]+) ([\d.]+) RG$/.exec(ligne)
      if (rgbStroke) {
        stroke = `#${composante(rgbStroke[1]!)}${composante(rgbStroke[2]!)}${composante(rgbStroke[3]!)}`
        continue
      }
      const rgbFill = /^([\d.]+) ([\d.]+) ([\d.]+) rg$/.exec(ligne)
      if (rgbFill) {
        fill = `#${composante(rgbFill[1]!)}${composante(rgbFill[2]!)}${composante(rgbFill[3]!)}`
        continue
      }
      const nombres = [...ligne.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
      const largeurTrait = /^(-?\d+(?:\.\d+)?) w$/.exec(ligne)
      if (largeurTrait) {
        largeur = Number(largeurTrait[1])
        continue
      }
      if (/\bm$/.test(ligne) || /\bl$/.test(ligne)) {
        ajouter(nombres)
        continue
      }
      if (/\bre$/.test(ligne)) {
        const [x, y, w, h] = nombres
        if ([x, y, w, h].every((value) => value !== undefined)) {
          points.push([x!, y!], [x! + w!, y!], [x!, y! + h!], [x! + w!, y! + h!])
        }
        continue
      }
      if (/\b[cy]$/.test(ligne)) {
        for (let index = 0; index + 1 < nombres.length; index += 2) ajouter([nombres[index]!, nombres[index + 1]!])
        continue
      }
      if (ligne === 'S' || ligne === 's') kind = 'stroke'
      else if (ligne === 'f' || ligne === 'f*' || ligne === 'F') kind = 'fill'
      else if (ligne === 'W' || ligne === 'W*' || ligne === 'n') {
        points = []
        kind = null
        continue
      } else {
        continue
      }
      if (points.length) {
        const xs = points.map(([x]) => x)
        const ys = points.map(([, y]) => y)
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        const width = Math.max(...xs) - x
        const height = Math.max(...ys) - y
        chemins.push({
          page: pageIndex + 1,
          kind,
          colour: kind === 'stroke' ? stroke : fill,
          largeur,
          x,
          // The content stream is bottom-origin; expose the reader's top-origin
          // y so a margin/frame assertion reads like the approved page box.
          y: hauteurPage - (y + height),
          width,
          height,
        })
      }
      points = []
      kind = null
    }
  }
  return chemins
}

export function contientTout(lecture: LecturePdf, valeurs: readonly string[]): void {
  for (const valeur of valeurs) {
    if (!lecture.texteComplet.includes(normaliser(valeur))) {
      throw new Error(`Texte PDF manquant : « ${valeur} »`)
    }
  }
}

/** Embedded TrueType programs, traversed through object streams. */
export async function policesEmbarquees(octets: Uint8Array): Promise<number> {
  const document = await PDFDocument.load(Uint8Array.from(octets).buffer)
  let count = 0
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!object || typeof (object as { lookup?: unknown }).lookup !== 'function') continue
    const lookup = (object as unknown as { lookup: (name: PDFName) => unknown }).lookup
    const value = lookup.call(object, PDFName.of('FontFile2'))
    if (value instanceof PDFRawStream) count += 1
  }
  return count
}

/**
 * Raw `FontFile2` programs embedded in the document, in object order. The
 * caller identifies a face by its actual metrics/outlines, never by a nominal
 * family name.
 */
export async function programmesPoliceEmbarques(
  octets: Uint8Array,
): Promise<readonly Uint8Array[]> {
  const document = await PDFDocument.load(Uint8Array.from(octets).buffer)
  const programs: Uint8Array[] = []
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!object || typeof (object as { lookup?: unknown }).lookup !== 'function') continue
    const lookup = (object as unknown as { lookup: (name: PDFName) => unknown }).lookup
    const value = lookup.call(object, PDFName.of('FontFile2'))
    if (value instanceof PDFRawStream) {
      const raw = Buffer.from(value.getContents())
      // pdf-lib exposes the stored bytes; a FlateDecode stream stays zlib-
      // compressed. The composer always embeds deflated programs.
      programs.push(raw[0] === 0x78 ? Uint8Array.from(inflateSync(raw)) : Uint8Array.from(raw))
    }
  }
  return programs
}

/** Fill alpha (`ca`) values declared in one page's graphics states. */
export async function opacitesRemplissagePdf(
  octets: Uint8Array,
  pageIndex = 0,
): Promise<readonly number[]> {
  const pdf = await getDocument({ data: Uint8Array.from(octets), useSystemFonts: false }).promise
  const page = await pdf.getPage(pageIndex + 1)
  const operators = await page.getOperatorList()
  const values: number[] = []
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    if (operators.fnArray[index] !== OPS.setGState) continue
    const entries = operators.argsArray[index]?.[0] as [string, number][] | undefined
    for (const [key, value] of entries ?? []) {
      if (key === 'ca' && typeof value === 'number') values.push(value)
    }
  }
  return values
}

/** Line widths (`setLineWidth`) actually painted on one page, in points. */
export async function epaisseursTraitPdf(
  octets: Uint8Array,
  pageIndex = 0,
): Promise<readonly number[]> {
  const pdf = await getDocument({ data: Uint8Array.from(octets), useSystemFonts: false }).promise
  const page = await pdf.getPage(pageIndex + 1)
  const operators = await page.getOperatorList()
  const widths: number[] = []
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    if (operators.fnArray[index] !== OPS.setLineWidth) continue
    const value = operators.argsArray[index]?.[0]
    if (typeof value === 'number') widths.push(value)
  }
  return widths
}

export function captureDe(request: CahierExportRequest): CahierExportCapture {
  return request.capture
}

/** Optional local evidence output; never writes in CI (env var absent). */
export function enregistrerArtefact(nom: string, octets: Uint8Array): string | null {
  const dossier = process.env.CAHIER_PDF_EVIDENCE_DIR
  if (!dossier) return null
  mkdirSync(dossier, { recursive: true })
  const chemin = resolve(dossier, nom)
  writeFileSync(chemin, Uint8Array.from(octets))
  return chemin
}

export function ligneDe(lecture: LecturePdf, page: number, texte: string): LignePdf | undefined {
  return lecture.lignes.find((ligne) => ligne.page === page && ligne.texte.includes(texte))
}

export function occurrences(lecture: LecturePdf, texte: string): number {
  const needle = normaliser(texte)
  let count = 0
  let index = lecture.texteComplet.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = lecture.texteComplet.indexOf(needle, index + needle.length)
  }
  return count
}

/** No text run may cross the physical page edge (a crude clipping guard). */
export function verifierDansPage(lecture: LecturePdf, tolerance = 1.5): void {
  for (const texte of lecture.textes) {
    const format = lecture.pagesFormat[texte.page - 1]!
    if (texte.x < -tolerance
      || texte.x > format.width + tolerance
      || texte.y < -tolerance
      || texte.y > format.height + tolerance
      || texte.x + texte.largeur > format.width + tolerance) {
      throw new Error(
        `Texte hors page : « ${texte.str} » (${texte.x.toFixed(1)}, ${texte.y.toFixed(1)}, largeur ${texte.largeur.toFixed(1)})`,
      )
    }
  }
}

/** Every text run must be emitted at full opacity; catches PDF state leaks. */
export async function verifierAlphaTexte(octets: Uint8Array): Promise<void> {
  const pdf = await getDocument({ data: Uint8Array.from(octets) }).promise
  const findings: { page: number; alpha: number; text: string }[] = []
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex)
    const list = await page.getOperatorList()
    let alpha = 1
    const stack: number[] = []
    for (let index = 0; index < list.fnArray.length; index += 1) {
      const op = list.fnArray[index]
      const args = list.argsArray[index] as unknown[]
      if (op === OPS.save) stack.push(alpha)
      if (op === OPS.restore) alpha = stack.pop() ?? 1
      if (op === OPS.setGState) {
        const entries = args[0] as [string, number][]
        for (const [key, value] of entries) if (key === 'ca') alpha = value
      }
      if (op === OPS.showText && alpha < 0.99) {
        const text = (args[0] as { unicode?: string }[]).map((glyph) => glyph.unicode ?? '').join('')
        if (text.trim()) findings.push({ page: pageIndex, alpha, text })
      }
    }
  }
  if (findings.length) {
    throw new Error(`Texte translucide dans le PDF : ${JSON.stringify(findings.slice(0, 8))}`)
  }
}

/** Fill RGB operators actually emitted by the PDF renderer. */
export async function couleursRemplissage(octets: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: Uint8Array.from(octets) }).promise
  const couleurs: string[] = []
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const list = await (await pdf.getPage(pageIndex)).getOperatorList()
    for (let index = 0; index < list.fnArray.length; index += 1) {
      if (list.fnArray[index] === OPS.setFillRGBColor) {
        const value = (list.argsArray[index] as unknown[])[0]
        if (typeof value === 'string') couleurs.push(value.toLowerCase())
      }
    }
  }
  return couleurs
}

/** Real rendered-text overlap guard; catches cells/headers colliding. */
export function verifierCollisions(lecture: LecturePdf, tolerance = 0.35): void {
  const parPage = new Map<number, TextePdf[]>()
  for (const texte of lecture.textes) {
    if (!texte.str.trim()) continue
    if (Math.abs(texte.rotation) > 0.01) continue
    const liste = parPage.get(texte.page) ?? []
    liste.push(texte)
    parPage.set(texte.page, liste)
  }
  for (const [page, items] of parPage) {
    for (let index = 0; index < items.length; index += 1) {
      const a = items[index]!
      const aTop = a.y
      const aBottom = a.y + a.taille * 0.75
      for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
        const b = items[otherIndex]!
        const bTop = b.y
        const bBottom = b.y + b.taille * 0.75
        const vertical = Math.min(aBottom, bBottom) - Math.max(aTop, bTop)
        if (vertical <= Math.max(0.35, Math.min(a.taille, b.taille) * 0.35)) continue
        const horizontal = Math.min(a.x + a.largeur, b.x + b.largeur) - Math.max(a.x, b.x)
        if (horizontal > tolerance) {
          throw new Error(
            `Collision PDF page ${page} : « ${a.str} » et « ${b.str} » (x ${a.x.toFixed(1)}/${b.x.toFixed(1)})`,
          )
        }
      }
    }
  }
}
