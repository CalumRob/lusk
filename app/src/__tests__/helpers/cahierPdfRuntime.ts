/**
 * Test-only runtime for the shared PDF composer.
 *
 * Fonts are the committed assets read from disk (same bytes the browser
 * fetches), and map images are decoded from a tiny PNG. Neither helper is
 * bundled in production.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
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
}

export interface LignePdf {
  readonly page: number
  readonly y: number
  readonly items: readonly TextePdf[]
  readonly texte: string
}

export interface LecturePdf {
  readonly pages: number
  readonly textes: readonly TextePdf[]
  readonly lignes: readonly LignePdf[]
  readonly liens: readonly string[]
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
      })
    }
    const annotations = await page.getAnnotations()
    for (const annotation of annotations as Array<{ url?: string }>) {
      if (annotation.url) liens.push(annotation.url)
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
