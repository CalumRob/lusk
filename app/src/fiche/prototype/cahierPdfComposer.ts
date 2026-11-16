/**
 * Shared browser PDF composer for the Cahier (#1024).
 *
 * Public seam: one frozen `CahierExportRequest` (+ an `AbortSignal`) in, one
 * real `{ blob, fileName }` out. The composer knows no action, dialog, route or
 * section key semantics beyond the capture it receives. It owns document
 * composition, embedded fonts, measured comparison headings, automatic
 * pagination at real overflow, table serialization and the final Blob.
 *
 * The screen's figures are never remounted: figures are redrawn as vector
 * primitives from the frozen #1022 projections and the capture's native models.
 * Missing required assets, unsupported families and unreadable faces reject the
 * request; no partial PDF is returned.
 */
import type { jsPDF } from 'jspdf'

import { MARQUE_LUSK_ERMINE, REMPLISSAGES_MARQUE_LUSK } from '@/components/luskBrandMark'

import type { CahierPdfArtifact, CahierPdfGenerator } from './cahierPdfExportController'
import type { CahierFigureProjection } from './cahierExportAdapters'
import { projeterRequeteExportFigures } from './cahierExportAdapters'
import type {
  CahierCaptureSource,
  CahierExportCapture,
  CahierExportRequest,
} from './cahierExportCapture'
import {
  hauteurSousTitre,
  sousTitreComparaison,
  type SousTitreComparaison,
} from './cahierPdfComparaison'
import { visibleGroupedBarSeries } from './cahierFigureReadings'
import {
  POLICES_PDF,
  POLICE_PDF,
  chargerPolicePdf,
  type ChargeurPolicePdf,
} from './cahierPdfFonts'
import {
  dessinerFigurePdf,
  hauteurFigurePdf,
  CahierPdfAssetError,
  type ChargeurImagePdf,
} from './cahierPdfFigures'
import type { MesureTexte } from './cahierPdfMesure'
import { plierTexte } from './cahierPdfMesure'
import { PALETTE_PDF, hexVersRgb } from './cahierPdfPalette'
import {
  EXPLICATION_INDISPONIBLE,
  construireTableauxPdf,
  hauteurTableauPdf,
  separateurVertical,
  type LigneTableauPdf,
  type TableauPdfPart,
} from './cahierPdfTableau'

export class CahierPdfCompositionError extends Error {
  readonly code:
    | 'incomplete-capture'
    | 'unsupported-family'
    | 'asset'
    | 'font'
    | 'serialization'
    | 'layout'
  constructor(code: CahierPdfCompositionError['code'], message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'CahierPdfCompositionError'
    this.code = code
  }
}

/** The same callable shape the #1023 controller already injects. */
export type GenerateurCahierPdf = CahierPdfGenerator

export interface OptionsCompositionCahierPdf {
  readonly signal: AbortSignal
  readonly chargerPolice?: ChargeurPolicePdf
  readonly chargerImage?: ChargeurImagePdf
  /** Live territory/section URL; defaults to the current location when present. */
  readonly urlPublique?: string | null
  /** Home URL for the brand lockup; defaults to the current origin. */
  readonly urlAccueil?: string | null
}

const PAGE = {
  width: 210,
  height: 297,
  margeGauche: 18,
  margeDroite: 18,
  margeHaute: 16,
  margeBasse: 14,
  largeurUtile: 174,
  basSources: 30,
  pied: 9,
  comparaison: 6,
} as const

const TAILLE = {
  titrePage: 16,
  identite: 25,
  identiteSuite: 12,
  comparaison: 13.5,
  prefixeComparaison: 7.5,
  source: 6.2,
  pied: 6.4,
  titreTableaux: 9,
  note: 6.4,
} as const

function verifierAbandon(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
}

function rgb(hex: string): [number, number, number] {
  return hexVersRgb(hex)
}

function setFill(doc: jsPDF, hex: string, opacity = 1): void {
  doc.setFillColor(...rgb(hex))
  doc.setGState(doc.GState({ opacity }))
}

function setStroke(doc: jsPDF, hex: string, opacity = 1): void {
  doc.setDrawColor(...rgb(hex))
  doc.setGState(doc.GState({ 'stroke-opacity': opacity }))
}

function texte(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  options: {
    police: string
    taille: number
    couleur: string
    align?: 'left' | 'center' | 'right'
    baseline?: 'top' | 'middle' | 'alphabetic'
    espacement?: number
  },
): void {
  doc.setGState(doc.GState({ opacity: 1 }))
  doc.setFont(options.police, 'normal')
  doc.setFontSize(options.taille)
  doc.setTextColor(...rgb(options.couleur))
  doc.setCharSpace(options.espacement ?? 0)
  doc.text(value, x, y, {
    align: options.align ?? 'left',
    baseline: options.baseline ?? 'top',
  })
  doc.setCharSpace(0)
}

class MesureJsPdf implements MesureTexte {
  constructor(private readonly doc: jsPDF) {}

  largeur(value: string, police: string, taillePt: number, espacementPt = 0): number {
    this.doc.setFont(police, 'normal')
    this.doc.setFontSize(taillePt)
    this.doc.setCharSpace(espacementPt)
    const width = this.doc.getTextWidth(value)
    this.doc.setCharSpace(0)
    return width
  }

  hauteurLigne(police: string, taillePt: number): number {
    this.doc.setFont(police, 'normal')
    this.doc.setFontSize(taillePt)
    return taillePt * 0.3528 * 1.2
  }

  espace(police: string, taillePt: number): number {
    return this.largeur(' ', police, taillePt)
  }
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let offset = 0; offset < view.length; offset += 8192) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

async function enregistrerPolices(
  doc: jsPDF,
  charger: ChargeurPolicePdf,
  signal: AbortSignal,
): Promise<void> {
  const resultats = await Promise.all(POLICES_PDF.map(async (face) => {
    verifierAbandon(signal)
    const bytes = await charger(face, { signal })
    verifierAbandon(signal)
    return { face, bytes }
  }))
  for (const { face, bytes } of resultats) {
    const magic = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
    const ttf = magic.length === 4 && (
      (magic[0] === 0x00 && magic[1] === 0x01 && magic[2] === 0x00 && magic[3] === 0x00)
      || (magic[0] === 0x4f && magic[1] === 0x54 && magic[2] === 0x54 && magic[3] === 0x4f)
      || (magic[0] === 0x74 && magic[1] === 0x72 && magic[2] === 0x75 && magic[3] === 0x65)
    )
    if (!ttf) {
      throw new Error(`Police PDF invalide (${face.id}) : en-tête TrueType absent.`)
    }
    doc.addFileToVFS(`${face.id}.ttf`, base64(bytes))
    // Each id is a single static face; the italic file already carries its
    // real italic outlines. Registering it as `normal` keeps the face id as
    // the document's only style key and avoids a synthetic-style lookup.
    doc.addFont(`${face.id}.ttf`, face.id, 'normal')
    // Force the parser now, inside the font error boundary: a truncated face
    // must reject the request instead of failing later during layout.
    doc.setFont(face.id, 'normal')
    doc.getTextWidth('Équipements accessibles')
  }
}

function urlParDefaut(capture: CahierExportCapture, hash: string): string | null {
  const location = globalThis.location
  if (!location) return null
  const url = new URL(`/territoire/${capture.identity.territory.type}/${capture.identity.territory.code}`, location.origin)
  for (const [key, value] of new URLSearchParams(location.search)) url.searchParams.set(key, value)
  url.hash = hash
  return url.href
}

function nomFichier(capture: CahierExportCapture): string {
  const slug = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `lusk-cahier-${slug(capture.identity.sectionKey)}-${slug(capture.identity.territory.code)}.pdf`
}

function validerCapture(capture: CahierExportCapture): void {
  if (capture.readiness.status !== 'ready') {
    throw new CahierPdfCompositionError(
      'incomplete-capture',
      `La section n’est pas prête pour un PDF complet (${capture.readiness.reason}).`,
    )
  }
  if (capture.figures.length === 0) {
    throw new CahierPdfCompositionError('incomplete-capture', 'Aucune figure capturée pour le PDF.')
  }
  const supportees = new Set([
    'aedar-ramps',
    'aedar-car-overview',
    'aedar-diversity-loss',
    'aedar-equipment-profile',
    'aedar-equipment-explorer',
    'mobilite-bars',
    'mobilite-share',
    'mobilite-curve',
  ])
  for (const figure of capture.figures) {
    if (!supportees.has(figure.family)) {
      throw new CahierPdfCompositionError(
        'unsupported-family',
        `Famille de figure non prise en charge par le PDF : ${figure.family}.`,
      )
    }
  }
  const maps = capture.capabilities.maps
  if (maps.status === 'pending' || maps.status === 'unknown' || maps.status === 'partial') {
    throw new CahierPdfCompositionError('asset', 'Une carte requise n’est pas encore disponible.')
  }
  if (maps.legend === 'pending' || maps.legend === 'unknown') {
    throw new CahierPdfCompositionError('asset', 'La légende requise n’est pas encore disponible.')
  }
  for (const item of maps.items) {
    if (!item.declared) continue
    if (!item.loaded || item.unavailable || !item.inlineUrl) {
      throw new CahierPdfCompositionError(
        'asset',
        `La carte « ${item.label} » n’est pas disponible pour le PDF.`,
      )
    }
  }
}

interface FigureBloc {
  readonly kind: 'figure'
  readonly projection: CahierFigureProjection
  readonly height: number
}

interface TableBloc {
  readonly kind: 'table'
  readonly part: TableauPdfPart
  readonly rows: readonly LigneTableauPdf[]
  readonly height: number
  readonly continued: boolean
}

interface TextBloc {
  readonly kind: 'text'
  readonly role: 'tables-heading' | 'note' | 'unavailable'
  readonly text: string
  readonly height: number
}

type BlocPdf = FigureBloc | TableBloc | TextBloc

interface PagePdf {
  readonly index: number
  readonly blocks: BlocPdf[]
  readonly continuation: boolean
  readonly hasComparisonProof: boolean
}

interface DocumentPdf {
  readonly pages: readonly PagePdf[]
  readonly sousTitre: SousTitreComparaison | null
  readonly identityHeight: number
  readonly headerHeight: number
  readonly sourcesHeight: number
}

function hauteurTexteSimple(
  texteValue: string,
  mesure: MesureTexte,
  police: string,
  taille: number,
  largeur: number,
): number {
  return plierTexte(texteValue, mesure, { police, taillePt: taille, largeurMax: largeur, casserMotsLongs: true }).length
    * mesure.hauteurLigne(police, taille) * 1.18
}

function socleBas(): number {
  return PAGE.pied + PAGE.comparaison
}

function construireSousTitre(
  capture: CahierExportCapture,
  mesure: MesureTexte,
): SousTitreComparaison | null {
  return sousTitreComparaison(capture.comparison, {
    mesure,
    largeur: PAGE.largeurUtile,
    police: POLICE_PDF.displayStrong,
    taillePt: TAILLE.comparaison,
    policePrefixe: POLICE_PDF.body,
    taillePrefixePt: TAILLE.prefixeComparaison,
  })
}

function hauteurIdentite(
  capture: CahierExportCapture,
  sousTitre: SousTitreComparaison | null,
  mesure: MesureTexte,
): number {
  const lignesFocal = plierTexte(capture.identity.territory.name.toLocaleUpperCase('fr-FR'), mesure, {
    police: POLICE_PDF.displayStrong,
    taillePt: TAILLE.identite,
    largeurMax: PAGE.largeurUtile,
  }).length
  const focal = lignesFocal * mesure.hauteurLigne(POLICE_PDF.displayStrong, TAILLE.identite) * 1.12
  const sous = sousTitre
    ? hauteurSousTitre(sousTitre, {
      mesure,
      police: POLICE_PDF.displayStrong,
      taillePt: TAILLE.comparaison,
      policePrefixe: POLICE_PDF.body,
      taillePrefixePt: TAILLE.prefixeComparaison,
    })
    : 0
  return focal + (sousTitre ? 3 + sous : 0) + 7
}

function sourcesTexte(source: CahierCaptureSource): string {
  const morceaux = [source.label]
  if (source.version && !source.label.includes(source.version)) morceaux.push(source.version)
  if (source.displayVersion && !source.label.includes(source.displayVersion)) morceaux.push(source.displayVersion)
  if (source.referenceDate) morceaux.push(`réf. ${source.referenceDate}`)
  if (source.publicationDate) morceaux.push(`publié ${source.publicationDate}`)
  if (source.licence && !source.label.includes(source.licence)) morceaux.push(source.licence)
  if (source.credit && !source.label.includes(source.credit)) morceaux.push(source.credit)
  return morceaux.join(' · ')
}

function preuveProprietaire(capture: CahierExportCapture, slots: readonly string[]): boolean {
  return capture.comparison.display.state === 'displayed'
    && capture.comparison.display.layers.some((layer) => slots.includes(layer.slot) && layer.displayed)
}

function familySlots(projection: CahierFigureProjection): readonly string[] {
  switch (projection.family) {
    case 'aedar-ramps': return ['comparison']
    case 'aedar-car-overview': return ['comparison']
    case 'aedar-equipment-explorer': return ['comparison', 'distribution']
    case 'aedar-diversity-loss':
    case 'aedar-equipment-profile': return []
    case 'mobilite-bars': return [projection.slot]
    case 'mobilite-share': return ['share']
    case 'mobilite-curve': return ['curve']
  }
}

function preuveFigureComparative(projection: CahierFigureProjection, capture: CahierExportCapture): boolean {
  switch (projection.family) {
    case 'aedar-ramps':
      return preuveProprietaire(capture, ['comparison'])
        && projection.ramps.some((ramp) => ramp.series.some((serie) => serie.points.some(
          (point) => point.referenceValue !== null || point.referenceRank !== null,
        )))
    case 'aedar-car-overview':
      return preuveProprietaire(capture, ['comparison'])
        && projection.scalars.some((scalar) => scalar.reference !== null || scalar.rank !== null)
    case 'aedar-equipment-explorer': {
      const distribution = visibleGroupedBarSeries(
        projection.distribution.figure,
        projection.distribution.hiddenSeriesKeys,
      )
      return preuveProprietaire(capture, ['comparison', 'distribution'])
        && (projection.volume.series.some((serie) => serie.points.some((point) => point.referenceValue !== null))
          || distribution.some((serie) => Boolean(serie.comparisonFor) && serie.values.some((value) => value !== null)))
    }
    case 'aedar-diversity-loss':
    case 'aedar-equipment-profile':
      return false
    case 'mobilite-bars': {
      const comparisonKeys = new Set(tableColumnsComparison(projection))
      return preuveProprietaire(capture, [projection.slot])
        && projection.tables.some((table) => table.rows.some((row) => row.cells.some((cell) => (
          comparisonKeys.has(cell.columnKey) && (cell.value !== null || cell.rankDisplay !== null)
        ))))
    }
    case 'mobilite-share':
      return preuveProprietaire(capture, ['share'])
        && (projection.comparisonValue !== null || projection.comparisonRank !== null)
    case 'mobilite-curve':
      return preuveProprietaire(capture, ['curve'])
        && (projection.points.some((point) => point.comparisonValue !== null || point.comparisonRank !== null)
          || (projection.marker?.rank ?? null) !== null)
  }
}

function tableColumnsComparison(projection: Extract<CahierFigureProjection, { family: 'mobilite-bars' }>): readonly string[] {
  return projection.tables.flatMap((table) => table.columns
    .filter((column) => column.kind === 'comparison')
    .map((column) => column.key))
}

function construirePages(
  request: CahierExportRequest,
  mesure: MesureTexte,
): DocumentPdf {
  const capture = request.capture
  const projections = projeterRequeteExportFigures(request)
  const sousTitre = construireSousTitre(capture, mesure)
  const titresDistribution = new Map(
    capture.figures
      .filter((figure) => figure.family === 'aedar-equipment-explorer')
      .map((figure) => [figure.slot, figure.model.distributionFigureTitle]),
  )
  const headerHeight = 25
  const identityHeight = hauteurIdentite(capture, sousTitre, mesure)
  const sourcesLines = capture.sources.map((source) => plierTexte(
    `Source(s) : ${sourcesTexte(source)}`,
    mesure,
    { police: POLICE_PDF.meta, taillePt: TAILLE.source, largeurMax: 104, casserMotsLongs: true },
  )).flat().map((ligne) => ligne.texte)
  const sourcesHeight = Math.max(4, sourcesLines.length * mesure.hauteurLigne(POLICE_PDF.meta, TAILLE.source) * 1.2)
  const reservePied = socleBas()
  const sousTitreHauteur = sousTitre
    ? hauteurSousTitre(sousTitre, {
      mesure,
      police: POLICE_PDF.displayStrong,
      taillePt: TAILLE.comparaison,
      policePrefixe: POLICE_PDF.body,
      taillePrefixePt: TAILLE.prefixeComparaison,
    }) + 3
    : 0
  const availableFirst = PAGE.height - PAGE.margeBasse - PAGE.margeHaute - headerHeight - identityHeight - sourcesHeight - reservePied
  const availableNext = PAGE.height - PAGE.margeBasse - PAGE.margeHaute - headerHeight - 8 - sousTitreHauteur - sourcesHeight - reservePied

  const blocks: BlocPdf[] = []
  const messagesVus = new Set<string>()
  for (const projection of projections) {
    blocks.push({
      kind: 'figure',
      projection,
      height: hauteurFigurePdf(projection, PAGE.largeurUtile, mesure, {
        comparisonProof: preuveFigureComparative(projection, capture),
        ...(titresDistribution.has(projection.slot)
          ? { distributionTitle: titresDistribution.get(projection.slot) }
          : {}),
      }),
    })
    for (const item of projection.unavailable) {
      if (messagesVus.has(item.message)) continue
      messagesVus.add(item.message)
      blocks.push({
        kind: 'text',
        role: 'unavailable',
        text: item.message,
        height: hauteurTexteSimple(item.message, mesure, POLICE_PDF.body, TAILLE.note, PAGE.largeurUtile) + 1,
      })
    }
  }

  const tableParts = projections.flatMap((projection) => projection.tables.flatMap((table) => (
    construireTableauxPdf(table, {
      mesure,
      largeurDisponible: PAGE.largeurUtile,
      nomTerritoire: capture.identity.territory.name,
      ownerDisplayed: preuveProprietaire(capture, familySlots(projection)),
    })
  ))).filter((part) => part.rows.length > 0)
  if (tableParts.length) {
    const libelle = tableParts.length > 1 ? 'Valeurs des graphiques' : 'Valeurs du graphique'
    blocks.push({
      kind: 'text',
      role: 'tables-heading',
      text: libelle,
      height: mesure.hauteurLigne(POLICE_PDF.bodyStrong, TAILLE.titreTableaux) * 1.4 + 2,
    })
    for (const part of tableParts) {
      blocks.push({
        kind: 'table',
        part,
        rows: part.rows,
        height: hauteurTableauPdf(part),
        continued: false,
      })
    }
    const notes = [...new Set(tableParts.flatMap((part) => part.notes))]
    for (const note of notes) {
      if (messagesVus.has(note)) continue
      messagesVus.add(note)
      blocks.push({
        kind: 'text',
        role: 'note',
        text: note,
        height: hauteurTexteSimple(note, mesure, POLICE_PDF.body, TAILLE.note, PAGE.largeurUtile) + 1,
      })
    }
    if (tableParts.some((part) => part.abbreviatedUnavailable)) {
      if (!messagesVus.has(EXPLICATION_INDISPONIBLE)) {
        messagesVus.add(EXPLICATION_INDISPONIBLE)
        blocks.push({
          kind: 'text',
          role: 'note',
          text: EXPLICATION_INDISPONIBLE,
          height: hauteurTexteSimple(EXPLICATION_INDISPONIBLE, mesure, POLICE_PDF.body, TAILLE.note, PAGE.largeurUtile) + 1,
        })
      }
    }
  }

  const pagesBrutes: PagePdf[] = []
  let page: { blocks: BlocPdf[]; remaining: number } = { blocks: [], remaining: availableFirst }
  let continuation = false
  const nouvellePage = () => {
    pagesBrutes.push({ index: pagesBrutes.length, blocks: page.blocks, continuation, hasComparisonProof: false })
    page = { blocks: [], remaining: availableNext }
    continuation = true
  }
  const poserBloc = (bloc: BlocPdf) => {
    page.blocks.push(bloc)
    page.remaining -= bloc.height
  }

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const bloc = blocks[blockIndex]!
    if (bloc.kind === 'table') {
      let rows = [...bloc.rows]
      let first = true
      while (rows.length) {
        const suite = !first || bloc.continued ? 2.8 : 0
        const hauteurEntete = bloc.part.titleLines.length * 6.4 * 0.3528 * 1.2
          + bloc.part.headerHeight + 2 + suite + (bloc.part.unit ? 2.4 : 0)
        if (page.remaining < hauteurEntete + (rows[0]?.height ?? 0)) {
          if (!page.blocks.length) {
            throw new CahierPdfCompositionError('layout', 'Un tableau ne peut pas commencer sur la page.')
          }
          nouvellePage()
        }
        let index = 0
        let hauteur = hauteurEntete
        while (index < rows.length && hauteur + rows[index]!.height <= page.remaining) {
          hauteur += rows[index]!.height
          index += 1
        }
        if (index === 0) {
          throw new CahierPdfCompositionError('layout', 'Une ligne de tableau dépasse la page utile.')
        }
        poserBloc({
          kind: 'table',
          part: bloc.part,
          rows: rows.slice(0, index),
          height: hauteur,
          continued: !first || bloc.continued,
        })
        rows = rows.slice(index)
        first = false
        if (rows.length) nouvellePage()
      }
      continue
    }
    if (bloc.kind === 'text' && bloc.role === 'tables-heading') {
      const suite = blocks[blockIndex + 1]
      if (suite?.kind === 'table' && page.blocks.length) {
        const hauteurEntete = suite.part.titleLines.length * 6.4 * 0.3528 * 1.2
          + suite.part.headerHeight + 2 + (suite.rows[0]?.height ?? 0)
        if (page.remaining < bloc.height + hauteurEntete) {
          nouvellePage()
        }
      }
    }
    if (bloc.height > page.remaining) {
      if (!page.blocks.length) {
        throw new CahierPdfCompositionError('layout', 'Un bloc dépasse la page utile.')
      }
      nouvellePage()
      if (bloc.height > page.remaining) {
        throw new CahierPdfCompositionError('layout', 'Un bloc dépasse la page utile après saut.')
      }
    }
    poserBloc(bloc)
  }
  pagesBrutes.push({ index: pagesBrutes.length, blocks: page.blocks, continuation, hasComparisonProof: false })

  // A comparison footer/heading appears only on a page that actually carries
  // comparative marks (a table column or a figure layer), never as residual.
  const pages: PagePdf[] = pagesBrutes.map((candidate) => ({
    ...candidate,
    hasComparisonProof: candidate.blocks.some((bloc) => {
      if (bloc.kind === 'figure') return preuveFigureComparative(bloc.projection, capture)
      if (bloc.kind === 'table') return bloc.part.hasComparison
      return false
    }),
  }))

  return {
    pages,
    sousTitre: pages.some((candidate) => candidate.hasComparisonProof) ? sousTitre : null,
    identityHeight,
    headerHeight,
    sourcesHeight,
  }
}

async function dessinerMarque(doc: jsPDF, x: number, y: number): Promise<void> {
  // The lockup is drawn from the locked brand paths; the wordmark uses the
  // Newsreader face actually embedded in the document.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', MARQUE_LUSK_ERMINE.viewBox)
  for (const path of MARQUE_LUSK_ERMINE.chemins) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    node.setAttribute('d', path.d)
    node.setAttribute('fill', REMPLISSAGES_MARQUE_LUSK[path.role])
    svg.append(node)
  }
  const painter = doc as jsPDF & { svg: (element: Element, options: { x: number; y: number; width: number; height: number }) => Promise<unknown> }
  await painter.svg(svg, { x, y, width: 13, height: 7.2 })
  texte(doc, 'lusk', x + 14, y - 0.2, {
    police: POLICE_PDF.wordmark,
    taille: 15,
    couleur: PALETTE_PDF.ink,
    baseline: 'top',
  })
}

async function dessinerEntete(
  doc: jsPDF,
  capture: CahierExportCapture,
  mesure: MesureTexte,
  urlAccueil: string | null,
  urlPublique: string | null,
  signal: AbortSignal,
): Promise<void> {
  setFill(doc, PALETTE_PDF.paper)
  doc.rect(0, 0, PAGE.width, PAGE.height, 'F')
  // Notebook margin rule, then the approved header rule.
  setStroke(doc, PALETTE_PDF.marginSoft)
  doc.setLineWidth(0.2)
  doc.line(14, 10, 14, PAGE.height - 10)
  await dessinerMarque(doc, PAGE.margeGauche, PAGE.margeHaute - 2)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (urlAccueil) doc.link(PAGE.margeGauche, PAGE.margeHaute - 3, 26, 9, { url: urlAccueil })
  const titre = capture.identity.unit.label
  texte(doc, titre, PAGE.width / 2, PAGE.margeHaute - 1, {
    police: POLICE_PDF.display,
    taille: TAILLE.titrePage,
    couleur: PALETTE_PDF.ink,
    align: 'center',
  })
  const territory = capture.identity.territory.name
  const largeurTerritory = mesure.largeur(territory, POLICE_PDF.bodyStrong, 7.5)
  const tx = PAGE.width - PAGE.margeDroite - largeurTerritory - 5
  texte(doc, territory, tx, PAGE.margeHaute, {
    police: POLICE_PDF.bodyStrong,
    taille: 7.5,
    couleur: PALETTE_PDF.margin,
  })
  // Small external-link arrow; the whole territory+arrow is the live link.
  setStroke(doc, PALETTE_PDF.margin)
  doc.setLineWidth(0.25)
  const ax = PAGE.width - PAGE.margeDroite - 2.6
  const ay = PAGE.margeHaute + 0.7
  doc.line(ax, ay + 1.4, ax + 1.4, ay)
  doc.line(ax, ay, ax + 1.4, ay)
  doc.line(ax + 1.4, ay, ax + 1.4, ay + 1.4)
  if (urlPublique) doc.link(tx - 1, PAGE.margeHaute - 2, largeurTerritory + 8, 6, { url: urlPublique })
  setStroke(doc, PALETTE_PDF.marginSoft)
  doc.setLineWidth(0.35)
  doc.line(PAGE.margeGauche, PAGE.margeHaute + 9, PAGE.width - PAGE.margeDroite, PAGE.margeHaute + 9)
}

function dessinerIdentite(
  doc: jsPDF,
  capture: CahierExportCapture,
  sousTitre: SousTitreComparaison | null,
  mesure: MesureTexte,
  y: number,
  large: boolean,
  urlPublique: string | null,
): number {
  const nom = capture.identity.territory.name.toLocaleUpperCase('fr-FR')
  const taille = large ? TAILLE.identite : TAILLE.identiteSuite
  const lignes = plierTexte(nom, mesure, {
    police: POLICE_PDF.displayStrong,
    taillePt: taille,
    largeurMax: PAGE.largeurUtile,
  })
  let cy = y
  const hauteur = mesure.hauteurLigne(POLICE_PDF.displayStrong, taille) * 1.12
  for (const ligne of lignes) {
    texte(doc, ligne.texte, PAGE.width / 2, cy, {
      police: POLICE_PDF.displayStrong,
      taille,
      couleur: PALETTE_PDF.ink,
      align: 'center',
    })
    cy += hauteur
  }
  if (large && urlPublique) {
    doc.link(PAGE.margeGauche, y - 1, PAGE.largeurUtile, cy - y, { url: urlPublique })
  }
  if (sousTitre) {
    cy += 1.5
    const lineHeight = mesure.hauteurLigne(POLICE_PDF.displayStrong, TAILLE.comparaison) * 1.18
    for (const ligne of sousTitre.lignes) {
      let cx = PAGE.width / 2
      const largeurLigne = ligne.reduce((total, run) => total + mesure.largeur(
        run.texte,
        run.kind === 'prefix' ? POLICE_PDF.body : POLICE_PDF.displayStrong,
        run.kind === 'prefix' ? TAILLE.prefixeComparaison : TAILLE.comparaison,
      ) + (run.kind === 'prefix' ? 1.2 : 0), 0)
      cx -= largeurLigne / 2
      for (const run of ligne) {
        const police = run.kind === 'prefix' ? POLICE_PDF.body : POLICE_PDF.displayStrong
        const tailleRun = run.kind === 'prefix' ? TAILLE.prefixeComparaison : TAILLE.comparaison
        texte(doc, run.texte, cx, cy, {
          police,
          taille: tailleRun,
          couleur: run.kind === 'prefix' ? PALETTE_PDF.muted : PALETTE_PDF.ink,
        })
        cx += mesure.largeur(run.texte, police, tailleRun) + (run.kind === 'prefix' ? 1.2 : 0)
      }
      cy += lineHeight
    }
  }
  return cy + 3
}

function dessinerTableau(
  doc: jsPDF,
  mesure: MesureTexte,
  part: TableauPdfPart,
  rows: readonly LigneTableauPdf[],
  x: number,
  y: number,
  width: number,
  continued: boolean,
): number {
  let cy = y
  for (const ligne of part.titleLines) {
    texte(doc, ligne, x + width / 2, cy, {
      police: POLICE_PDF.bodyStrong,
      taille: 8,
      couleur: PALETTE_PDF.ink,
      align: 'center',
    })
    cy += 3.2
  }
  if (continued) {
    texte(doc, '(suite)', x + width / 2, cy, {
      police: POLICE_PDF.body,
      taille: 6,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
    cy += 2.8
  } else {
    cy += 1.2
  }
  if (part.unit) {
    texte(doc, `Unité : ${part.unit}`, x + width / 2, cy, {
      police: POLICE_PDF.body,
      taille: 6,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
    cy += 2.4
  }
  const enteteTop = cy
  // Header row: the row-label column is distinct; data headers start over
  // their actual data cells, not over the row-label column.
  let cx = x + part.rowLabelWidth
  for (const colonne of part.columns) {
    const align = colonne.column.kind === 'comparison' ? 'left' : 'left'
    let hy = cy
    for (const [lineIndex, ligne] of colonne.headerLines.entries()) {
      texte(doc, ligne, cx + 1, hy, {
        police: POLICE_PDF.bodyStrong,
        taille: 6.4,
        couleur: PALETTE_PDF.ink,
        align,
      })
      if (colonne.column.kind === 'comparison' && part.hasComparison && lineIndex === colonne.headerLines.length - 1) {
        texte(doc, '¹', cx + 1 + mesure.largeur(ligne, POLICE_PDF.bodyStrong, 6.4) + 0.6, hy, {
          police: POLICE_PDF.meta,
          taille: 5.4,
          couleur: PALETTE_PDF.muted,
        })
      }
      hy += 2.4
    }
    cx += colonne.width
  }
  cy = enteteTop + part.headerHeight
  // Light rule under the header, plus the section's red-margin accent.
  setStroke(doc, PALETTE_PDF.marginSoft)
  doc.setLineWidth(0.35)
  doc.line(x, cy, x + width, cy)
  // Vertical rules between mode/column groups, spanning the header and every
  // row block on this page part.
  const hauteurLignes = rows.reduce((sum, row) => sum + row.height, 0)
  for (let index = 0; index < part.columns.length; index += 1) {
    if (!separateurVertical(part.columns, index)) continue
    const ruleX = x + part.rowLabelWidth + part.columns.slice(0, index).reduce((sum, colonne) => sum + colonne.width, 0)
    setStroke(doc, PALETTE_PDF.muted, 0.45)
    doc.setLineWidth(0.2)
    doc.line(ruleX, enteteTop, ruleX, cy + hauteurLignes)
  }
  // Rows: complete cells, all relationships retained.
  for (const row of rows) {
    let cellX = x
    let rh = 0
    row.labelLines.forEach((ligne, index) => {
      texte(doc, ligne, cellX + 1, cy + 1 + index * 2.5, {
        police: POLICE_PDF.body,
        taille: 7,
        couleur: PALETTE_PDF.ink,
      })
    })
    rh = Math.max(rh, row.labelLines.length * 2.5)
    cellX += part.rowLabelWidth
    for (let index = 0; index < part.columns.length; index += 1) {
      const colonne = part.columns[index]!
      const cellule = row.cells[index]!
      const lignes = plierTexte(cellule.display, mesure, {
        police: POLICE_PDF.value,
        taillePt: 7,
        largeurMax: colonne.width - 2,
        casserMotsLongs: cellule.cell.value === null,
      })
      lignes.forEach((ligne, ligneIndex) => {
        texte(doc, ligne.texte, cellX + 1, cy + 1 + ligneIndex * 2.5, {
          police: POLICE_PDF.value,
          taille: 7,
          couleur: PALETTE_PDF.ink,
        })
      })
      rh = Math.max(rh, lignes.length * 2.5)
      if (cellule.rankDisplay) {
        texte(doc, cellule.rankDisplay, cellX + 1, cy + 1 + lignes.length * 2.5, {
          police: POLICE_PDF.meta,
          taille: 5.6,
          couleur: PALETTE_PDF.brand200,
        })
        rh = Math.max(rh, lignes.length * 2.5 + 2.2)
      }
      cellX += colonne.width
    }
    setStroke(doc, PALETTE_PDF.borderLight)
    doc.setLineWidth(0.15)
    doc.line(x, cy + row.height - 0.4, x + width, cy + row.height - 0.4)
    cy += row.height
  }
  return cy - y
}

function dessinerSources(
  doc: jsPDF,
  capture: CahierExportCapture,
  mesure: MesureTexte,
  sourcesHeight: number,
  y: number,
  largeur: number,
): void {
  let cy = y
  for (let index = 0; index < capture.sources.length; index += 1) {
    const source = capture.sources[index]!
    const texteSource = `${index === 0 ? 'Source(s) : ' : ''}${sourcesTexte(source)}`
    const lignes = plierTexte(texteSource, mesure, {
      police: POLICE_PDF.meta,
      taillePt: TAILLE.source,
      largeurMax: largeur,
      casserMotsLongs: true,
    })
    for (const ligne of lignes) {
      texte(doc, ligne.texte, PAGE.width - PAGE.margeDroite, cy, {
        police: POLICE_PDF.meta,
        taille: TAILLE.source,
        couleur: PALETTE_PDF.muted,
        align: 'right',
      })
      if (source.url) {
        const width = mesure.largeur(ligne.texte, POLICE_PDF.meta, TAILLE.source)
        doc.link(PAGE.width - PAGE.margeDroite - width, cy - 0.5, width, 2.6, { url: source.url })
      }
      cy += mesure.hauteurLigne(POLICE_PDF.meta, TAILLE.source) * 1.2
    }
  }
  void sourcesHeight
}

function dessinerPied(
  doc: jsPDF,
  page: number,
  total: number,
  capture: CahierExportCapture,
  urlAccueil: string | null,
  hasComparisonProof: boolean,
): void {
  const footerY = PAGE.height - PAGE.margeBasse - 1
  if (hasComparisonProof && capture.comparison.group) {
    const group = capture.comparison.group.label ?? capture.comparison.group.names.join(', ')
    if (group) {
      texte(doc, `¹ Groupe comparé : ${group}`, PAGE.margeGauche, footerY - 6.2, {
        police: POLICE_PDF.body,
        taille: TAILLE.note,
        couleur: PALETTE_PDF.muted,
      })
    }
  }
  const host = urlAccueil ? new URL(urlAccueil).host : 'lusk'
  const invitation = `Retrouvez les cartes et explorez les données sur ${host}`
  texte(doc, invitation, PAGE.margeGauche, footerY, {
    police: POLICE_PDF.body,
    taille: TAILLE.pied,
    couleur: PALETTE_PDF.muted,
  })
  if (urlAccueil) doc.link(PAGE.margeGauche, footerY - 1, 86, 3.4, { url: urlAccueil })
  texte(doc, `${page} / ${total}`, PAGE.width - PAGE.margeDroite, footerY, {
    police: POLICE_PDF.body,
    taille: TAILLE.pied,
    couleur: PALETTE_PDF.muted,
    align: 'right',
  })
}

async function creerChargeurImageParDefaut(): Promise<ChargeurImagePdf> {
  return async (url, { signal }) => {
    const response = await fetch(url, { signal })
    if (!response.ok) {
      throw new CahierPdfCompositionError('asset', `Carte introuvable : ${url} (HTTP ${response.status}).`)
    }
    const blob = await response.blob()
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      try {
        verifierAbandon(signal)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (!context) throw new CahierPdfCompositionError('asset', `Décodage de la carte impossible : ${url}.`)
        context.drawImage(bitmap, 0, 0)
        return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
      } finally {
        bitmap.close()
      }
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new CahierPdfCompositionError('asset', `Lecture de la carte impossible : ${url}.`))
      reader.readAsDataURL(blob)
    })
    return { dataUrl, width: 0, height: 0 }
  }
}

/**
 * Public generation seam. Lazy-imports jsPDF/svg2pdf only when a file is
 * actually requested; the app's initial bundle does not carry them.
 */
export async function composerCahierPdf(
  request: CahierExportRequest,
  options: OptionsCompositionCahierPdf,
): Promise<CahierPdfArtifact> {
  const { signal } = options
  verifierAbandon(signal)
  const capture = request.capture
  validerCapture(capture)

  const [{ jsPDF }, _svg2pdf] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ])
  void _svg2pdf
  verifierAbandon(signal)

  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
    putOnlyUsedFonts: true,
    compress: true,
  })
  doc.setProperties({
    title: `${capture.identity.sectionLabel} — ${capture.identity.territory.name}`,
    subject: capture.identity.sectionLabel,
    author: 'Lusk',
    creator: 'Lusk — Cahier PDF',
    keywords: [
      capture.identity.sectionKey,
      capture.identity.territory.type,
      capture.identity.territory.code,
      capture.identity.unit.label,
    ].join(', '),
  })
  const setLanguage = (doc as jsPDF & { setLanguage?: (lang: string) => void }).setLanguage
  if (setLanguage) setLanguage.call(doc, 'fr-FR')

  try {
    await enregistrerPolices(doc, options.chargerPolice ?? chargerPolicePdf, signal)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new CahierPdfCompositionError('font', 'Les polices embarquées du PDF n’ont pas pu être chargées.', error)
  }
  const mesure = new MesureJsPdf(doc)
  const documentPdf = construirePages(request, mesure)
  const chargerImageBase = options.chargerImage ?? await creerChargeurImageParDefaut()
  const chargerImage: ChargeurImagePdf = async (url, loadOptions) => {
    try {
      return await chargerImageBase(url, loadOptions)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (error instanceof CahierPdfCompositionError) throw error
      throw new CahierPdfCompositionError('asset', `La carte « ${url} » n’a pas pu être lue.`, error)
    }
  }
  const urlAccueil = options.urlAccueil ?? (globalThis.location ? new URL('/', globalThis.location.origin).href : null)
  const urlPublique = options.urlPublique
    ?? urlParDefaut(capture, `section-${capture.identity.sectionKey}`)
  const modelesBars = new Map(
    capture.figures
      .filter((figure) => figure.family === 'mobilite-bars')
      .map((figure) => [figure.slot, figure.model.figure]),
  )
  const modelesCourbes = new Map(
    capture.figures
      .filter((figure) => figure.family === 'mobilite-curve')
      .map((figure) => [figure.slot, figure.model]),
  )
  const titresDistribution = new Map(
    capture.figures
      .filter((figure) => figure.family === 'aedar-equipment-explorer')
      .map((figure) => [figure.slot, figure.model.distributionFigureTitle]),
  )
  const unitesDistribution = new Map(
    capture.figures
      .filter((figure) => figure.family === 'aedar-equipment-explorer')
      .map((figure) => [figure.slot, figure.model.distributionValueUnit]),
  )
  const total = documentPdf.pages.length
  try {
  for (let index = 0; index < documentPdf.pages.length; index += 1) {
    verifierAbandon(signal)
    const page = documentPdf.pages[index]!
    if (index > 0) doc.addPage('a4', 'portrait')
    await dessinerEntete(doc, capture, mesure, urlAccueil, urlPublique, signal)
    let top = PAGE.margeHaute + documentPdf.headerHeight
    if (index === 0) {
      top = dessinerIdentite(
        doc,
        capture,
        page.hasComparisonProof ? documentPdf.sousTitre : null,
        mesure,
        top + 3,
        true,
        urlPublique,
      )
    } else {
      top = dessinerIdentite(
        doc,
        capture,
        page.hasComparisonProof ? documentPdf.sousTitre : null,
        mesure,
        top + 2,
        false,
        urlPublique,
      )
    }
    const reserveBas = documentPdf.sourcesHeight + PAGE.pied + PAGE.comparaison + 4
    const hauteurContenu = page.blocks.reduce((sum, bloc) => sum + bloc.height, 0)
    const disponible = PAGE.height - PAGE.margeBasse - reserveBas - top
    const decalage = Math.max(0, (disponible - hauteurContenu) / 2)
    let cy = top + decalage
    for (const bloc of page.blocks) {
      verifierAbandon(signal)
      if (bloc.kind === 'figure') {
        const modele = modelesBars.get(bloc.projection.slot)
        const modeleCourbe = modelesCourbes.get(bloc.projection.slot)
        const distributionTitle = titresDistribution.get(bloc.projection.slot)
        try {
          cy += await dessinerFigurePdf({
            doc,
            mesure,
            x: PAGE.margeGauche,
            y: cy,
            width: PAGE.largeurUtile,
            signal,
            chargerImage,
            comparisonProof: preuveFigureComparative(bloc.projection, capture),
            ...(modele ? { modeleBars: modele } : {}),
            ...(modeleCourbe ? { modeleCourbe: modeleCourbe as never } : {}),
            ...(distributionTitle ? { distributionTitle } : {}),
            ...(unitesDistribution.get(bloc.projection.slot)
              ? { distributionUnit: unitesDistribution.get(bloc.projection.slot) }
              : {}),
          }, bloc.projection)
        } catch (error) {
          if (error instanceof CahierPdfAssetError) {
            throw new CahierPdfCompositionError('asset', error.message, error)
          }
          throw error
        }
      } else if (bloc.kind === 'table') {
        const start = cy
        dessinerTableau(doc, mesure, bloc.part, bloc.rows, PAGE.margeGauche, cy, PAGE.largeurUtile, bloc.continued)
        cy = start + bloc.height
      } else {
        const align = bloc.role === 'tables-heading' ? 'center' : 'left'
        const police = bloc.role === 'tables-heading' ? POLICE_PDF.bodyStrong : POLICE_PDF.body
        const taille = bloc.role === 'tables-heading' ? TAILLE.titreTableaux : TAILLE.note
        const couleur = bloc.role === 'tables-heading' ? PALETTE_PDF.ink : PALETTE_PDF.muted
        const lignes = plierTexte(bloc.text, mesure, {
          police,
          taillePt: taille,
          largeurMax: PAGE.largeurUtile,
          casserMotsLongs: true,
        })
        const start = cy
        for (const ligne of lignes) {
          texte(doc, ligne.texte, align === 'center' ? PAGE.width / 2 : PAGE.margeGauche, cy, {
            police,
            taille,
            couleur,
            align,
          })
          cy += mesure.hauteurLigne(police, taille) * 1.18
        }
        cy = start + bloc.height
      }
    }
    // The only permitted unavailable abbreviation is explained once, under the
    // tables, by an explicit note block in the flow (never a lost footnote).
    dessinerSources(
      doc,
      capture,
      mesure,
      documentPdf.sourcesHeight,
      PAGE.height - PAGE.margeBasse - PAGE.pied - PAGE.comparaison - documentPdf.sourcesHeight - 1,
      104,
    )
    dessinerPied(doc, index + 1, total, capture, urlAccueil, page.hasComparisonProof)
  }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof CahierPdfCompositionError) throw error
    throw new CahierPdfCompositionError('serialization', 'La composition du PDF a échoué.', error)
  }
  verifierAbandon(signal)
  let blob: Blob
  try {
    blob = doc.output('blob')
  } catch (error) {
    throw new CahierPdfCompositionError('serialization', 'La sérialisation du PDF a échoué.', error)
  }
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new CahierPdfCompositionError('serialization', 'Le PDF généré est vide.')
  }
  return { blob, fileName: nomFichier(capture) }
}

/** Factory used by the integration lot; no production download is wired here. */
export function creerGenerateurCahierPdf(
  overrides: Omit<OptionsCompositionCahierPdf, 'signal'> = {},
): GenerateurCahierPdf {
  return (request, { signal }) => composerCahierPdf(request, { ...overrides, signal })
}
