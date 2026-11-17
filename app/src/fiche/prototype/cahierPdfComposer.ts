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

import { MARQUE_LUSK_ERMINE, MARQUE_LUSK_LOCKUP, REMPLISSAGES_MARQUE_LUSK, sommetErmineEm } from '@/components/luskBrandMark'

import type { CahierPdfArtifact, CahierPdfGenerator } from './cahierPdfExportController'
import type { CahierFigureProjection } from './cahierExportAdapters'
import { projeterRequeteExportFigures } from './cahierExportAdapters'
import type {
  CahierCaptureFigure,
  CahierCaptureSource,
  CahierExportCapture,
  CahierExportRequest,
} from './cahierExportCapture'
import {
  sousTitreComparaison,
  type SousTitreComparaison,
} from './cahierPdfComparaison'
import {
  LARGEUR_CORPS_PT,
  PAGE_APPROUVEE,
  PADDING_SECTION_PT,
  ROLE_PDF,
  RYTHME_PX,
  mmDepuisPt,
  ptDepuisCssPx,
  rythmePt,
} from './cahierPdfGrammaire'
import { visibleGroupedBarSeries } from './cahierFigureReadings'
import {
  POLICES_PDF,
  chargerPolicePdf,
  type ChargeurPolicePdf,
} from './cahierPdfFonts'
import {
  dessinerFigurePdf,
  figureRowGeometry,
  hauteurFigurePdf,
  CahierPdfAssetError,
  type ChargeurImagePdf,
  type OptionsFigurePdfLiaison,
} from './cahierPdfFigures'
import { figureRowLayout } from './cahierFigureNativeGeometry'
import type { MesureTexte } from './cahierPdfMesure'
import { plierTexte } from './cahierPdfMesure'
import { PALETTE_PDF, couleurPdf, hexVersRgb } from './cahierPdfPalette'
import {
  EXPLICATION_INDISPONIBLE,
  ESPACE_TABLEAU,
  CahierPdfTableLayoutError,
  construireTableauxPdf,
  hauteurEnteteTableau,
  separateurVertical,
  type LigneTableauPdf,
  type TableauPdfPart,
} from './cahierPdfTableau'

export class CahierPdfCompositionError extends Error {
  readonly code:
    | 'incomplete-capture'
    | 'inconsistent-capture'
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

const mm = mmDepuisPt

/**
 * The approved footer flow (`desktop.js:613-617`): the comparison line is an
 * alphabetic baseline at H-35, the invitation at H-23 and the page number at
 * H-24. The 12 pt delta is the footer's own line pitch, used to stack a
 * wrapped group note upwards without inventing a conditional offset.
 */
const PIED = {
  interligne: mm(PAGE_APPROUVEE.hauteurPt - 23) - mm(PAGE_APPROUVEE.hauteurPt - 35),
  reserveHaut: mm(3),
} as const

/**
 * Approved A4 box (points → mm). The content box is the desktop column at the
 * approved reading scale; the header lives above it, the footer below it.
 */
const PAGE = {
  width: 210,
  height: 297,
  margeGauche: mm(PAGE_APPROUVEE.insetGauchePt),
  margeDroite: mm(PAGE_APPROUVEE.insetDroitPt),
  contenuHaut: mm(PAGE_APPROUVEE.hautContenuPt),
  contenuBas: mm(PAGE_APPROUVEE.hauteurPt - PAGE_APPROUVEE.basContenuPt),
  largeurUtile: mm(PAGE_APPROUVEE.largeurUtilePt),
  paddingSection: mm(PADDING_SECTION_PT),
  largeurCorps: mm(LARGEUR_CORPS_PT),
  corpsX: mm(PAGE_APPROUVEE.insetGauchePt + PADDING_SECTION_PT),
  enteteHaut: mm(PAGE_APPROUVEE.hautEnTetePt),
  filetEntete: mm(PAGE_APPROUVEE.filetEnTetePt),
  piedComparaison: mm(PAGE_APPROUVEE.hauteurPt - 35),
  piedInvitation: mm(PAGE_APPROUVEE.hauteurPt - 23),
  piedNumero: mm(PAGE_APPROUVEE.hauteurPt - 24),
} as const

/** Source rhythm in mm, named by its CSS-px role. */
const ESPACE = {
  titreTableauxHaut: mm(rythmePt(RYTHME_PX.titreTableauxHaut)),
  titreTableauxBas: mm(rythmePt(RYTHME_PX.titreTableauxBas)),
  entreTableaux: mm(rythmePt(RYTHME_PX.entreTableaux)),
  sousTitreTableauBas: mm(rythmePt(RYTHME_PX.sousTitreTableauBas)),
  sourcesHaut: mm(rythmePt(RYTHME_PX.sourcesHaut)),
  identiteSousTitre: mm(rythmePt(RYTHME_PX.identiteSousTitre)),
  apresIdentite: mm(rythmePt(RYTHME_PX.apresIdentite)),
} as const

/**
 * Approved access-table grid (`desktop.js:197`):
 * `grid-template-columns: repeat(2, minmax(0,1fr)); gap: 24px`.
 * The measured page box reproduces those two equal columns and the source gap.
 */
const PAIRE_TABLEAUX = {
  gap: mm(ptDepuisCssPx(24)),
  largeur: (mm(LARGEUR_CORPS_PT) - mm(ptDepuisCssPx(24))) / 2,
} as const

/** The same approved two-column grid in points, for the contract tests. */
export const PAIRE_TABLEAUX_PT = {
  gap: ptDepuisCssPx(24),
  largeur: (LARGEUR_CORPS_PT - ptDepuisCssPx(24)) / 2,
} as const

const TAILLE = {
  titrePage: ROLE_PDF.titrePage.taille,
  identite: ROLE_PDF.identite.taille,
  comparaison: ROLE_PDF.comparaisonNom.taille,
  prefixeComparaison: ROLE_PDF.comparaisonPrefixe.taille,
  source: ROLE_PDF.source.taille,
  pied: ROLE_PDF.pied.taille,
  titreTableaux: ROLE_PDF.titreTableau.taille,
  note: 6.4,
} as const

/** `line-height: 26px` of the approved comparison subtitle line box. */
const LIGNE_COMPARAISON = mm(ptDepuisCssPx(26))
/** `line-height: 1` of `--text-page-heading`. */
const LIGNE_IDENTITE = mm(TAILLE.identite)
/** Ascent of the embedded display face, measured on the approved artifacts. */
const ASCENTE_DISPLAY = 0.945

function espaceTexte(taille: number, em: number): number {
  return taille * em
}

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

function largeurAvancePdf(doc: jsPDF, value: string, espacement: number): number {
  let total = 0
  for (const caractere of Array.from(value)) total += doc.getTextWidth(caractere)
  return total + mm(espacement) * Array.from(value).length
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
  const espacement = options.espacement ?? 0
  if (!espacement) {
    doc.setCharSpace(0)
    doc.text(value, x, y, {
      align: options.align ?? 'left',
      baseline: options.baseline ?? 'top',
    })
    return
  }
  // The approved generator paints tracked runs glyph by glyph (it never emits a
  // PDF `Tc` spacing), so a reader's text extraction keeps the word intact.
  doc.setCharSpace(0)
  const largeur = largeurAvancePdf(doc, value, espacement)
  const align = options.align ?? 'left'
  // The trailing tracking space after the last glyph is not visible: align on
  // the visible run.
  const largeurVisible = Math.max(0, largeur - mm(espacement))
  let cx = align === 'center' ? x - largeurVisible / 2 : align === 'right' ? x - largeurVisible : x
  for (const caractere of Array.from(value)) {
    doc.text(caractere, cx, y, { baseline: options.baseline ?? 'top' })
    cx += doc.getTextWidth(caractere) + mm(espacement)
  }
}

class MesureJsPdf implements MesureTexte {
  constructor(private readonly doc: jsPDF) {}

  largeur(value: string, police: string, taillePt: number, espacementPt = 0): number {
    this.doc.setFont(police, 'normal')
    this.doc.setFontSize(taillePt)
    const width = this.doc.getTextWidth(value)
    // `getTextWidth` excludes the active char space (`Tc`): add the glyph
    // advances so a tracked run is measured with the width the reader receives.
    return width + mm(espacementPt) * Array.from(value).length
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
  readonly gapAvant: number
}

interface FigureRowCellPdf {
  readonly projection: CahierFigureProjection
  readonly x: number
  readonly width: number
}

/**
 * Native sibling row (the stationnement/ravitaillement pair): two figures on
 * one baseline, each measured at its own half-column width. The row is atomic;
 * a real measured overflow falls back to the sequential full-width figures.
 */
interface FigureRowBloc {
  readonly kind: 'figure-row'
  readonly cells: readonly FigureRowCellPdf[]
  readonly height: number
  readonly gapAvant: number
}

interface CelluleTableauBloc {
  readonly part: TableauPdfPart
  readonly rows: readonly LigneTableauPdf[]
  readonly x: number
  readonly width: number
  readonly continued: boolean
}

interface TableBloc {
  readonly kind: 'table'
  /** One table in the flat shape, or the two side-by-side approved access panels. */
  readonly cells: readonly CelluleTableauBloc[]
  /** Owner-published comparison label of the figure this table renders. */
  readonly comparisonLabel: string | null
  readonly height: number
  readonly gapAvant: number
}

interface TextBloc {
  readonly kind: 'text'
  readonly role: 'tables-heading' | 'note' | 'unavailable'
  readonly text: string
  readonly height: number
  readonly gapAvant: number
}

type BlocPdf = FigureBloc | FigureRowBloc | TableBloc | TextBloc

interface PagePdf {
  readonly index: number
  readonly blocks: BlocPdf[]
  readonly continuation: boolean
  readonly hasComparisonProof: boolean
  /**
   * The measured comparison note this page actually paints: the owner's served
   * label(s) of the proof blocks it carries, or the group identity when no
   * proof block publishes one. Empty when the page carries no note.
   */
  readonly comparaisonLignes: readonly string[]
}

interface DocumentPdf {
  readonly pages: readonly PagePdf[]
  readonly sousTitre: SousTitreComparaison | null
  readonly identityHeight: number
  readonly sourcesHeight: number
  /** Measured lines of the longest possible comparison note (the reserve). */
  readonly piedReserve: number
  /** Content bottom after reserving the measured footer zone. */
  readonly contenuBas: number
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

function construireSousTitre(
  capture: CahierExportCapture,
  mesure: MesureTexte,
): SousTitreComparaison | null {
  return sousTitreComparaison(capture.comparison, {
    mesure,
    largeur: PAGE.largeurUtile,
    police: ROLE_PDF.comparaisonNom.police,
    taillePt: TAILLE.comparaison,
    espacementPt: espaceTexte(TAILLE.comparaison, ROLE_PDF.comparaisonNom.espacementEm),
    policePrefixe: ROLE_PDF.comparaisonPrefixe.police,
    taillePrefixePt: TAILLE.prefixeComparaison,
  })
}

function hauteurSousTitreMm(sousTitre: SousTitreComparaison): number {
  return sousTitre.lignes.length * LIGNE_COMPARAISON
}

function hauteurIdentite(
  capture: CahierExportCapture,
  sousTitre: SousTitreComparaison | null,
  mesure: MesureTexte,
): number {
  const lignesFocal = plierTexte(capture.identity.territory.name.toLocaleUpperCase('fr-FR'), mesure, {
    police: ROLE_PDF.identite.police,
    taillePt: TAILLE.identite,
    largeurMax: PAGE.largeurUtile,
  }).length
  const focal = lignesFocal * LIGNE_IDENTITE
  const sous = sousTitre ? ESPACE.identiteSousTitre + hauteurSousTitreMm(sousTitre) : 0
  return focal + sous + ESPACE.apresIdentite
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

/**
 * The owner-published comparison label a projection carries, when its family
 * publishes one. Families without a comparison layer (profile, diversity loss)
 * publish no label: the note then falls back to the factual group identity.
 */
function libelleComparaisonProjection(projection: CahierFigureProjection): string | null {
  switch (projection.family) {
    case 'aedar-ramps':
    case 'aedar-car-overview':
    case 'mobilite-bars':
    case 'mobilite-share':
    case 'mobilite-curve':
      return projection.comparisonLabel
    // The explorer's owner publishes the requested group identity, not a
    // statistic/scope sentence: the factual group fallback says the same thing.
    case 'aedar-equipment-explorer':
    case 'aedar-diversity-loss':
    case 'aedar-equipment-profile':
      return null
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

/**
 * The one option set of a projection. The pagination measurement
 * (`hauteurFigurePdf`) and the painter (`dessinerFigurePdf`) both receive this
 * exact object, so a new figure input cannot reach only one of them.
 */
export function optionsFigurePdf(
  request: CahierExportRequest,
  projection: CahierFigureProjection,
): OptionsFigurePdfLiaison {
  const capture = request.capture
  const parSlot = <F extends CahierCaptureFigure['family']>(family: F) => capture.figures.find(
    (figure): figure is Extract<CahierCaptureFigure, { family: F }> => (
      figure.family === family && figure.slot === projection.slot),
  )
  const bars = parSlot('mobilite-bars')
  const curve = parSlot('mobilite-curve')
  const explorer = parSlot('aedar-equipment-explorer')
  return {
    comparisonProof: preuveFigureComparative(projection, capture),
    ...(explorer
      ? {
        distributionTitle: explorer.model.distributionFigureTitle,
        distributionUnit: explorer.model.distributionValueUnit,
        explorerTypequLabel: explorer.effective.typequLabel,
      }
      : {}),
    ...(bars ? { modeleBars: bars.model.figure } : {}),
    // The captured curve model is consumed through its actual narrowed shape
    // (axis, points, trajectory, comparison), never widened to a fake full
    // screen evidence with prose/sources/kind it does not carry.
    ...(curve ? { modeleCourbe: curve.model } : {}),
  }
}

function assemblerPages(
  request: CahierExportRequest,
  mesure: MesureTexte,
  reserverPiedComparaison: boolean,
): DocumentPdf {
  const capture = request.capture
  const projections = projeterRequeteExportFigures(request)
  const sousTitre = construireSousTitre(capture, mesure)
  const identityHeight = hauteurIdentite(capture, sousTitre, mesure)
  const sourcesLines = capture.sources.map((source) => plierTexte(
    `Source(s) : ${sourcesTexte(source)}`,
    mesure,
    {
      police: ROLE_PDF.source.police,
      taillePt: TAILLE.source,
      largeurMax: PAGE.largeurCorps,
      espacementPt: espaceTexte(TAILLE.source, ROLE_PDF.source.espacementEm),
      casserMotsLongs: true,
    },
  )).flat().map((ligne) => ligne.texte)
  const sourcesHeight = Math.max(4, sourcesLines.length
    * mesure.hauteurLigne(ROLE_PDF.source.police, TAILLE.source) * 1.4) + ESPACE.sourcesHaut
  // The reserve is the longest note any page could paint: the section's distinct
  // owner comparison labels, then the group identity every page shares. A page
  // paints only the labels of the proof blocks it really carries (below), so the
  // reserve is an upper bound of the painted note, never a smaller guess.
  const labelsSection = [...new Set(projections
    .map((projection) => libelleComparaisonProjection(projection))
    .filter((label): label is string => label !== null))]
  const piedComparaison = lignesPiedComparaison(labelsSection, capture, mesure)
  // Reserve the comparison footer's actual wrapped height (not a fixed offset),
  // leaving the approved single-line box at its H-35 baseline and clear of the
  // invitation at H-23. The reserve follows the painter's own predicate: a page
  // without comparative proof paints no note, so a `comparison.group` alone
  // never reserves space or shifts pagination (`cahierExportCapture.ts`: the
  // group is not proof that a comparison is displayed). The caller resolves the
  // page-local proof and asks for this pass again when a note is really painted.
  const lignesReservees = reserverPiedComparaison ? piedComparaison : []
  const contenuBas = Math.min(
    PAGE.contenuBas,
    lignesReservees.length
      ? PAGE.piedComparaison - (lignesReservees.length - 1) * PIED.interligne - PIED.reserveHaut
      : PAGE.contenuBas,
  )
  // The vertically centred section stack: body padding, repeated identity
  // (with its comparison subtitle), the measured blocks and the sources.
  const hauteurUtile = contenuBas - PAGE.contenuHaut
  const disponibles = hauteurUtile - 2 * PAGE.paddingSection - identityHeight - sourcesHeight
  const availableFirst = disponibles
  const availableNext = disponibles

  const blocks: BlocPdf[] = []
  const messagesVus = new Set<string>()
  const optionsFigure = (projection: CahierFigureProjection) => optionsFigurePdf(request, projection)
  let premierBloc = true
  const pousserFigure = (projection: CahierFigureProjection) => {
    blocks.push({
      kind: 'figure',
      projection,
      gapAvant: premierBloc ? 0 : ESPACE.entreTableaux,
      height: hauteurFigurePdf(projection, PAGE.largeurCorps, mesure, optionsFigure(projection)),
    })
    premierBloc = false
  }
  const pousserIndisponibles = (projection: CahierFigureProjection) => {
    for (const item of projection.unavailable) {
      if (messagesVus.has(item.message)) continue
      messagesVus.add(item.message)
      blocks.push({
        kind: 'text',
        role: 'unavailable',
        text: item.message,
        gapAvant: mm(2),
        height: hauteurTexteSimple(item.message, mesure, ROLE_PDF.comparaisonPrefixe.police, TAILLE.note, PAGE.largeurCorps) + 1,
      })
    }
  }
  for (let index = 0; index < projections.length; index += 1) {
    const projection = projections[index]!
    // The projection's own row is the single source: no second lookup table.
    const row = projection.row ?? null
    const peers = row && row.columns > 1
      ? projections.slice(index, index + row.columns)
        .filter((candidate) => candidate.row?.key === row.key)
      : []
    if (row && row.columns > 1 && peers.length === row.columns) {
      const layout = figureRowGeometry(PAGE.largeurCorps, figureRowLayout(row.viewportPx))
      const gap = layout.gap
      const largeur = layout.panelWidth
      const cells = peers.map((peer, cellIndex) => ({
        projection: peer,
        x: PAGE.corpsX + cellIndex * (largeur + gap),
        width: largeur,
      }))
      const hauteur = Math.max(...peers.map((peer) => (
        hauteurFigurePdf(peer, largeur, mesure, optionsFigure(peer))
      )))
      // The source row is atomic. Only a genuinely taller-than-page row falls
      // back to the measured full-width sequence; no global shrink.
      if (hauteur <= availableNext) {
        blocks.push({
          kind: 'figure-row',
          cells,
          height: hauteur,
          gapAvant: premierBloc ? 0 : ESPACE.entreTableaux,
        })
        premierBloc = false
      } else {
        for (const peer of peers) pousserFigure(peer)
      }
      for (const peer of peers) pousserIndisponibles(peer)
      index += row.columns - 1
      continue
    }
    pousserFigure(projection)
    pousserIndisponibles(projection)
  }

  const tableGroups: { parts: TableauPdfPart[]; comparisonLabel: string | null }[] = []
  for (const projection of projections) {
    const ownerDisplayed = preuveProprietaire(capture, familySlots(projection))
    const comparisonLabel = libelleComparaisonProjection(projection)
    const build = (table: Parameters<typeof construireTableauxPdf>[0], largeurDisponible: number) => (
      construireTableauxPdf(table, {
        mesure,
        largeurDisponible,
        nomTerritoire: capture.identity.territory.name,
        ownerDisplayed,
      })
    )
    // Approved flat shape (A): the access ramps are two panels; the approved
    // generator lays their tables in one two-column grid (`desktop.js:197`).
    // Pair only when both measured tables fit a half column; otherwise the
    // table keeps the full content width (an honest measured continuation,
    // never a clipped number or a permanently stacked pair).
    if (projection.family === 'aedar-ramps' && projection.tables.length > 0) {
      const large = projection.tables.map((table) => build(table, PAGE.largeurCorps))
      if (large.every((parts) => parts.length === 1 && (parts[0]!.colgroupFixe
        || parts[0]!.naturalWidth <= PAIRE_TABLEAUX.largeur + 1e-6))) {
        try {
          const pair = projection.tables.map((table) => build(table, PAIRE_TABLEAUX.largeur))
          if (pair.every((parts) => parts.length === 1 && parts[0]!.rows.length > 0)) {
            tableGroups.push({ parts: pair.map((parts) => parts[0]!), comparisonLabel })
            continue
          }
        } catch (error) {
          if (!(error instanceof CahierPdfTableLayoutError)) throw error
        }
      }
      for (const parts of large) for (const part of parts) tableGroups.push({ parts: [part], comparisonLabel })
      continue
    }
    for (const table of projection.tables) {
      for (const part of build(table, PAGE.largeurCorps)) tableGroups.push({ parts: [part], comparisonLabel })
    }
  }
  const tableParts = tableGroups.flatMap((group) => group.parts)
  if (tableGroups.length) {
    const libelle = tableParts.length > 1 ? 'Valeurs des graphiques' : 'Valeurs du graphique'
    blocks.push({
      kind: 'text',
      role: 'tables-heading',
      text: libelle,
      // `desktop.js`: heading `margin:24px 0 12px`.
      gapAvant: ESPACE.titreTableauxHaut,
      height: mesure.hauteurLigne(ROLE_PDF.titreTableau.police, TAILLE.titreTableaux) * 1.4,
    })
    const largeurCellule = (parts: TableauPdfPart[]) => (
      parts.length === 2 ? PAIRE_TABLEAUX.largeur : PAGE.largeurCorps
    )
    for (const [index, group] of tableGroups.entries()) {
      blocks.push({
        kind: 'table',
        cells: group.parts.map((part, cellIndex) => ({
          part,
          rows: part.rows,
          x: PAGE.corpsX + cellIndex * (PAIRE_TABLEAUX.largeur + PAIRE_TABLEAUX.gap),
          width: largeurCellule(group.parts),
          continued: false,
        })),
        comparisonLabel: group.comparisonLabel,
        // The first caption keeps the heading's 12 px bottom margin; a new
        // table row keeps its 20 px `margin-bottom` (source rhythm, not zero).
        gapAvant: index === 0 ? ESPACE.titreTableauxBas : ESPACE.entreTableaux,
        height: 0,
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
        gapAvant: mm(2),
        height: hauteurTexteSimple(note, mesure, ROLE_PDF.comparaisonPrefixe.police, TAILLE.note, PAGE.largeurCorps) + 1,
      })
    }
    if (tableParts.some((part) => part.abbreviatedUnavailable)) {
      if (!messagesVus.has(EXPLICATION_INDISPONIBLE)) {
        messagesVus.add(EXPLICATION_INDISPONIBLE)
        blocks.push({
          kind: 'text',
          role: 'note',
          text: EXPLICATION_INDISPONIBLE,
          gapAvant: mm(2),
          height: hauteurTexteSimple(EXPLICATION_INDISPONIBLE, mesure, ROLE_PDF.comparaisonPrefixe.police, TAILLE.note, PAGE.largeurCorps) + 1,
        })
      }
    }
  }

  const pagesBrutes: Omit<PagePdf, 'comparaisonLignes'>[] = []
  let page: { blocks: BlocPdf[]; remaining: number } = { blocks: [], remaining: availableFirst }
  let continuation = false
  const nouvellePage = () => {
    pagesBrutes.push({ index: pagesBrutes.length, blocks: page.blocks, continuation, hasComparisonProof: false })
    page = { blocks: [], remaining: availableNext }
    continuation = true
  }
  const poserBloc = (bloc: BlocPdf) => {
    page.blocks.push(bloc)
    page.remaining -= bloc.gapAvant + bloc.height
  }

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const bloc = blocks[blockIndex]!
    if (bloc.kind === 'table') {
      const cells = bloc.cells.map((cell) => ({
        part: cell.part,
        x: cell.x,
        width: cell.width,
        continued: cell.continued,
        rows: [...cell.rows] as LigneTableauPdf[],
      }))
      let first = true
      while (cells.some((cell) => cell.rows.length)) {
        const gapAvant = first ? bloc.gapAvant : 0
        const entetes = cells.map((cell) => hauteurEnteteTableau(cell.part, mesure, !first || cell.continued))
        const hauteurEntete = Math.max(...entetes)
        const premiereHauteur = Math.max(...cells.map((cell) => cell.rows[0]?.height ?? 0))
        if (page.remaining < gapAvant + hauteurEntete + premiereHauteur) {
          if (!page.blocks.length) {
            throw new CahierPdfCompositionError('layout', 'Un tableau ne peut pas commencer sur la page.')
          }
          nouvellePage()
          continue
        }
        let n = 0
        let hauteur = hauteurEntete
        while (cells.some((cell) => cell.rows[n] !== undefined)) {
          const hauteurRangee = Math.max(...cells.map((cell) => cell.rows[n]?.height ?? 0))
          if (gapAvant + hauteur + hauteurRangee > page.remaining) break
          hauteur += hauteurRangee
          n += 1
        }
        if (n === 0) {
          if (!page.blocks.length) {
            throw new CahierPdfCompositionError('layout', 'Une ligne de tableau dépasse la page utile.')
          }
          nouvellePage()
          continue
        }
        poserBloc({
          kind: 'table',
          cells: cells.map((cell) => ({
            part: cell.part,
            x: cell.x,
            width: cell.width,
            rows: cell.rows.slice(0, n),
            continued: !first || cell.continued,
          })),
          comparisonLabel: bloc.comparisonLabel,
          height: hauteur,
          gapAvant,
        })
        for (const cell of cells) cell.rows = cell.rows.slice(n)
        first = false
        if (cells.some((cell) => cell.rows.length)) nouvellePage()
      }
      continue
    }
    if (bloc.kind === 'text' && bloc.role === 'tables-heading') {
      const suite = blocks[blockIndex + 1]
      if (suite?.kind === 'table' && page.blocks.length) {
        const hauteurEntete = Math.max(...suite.cells.map((cell) => (
          hauteurEnteteTableau(cell.part, mesure, cell.continued)
        )))
        const premiere = Math.max(...suite.cells.map((cell) => cell.rows[0]?.height ?? 0))
        if (page.remaining < bloc.gapAvant + bloc.height + suite.gapAvant + hauteurEntete + premiere) {
          nouvellePage()
        }
      }
    }
    if (bloc.gapAvant + bloc.height > page.remaining) {
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
  // The note of a page names the owner-published labels of the proof blocks it
  // really carries, in served order: a figure proved on another page is not
  // named here, and no statistic label is glued to an independent group.
  const labelsPreuve = (blocks: readonly BlocPdf[]): string[] => {
    const labels: string[] = []
    const add = (label: string | null) => {
      if (label && !labels.includes(label)) labels.push(label)
    }
    for (const bloc of blocks) {
      if (bloc.kind === 'figure') {
        if (preuveFigureComparative(bloc.projection, capture)) add(libelleComparaisonProjection(bloc.projection))
      } else if (bloc.kind === 'figure-row') {
        for (const cell of bloc.cells) {
          if (preuveFigureComparative(cell.projection, capture)) add(libelleComparaisonProjection(cell.projection))
        }
      } else if (bloc.kind === 'table') {
        if (bloc.cells.some((cell) => cell.part.hasComparison)) add(bloc.comparisonLabel)
      }
    }
    return labels
  }
  const pages: PagePdf[] = pagesBrutes.map((candidate) => {
    const hasComparisonProof = candidate.blocks.some((bloc) => {
      if (bloc.kind === 'figure') return preuveFigureComparative(bloc.projection, capture)
      if (bloc.kind === 'figure-row') {
        return bloc.cells.some((cell) => preuveFigureComparative(cell.projection, capture))
      }
      if (bloc.kind === 'table') return bloc.cells.some((cell) => cell.part.hasComparison)
      return false
    })
    return {
      ...candidate,
      hasComparisonProof,
      comparaisonLignes: hasComparisonProof
        ? lignesPiedComparaison(labelsPreuve(candidate.blocks), capture, mesure)
        : [],
    }
  })

  return {
    pages,
    sousTitre: pages.some((candidate) => candidate.hasComparisonProof) ? sousTitre : null,
    identityHeight,
    sourcesHeight,
    piedReserve: piedComparaison.length,
    contenuBas,
  }
}

/**
 * Paginate against the footer that is actually painted. The first pass places
 * the blocks without a footer reserve; if no page carries comparative proof,
 * the group note is not painted and the document is returned unchanged. Only
 * when a proof page exists does the second pass reserve the measured wrapped
 * note, so the note's real height and the pagination agree page for page.
 */
function construirePages(
  request: CahierExportRequest,
  mesure: MesureTexte,
): DocumentPdf {
  const sansReserve = assemblerPages(request, mesure, false)
  const preuveComparative = sansReserve.pages.some((page) => page.hasComparisonProof)
  if (!preuveComparative || sansReserve.piedReserve === 0) return sansReserve
  return assemblerPages(request, mesure, true)
}

/**
 * The lockup top above the word baseline, in em, from the shared brand owner
 * (`luskBrandMark.ts`): the header's `align-items:center` flex geometry plus
 * the face's line-box baseline. The painter consumes the owner's derivation —
 * it no longer carries a copied PDF-only offset.
 */
export function sommetErminePt(baseMotPt: number, taillePt: number): number {
  return baseMotPt - sommetErmineEm() * taillePt
}

async function dessinerMarque(doc: jsPDF, x: number, sommetErmine: number, baseMot: number): Promise<void> {
  // The lockup is drawn from the locked brand paths; the wordmark uses the
  // Newsreader face actually embedded in the document. The ermine is em-relative
  // to the word (the shared `MARQUE_LUSK_LOCKUP.ermineEm`), never a fixed
  // millimetre.
  const cote = mm(ROLE_PDF.marqueMot.taille * MARQUE_LUSK_LOCKUP.ermineEm)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', MARQUE_LUSK_ERMINE.viewBox)
  for (const path of MARQUE_LUSK_ERMINE.chemins) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    node.setAttribute('d', path.d)
    node.setAttribute('fill', REMPLISSAGES_MARQUE_LUSK[path.role])
    svg.append(node)
  }
  const painter = doc as jsPDF & { svg: (element: Element, options: { x: number; y: number; width: number; height: number }) => Promise<unknown> }
  await painter.svg(svg, { x, y: sommetErmine, width: cote, height: cote })
  texte(doc, 'lusk', x + cote + mm(ptDepuisCssPx(MARQUE_LUSK_LOCKUP.ecartPx)), baseMot, {
    police: ROLE_PDF.marqueMot.police,
    taille: ROLE_PDF.marqueMot.taille,
    couleur: PALETTE_PDF.textPrimary,
    baseline: 'alphabetic',
    espacement: espaceTexte(ROLE_PDF.marqueMot.taille, ROLE_PDF.marqueMot.espacementEm),
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
  const baseMot = mm(36.7)
  await dessinerMarque(
    doc,
    PAGE.margeGauche,
    mm(sommetErminePt(36.7, ROLE_PDF.marqueMot.taille)),
    baseMot,
  )
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (urlAccueil) doc.link(PAGE.margeGauche, mm(26), mm(20), mm(6), { url: urlAccueil })
  const titre = capture.identity.unit.label
  texte(doc, titre, PAGE.width / 2, mm(41.8), {
    police: ROLE_PDF.titrePage.police,
    taille: TAILLE.titrePage,
    couleur: PALETTE_PDF.ink,
    align: 'center',
    baseline: 'alphabetic',
    espacement: espaceTexte(TAILLE.titrePage, ROLE_PDF.titrePage.espacementEm),
  })
  const territory = capture.identity.territory.name
  const largeurTerritory = mesure.largeur(territory, ROLE_PDF.territoireEntete.police, ROLE_PDF.territoireEntete.taille)
  // `desktop.js` lays the live territory + external-link icon against the right
  // edge: the icon keeps its own ~6 pt column.
  const margeIcone = mm(10.7)
  const tx = PAGE.width - PAGE.margeDroite - margeIcone
  texte(doc, territory, tx, mm(36.9), {
    police: ROLE_PDF.territoireEntete.police,
    taille: ROLE_PDF.territoireEntete.taille,
    couleur: PALETTE_PDF.accentPrimary,
    align: 'right',
    baseline: 'alphabetic',
  })
  // Small external-link arrow; the whole territory+arrow is the live link.
  setStroke(doc, PALETTE_PDF.accentPrimary)
  doc.setLineWidth(mm(0.7))
  const ax = PAGE.width - PAGE.margeDroite - mm(4.6)
  const ay = mm(30.9)
  doc.line(ax, ay + mm(2.1), ax + mm(2.1), ay)
  doc.line(ax, ay, ax + mm(2.1), ay)
  doc.line(ax + mm(2.1), ay, ax + mm(2.1), ay + mm(2.1))
  if (urlPublique) doc.link(tx - largeurTerritory - mm(1), mm(28.4), largeurTerritory + margeIcone, mm(11), { url: urlPublique })
  // The approved header rule is the live `.page-heading` border-bottom, not a
  // notebook margin: canvas red-soft, 1 CSS px.
  setStroke(doc, PALETTE_PDF.marginSoft)
  doc.setLineWidth(mm(ptDepuisCssPx(1)))
  doc.line(PAGE.margeGauche, PAGE.filetEntete, PAGE.width - PAGE.margeDroite, PAGE.filetEntete)
}

/** The `.cahier--sans-grille .concept-group` surface around the whole section. */
function dessinerSurfaceSection(doc: jsPDF, haut: number, bas: number): void {
  setStroke(doc, PALETTE_PDF.figureSurfaceBorder)
  doc.setLineWidth(mm(ptDepuisCssPx(1)))
  // Four edges, like the approved border painting: a single closed `re` path is
  // not a set of measured edges for a reader/tool inspecting the document.
  doc.line(PAGE.margeGauche, haut, PAGE.margeGauche + PAGE.largeurUtile, haut)
  doc.line(PAGE.margeGauche, bas, PAGE.margeGauche + PAGE.largeurUtile, bas)
  doc.line(PAGE.margeGauche, haut, PAGE.margeGauche, bas)
  doc.line(PAGE.margeGauche + PAGE.largeurUtile, haut, PAGE.margeGauche + PAGE.largeurUtile, bas)
}

function dessinerIdentite(
  doc: jsPDF,
  capture: CahierExportCapture,
  sousTitre: SousTitreComparaison | null,
  mesure: MesureTexte,
  y: number,
  urlPublique: string | null,
): number {
  const nom = capture.identity.territory.name.toLocaleUpperCase('fr-FR')
  const lignes = plierTexte(nom, mesure, {
    police: ROLE_PDF.identite.police,
    taillePt: TAILLE.identite,
    largeurMax: PAGE.largeurUtile,
  })
  let cy = y
  for (const ligne of lignes) {
    texte(doc, ligne.texte, PAGE.width / 2, cy, {
      police: ROLE_PDF.identite.police,
      taille: TAILLE.identite,
      couleur: PALETTE_PDF.editorialMuted,
      align: 'center',
      espacement: espaceTexte(TAILLE.identite, ROLE_PDF.identite.espacementEm),
    })
    cy += LIGNE_IDENTITE
  }
  const basIdentite = cy
  if (urlPublique) {
    doc.link(PAGE.margeGauche, y - mm(1), PAGE.largeurUtile, basIdentite - y, { url: urlPublique })
  }
  if (!sousTitre) return basIdentite
  cy += ESPACE.identiteSousTitre
  // The approved subtitle is one line box with two inline runs: prefix and
  // names share one alphabetic baseline (measured bottom delta 0.67 pt).
  const baseline = cy + mm(
    (ptDepuisCssPx(26) - TAILLE.comparaison) / 2 + ASCENTE_DISPLAY * TAILLE.comparaison,
  )
  for (const ligne of sousTitre.lignes) {
    const largeurLigne = ligne.reduce((total, run) => total + mesure.largeur(
      run.texte,
      run.kind === 'prefix' ? ROLE_PDF.comparaisonPrefixe.police : ROLE_PDF.comparaisonNom.police,
      run.kind === 'prefix' ? TAILLE.prefixeComparaison : TAILLE.comparaison,
      run.kind === 'prefix' ? 0 : espaceTexte(TAILLE.comparaison, ROLE_PDF.comparaisonNom.espacementEm),
    ), 0)
    let cx = PAGE.width / 2 - largeurLigne / 2
    for (const run of ligne) {
      const prefixe = run.kind === 'prefix'
      const espacement = prefixe ? 0 : espaceTexte(TAILLE.comparaison, ROLE_PDF.comparaisonNom.espacementEm)
      texte(doc, run.texte, cx, baseline, {
        police: prefixe ? ROLE_PDF.comparaisonPrefixe.police : ROLE_PDF.comparaisonNom.police,
        taille: prefixe ? TAILLE.prefixeComparaison : TAILLE.comparaison,
        couleur: PALETTE_PDF.editorialMuted,
        baseline: 'alphabetic',
        espacement,
      })
      cx += mesure.largeur(
        run.texte,
        prefixe ? ROLE_PDF.comparaisonPrefixe.police : ROLE_PDF.comparaisonNom.police,
        prefixe ? TAILLE.prefixeComparaison : TAILLE.comparaison,
        espacement,
      )
    }
    cy += LIGNE_COMPARAISON
  }
  return cy
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
  /** Wrapped footer-note lines the pagination actually reserved. */
  noteLines: number,
): number {
  let cy = y
  for (const ligne of part.titleLines) {
    texte(doc, ligne, x + width / 2, cy, {
      police: ROLE_PDF.titreTableau.police,
      taille: TAILLE.titreTableaux,
      couleur: PALETTE_PDF.brand700,
      align: 'center',
    })
    cy += mesure.hauteurLigne(ROLE_PDF.titreTableau.police, TAILLE.titreTableaux)
      * ESPACE_TABLEAU.interligneTitre
  }
  if (continued) {
    texte(doc, '(suite)', x + width / 2, cy, {
      police: ROLE_PDF.comparaisonPrefixe.police,
      taille: 6,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
    cy += ESPACE_TABLEAU.suiteMm
  } else {
    cy += ESPACE_TABLEAU.apresTitreMm
  }
  const enteteTop = cy
  const sousEnteteTop = enteteTop + part.groupHeaderHeight
  // Row-dimension header (`Temps` / `Statistique`): in the grouped shape it is
  // the approved `th[colspan=1][rowspan=2]`, bottom-aligned across both header
  // rows; in the flat shape it is the first column's header.
  if (part.rowHeader) {
    // The native row-dimension `th[colspan][rowspan=2]` uses the mode role
    // (`--type-figure-mode`, 7.36 pt), not the smaller sub-header role.
    texte(doc, part.rowHeader, x + 1, part.layout === 'grouped' ? cy + part.headerHeight - 2.4 : sousEnteteTop, {
      police: ROLE_PDF.enteteTableauMode.police,
      taille: ROLE_PDF.enteteTableauMode.taille,
      couleur: PALETTE_PDF.ink,
    })
  }
  if (part.layout === 'grouped') {
    // Legend-key header row: one coloured, spanning cell per mode, exactly like
    // the approved generator's `th[colspan=count]` with `column.color`. The
    // label is wrapped to the measured colSpan width (native `overflow-wrap`).
    let gx = x + part.rowLabelWidth
    const hauteurLigneMode = mesure.hauteurLigne(
      ROLE_PDF.enteteTableauMode.police,
      ROLE_PDF.enteteTableauMode.taille,
    ) * ESPACE_TABLEAU.interligneEntete
    for (const groupe of part.groups) {
      groupe.labelLines.forEach((ligne, index) => {
        texte(doc, ligne, gx + 1, enteteTop + index * hauteurLigneMode, {
          police: ROLE_PDF.enteteTableauMode.police,
          taille: ROLE_PDF.enteteTableauMode.taille,
          couleur: groupe.color ?? PALETTE_PDF.ink,
        })
      })
      gx += groupe.width
    }
    setStroke(doc, PALETTE_PDF.marginSoft)
    doc.setLineWidth(mm(ptDepuisCssPx(1)))
    doc.line(x, sousEnteteTop, x + width, sousEnteteTop)
  }
  // Sub-header row: over each group, `[territory | Groupe¹ | Rang]`; the flat
  // shape uses the same native header role as its own row-dimension cell.
  const roleEntete = part.layout === 'grouped' ? ROLE_PDF.enteteTableauSous : ROLE_PDF.enteteTableauMode
  const hauteurLigneEntete = mesure.hauteurLigne(roleEntete.police, roleEntete.taille)
    * ESPACE_TABLEAU.interligneEntete
  const numeroPage = (doc as jsPDF & {
    internal: { getCurrentPageInfo: () => { pageNumber: number } }
  }).internal.getCurrentPageInfo().pageNumber
  let cx = x + part.rowLabelWidth
  for (const colonne of part.columns) {
    let hy = sousEnteteTop
    // The `¹` footnote belongs to the compared group cell, once per cell —
    // never once per wrapped line and never to `Rang`. It is an in-document
    // link to the page footer, like the approved `comparisonReference()`.
    const estGroupe = colonne.role !== 'rang'
      && colonne.column.kind === 'comparison'
      && part.hasComparison
    colonne.headerLines.forEach((ligne, index) => {
      const derniere = index === colonne.headerLines.length - 1
      const avecMarque = estGroupe && derniere
      // The approved anchor keeps a space in the flat shape (`comparé ¹`,
      // `desktop.js:226`) and none in the grouped shape (`Groupe¹`, `:320`).
      const separateur = part.layout === 'flat' ? ' ' : ''
      texte(doc, avecMarque ? `${ligne}${separateur}¹` : ligne, cx + 1, hy, {
        police: roleEntete.police,
        taille: roleEntete.taille,
        couleur: PALETTE_PDF.ink,
        align: 'left',
      })
      if (avecMarque) {
        const largeurLibelle = mesure.largeur(ligne, roleEntete.police, roleEntete.taille)
          + (separateur ? mesure.largeur(' ', roleEntete.police, roleEntete.taille) : 0)
        doc.link(
          cx + 1 + largeurLibelle,
          hy,
          mesure.largeur('¹', roleEntete.police, roleEntete.taille) + 0.4,
          hauteurLigneEntete,
          {
            pageNumber: numeroPage,
            // The note stacks upward when it wraps, so the `¹` destination is
            // the measured top line's lead — never a fixed H-35 point inside
            // or below a multi-line note.
            top: PAGE.piedComparaison
              - (Math.max(1, noteLines) - 1) * PIED.interligne
              - PIED.reserveHaut,
          },
        )
      }
      hy += hauteurLigneEntete
    })
    cx += colonne.width
  }
  cy = enteteTop + part.headerHeight
  // Light rule under the header, plus the section's red-margin accent.
  setStroke(doc, PALETTE_PDF.marginSoft)
  doc.setLineWidth(mm(ptDepuisCssPx(1)))
  doc.line(x, cy, x + width, cy)
  // Vertical rules between mode/column groups, spanning the header and every
  // row block on this page part.
  const hauteurLignes = rows.reduce((sum, row) => sum + row.height, 0)
  for (let index = 0; index < part.columns.length; index += 1) {
    if (!separateurVertical(part.columns, index)) continue
    const ruleX = x + part.rowLabelWidth + part.columns.slice(0, index).reduce((sum, colonne) => sum + colonne.width, 0)
    // Native group separator: `border-left: 1px solid var(--editorial-muted)`
    // on the spanning group header and the territory cell of each next group.
    setStroke(doc, PALETTE_PDF.muted)
    doc.setLineWidth(mm(ptDepuisCssPx(1)))
    doc.line(ruleX, enteteTop, ruleX, cy + hauteurLignes)
  }
  // Rows: complete cells, all relationships retained.
  for (const row of rows) {
    let cellX = x
    let rh = 0
    row.labelLines.forEach((ligne, index) => {
      texte(doc, ligne, cellX + 1, cy + ESPACE_TABLEAU.ligneInsetMm + index * 2.5, {
        police: ROLE_PDF.libelleTableau.police,
        taille: ROLE_PDF.libelleTableau.taille,
        couleur: PALETTE_PDF.ink,
      })
    })
    rh = Math.max(rh, row.labelLines.length * 2.5)
    cellX += part.rowLabelWidth
    for (let index = 0; index < part.columns.length; index += 1) {
      const colonne = part.columns[index]!
      const cellule = row.cells[index]!
      if (colonne.role === 'rang') {
        texte(doc, cellule.display, cellX + 1, cy + ESPACE_TABLEAU.ligneInsetMm, {
          police: ROLE_PDF.valeurTableau.police,
          taille: ROLE_PDF.valeurTableau.taille,
          couleur: PALETTE_PDF.ink,
        })
        rh = Math.max(rh, 2.5)
        cellX += colonne.width
        continue
      }
      // The approved flat table's `Mode` cell keeps the row-label role (14 px)
      // and its series ink; numeric value cells use the legend role.
      const roleCellule = colonne.column.kind === 'raw'
        ? ROLE_PDF.libelleTableau
        : ROLE_PDF.valeurTableau
      const lignes = plierTexte(cellule.display, mesure, {
        police: roleCellule.police,
        taillePt: roleCellule.taille,
        largeurMax: colonne.width - 2,
        casserMotsLongs: cellule.cell.value === null,
      })
      const couleurCellule = cellule.cell.color ? couleurPdf(cellule.cell.color) : PALETTE_PDF.ink
      lignes.forEach((ligne, ligneIndex) => {
        texte(doc, ligne.texte, cellX + 1, cy + ESPACE_TABLEAU.ligneInsetMm + ligneIndex * 2.5, {
          police: roleCellule.police,
          taille: roleCellule.taille,
          couleur: couleurCellule,
        })
      })
      rh = Math.max(rh, lignes.length * 2.5)
      cellX += colonne.width
    }
    setStroke(doc, PALETTE_PDF.borderLight)
    doc.setLineWidth(mm(ptDepuisCssPx(1)))
    doc.line(x, cy + row.height - 0.4, x + width, cy + row.height - 0.4)
    cy += row.height
  }
  return cy - y
}

function dessinerSources(
  doc: jsPDF,
  capture: CahierExportCapture,
  mesure: MesureTexte,
  y: number,
  largeur: number,
): void {
  let cy = y
  const espacement = espaceTexte(TAILLE.source, ROLE_PDF.source.espacementEm)
  for (let index = 0; index < capture.sources.length; index += 1) {
    const source = capture.sources[index]!
    const texteSource = `${index === 0 ? 'Source(s) : ' : ''}${sourcesTexte(source)}`
    const lignes = plierTexte(texteSource, mesure, {
      police: ROLE_PDF.source.police,
      taillePt: TAILLE.source,
      largeurMax: largeur,
      espacementPt: espacement,
      casserMotsLongs: true,
    })
    for (const ligne of lignes) {
      texte(doc, ligne.texte, PAGE.width - PAGE.margeDroite, cy, {
        police: ROLE_PDF.source.police,
        taille: TAILLE.source,
        couleur: PALETTE_PDF.muted,
        align: 'right',
        espacement,
      })
      if (source.url) {
        const width = mesure.largeur(ligne.texte, ROLE_PDF.source.police, TAILLE.source, espacement)
        doc.link(PAGE.width - PAGE.margeDroite - width, cy - 0.5, width, 2.6, { url: source.url })
      }
      cy += mesure.hauteurLigne(ROLE_PDF.source.police, TAILLE.source) * 1.4
    }
  }
}

/**
 * The measured footer note. It is one wrapping owner so the pagination reserve
 * and the painter cannot disagree about how many lines the note needs.
 *
 * The note must explain *what* the compared column measures (PRD §8: the group
 * name does not replace the served statistic/weighting/rank explanation). It
 * therefore prints the owner-published comparison label(s) verbatim — the
 * sentence the owner built from its actual served comparison — and never glues
 * a statistic label to an independent group identity, which would name two
 * different cohorts in one statement. When the proof blocks publish no label
 * at all, the factual group identity is the only truthful source and is used
 * alone. A blank published label is a corrupt capture: the painter refuses it
 * rather than printing an empty statement.
 */
function lignesPiedComparaison(
  labels: readonly string[],
  capture: CahierExportCapture,
  mesure: MesureTexte,
): readonly string[] {
  for (const label of labels) {
    if (!label.trim()) {
      throw new CahierPdfCompositionError(
        'inconsistent-capture',
        'Un libellé de comparaison publié est vide : la note de pied ne peut pas être inventée.',
      )
    }
  }
  const group = capture.comparison.group
  const groupeLabel = group ? group.label ?? group.names.join(', ') : null
  const libelle = labels.length ? labels.join(' · ') : groupeLabel
  if (!libelle) return []
  return plierTexte(`¹ Groupe comparé : ${libelle}`, mesure, {
    police: ROLE_PDF.pied.police,
    taillePt: TAILLE.pied,
    largeurMax: PAGE.largeurUtile,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte)
}

function dessinerPied(
  doc: jsPDF,
  mesure: MesureTexte,
  page: number,
  total: number,
  urlAccueil: string | null,
  hasComparisonProof: boolean,
  lignesComparaison: readonly string[],
): void {
  if (hasComparisonProof && lignesComparaison.length) {
    for (let index = 0; index < lignesComparaison.length; index += 1) {
      // Stack extra wrapped lines upwards; the last line keeps the approved
      // H-35 baseline. The previous top-baseline draw sat 6.9 pt too low.
      const y = PAGE.piedComparaison - (lignesComparaison.length - 1 - index) * PIED.interligne
      texte(doc, lignesComparaison[index]!, PAGE.margeGauche, y, {
        police: ROLE_PDF.pied.police,
        taille: TAILLE.pied,
        couleur: PALETTE_PDF.muted,
        baseline: 'alphabetic',
      })
    }
  }
  const host = urlAccueil ? new URL(urlAccueil).host : 'lusk'
  const invitation = `Retrouvez les cartes et explorez les données sur ${host}`
  texte(doc, invitation, PAGE.margeGauche, PAGE.piedInvitation, {
    police: ROLE_PDF.pied.police,
    taille: TAILLE.pied,
    couleur: PALETTE_PDF.muted,
    baseline: 'alphabetic',
  })
  if (urlAccueil) {
    const width = mesure.largeur(invitation, ROLE_PDF.pied.police, TAILLE.pied)
    doc.link(PAGE.margeGauche, PAGE.piedInvitation - mm(1), width, mm(3.4), { url: urlAccueil })
  }
  texte(doc, `${page} / ${total}`, PAGE.width - PAGE.margeDroite, PAGE.piedNumero, {
    police: ROLE_PDF.pied.police,
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
 * Production text measurement over the registered faces, without composing a
 * document. The suite measures table cells and figure heights through this
 * seam, so no test can assert a different line box than the painter uses.
 */
export async function mesurePdfProduction(options: {
  readonly chargerPolice?: ChargeurPolicePdf
  readonly signal?: AbortSignal
} = {}): Promise<{ readonly doc: jsPDF; readonly mesure: MesureTexte }> {
  const { jsPDF: JsPdf } = await import('jspdf')
  const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const signal = options.signal ?? new AbortController().signal
  await enregistrerPolices(doc, options.chargerPolice ?? chargerPolicePdf, signal)
  return { doc, mesure: new MesureJsPdf(doc) }
}

/**
 * Public generation seam. Lazy-imports jsPDF/svg2pdf only when a file is
 * actually requested; the app's initial bundle does not carry them.
 */
export async function composerCahierPdf(request: CahierExportRequest,
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
  const dessinerFigure = async (
    projection: CahierFigureProjection,
    x: number,
    y: number,
    width: number,
  ): Promise<void> => {
    try {
      // The same option object the pagination measured with (no second maps).
      await dessinerFigurePdf({
        ...optionsFigurePdf(request, projection),
        doc,
        mesure,
        x,
        y,
        width,
        signal,
        chargerImage,
      }, projection)
    } catch (error) {
      if (error instanceof CahierPdfAssetError) {
        throw new CahierPdfCompositionError('asset', error.message, error)
      }
      throw error
    }
  }
  const total = documentPdf.pages.length
  try {
  for (let index = 0; index < documentPdf.pages.length; index += 1) {
    verifierAbandon(signal)
    const page = documentPdf.pages[index]!
    if (index > 0) doc.addPage('a4', 'portrait')
    await dessinerEntete(doc, capture, mesure, urlAccueil, urlPublique, signal)
    const sousTitrePage = page.hasComparisonProof ? documentPdf.sousTitre : null
    const identitePage = hauteurIdentite(capture, sousTitrePage, mesure)
    const hauteurContenu = page.blocks.reduce((sum, bloc) => sum + bloc.gapAvant + bloc.height, 0)
    const hauteurSection = 2 * PAGE.paddingSection + identitePage + hauteurContenu + documentPdf.sourcesHeight
    const hauteurUtile = documentPdf.contenuBas - PAGE.contenuHaut
    const inset = Math.max(0, (hauteurUtile - hauteurSection) / 2)
    const frameTop = PAGE.contenuHaut + inset
    const frameBottom = frameTop + hauteurSection
    dessinerSurfaceSection(doc, frameTop, frameBottom)
    let cy = dessinerIdentite(
      doc,
      capture,
      sousTitrePage,
      mesure,
      frameTop + PAGE.paddingSection,
      urlPublique,
    ) + ESPACE.apresIdentite
    for (const bloc of page.blocks) {
      verifierAbandon(signal)
      cy += bloc.gapAvant
      if (bloc.kind === 'figure') {
        const start = cy
        await dessinerFigure(bloc.projection, PAGE.corpsX, cy, PAGE.largeurCorps)
        cy = start + bloc.height
      } else if (bloc.kind === 'figure-row') {
        const start = cy
        for (const cell of bloc.cells) {
          await dessinerFigure(cell.projection, cell.x, cy, cell.width)
        }
        cy = start + bloc.height
      } else if (bloc.kind === 'table') {
        const start = cy
        for (const cellule of bloc.cells) {
          dessinerTableau(
            doc,
            mesure,
            cellule.part,
            cellule.rows,
            cellule.x,
            cy,
            cellule.width,
            cellule.continued,
            page.comparaisonLignes.length,
          )
        }
        cy = start + bloc.height
      } else {
        const align = bloc.role === 'tables-heading' ? 'center' : 'left'
        const police = bloc.role === 'tables-heading' ? ROLE_PDF.titreTableau.police : ROLE_PDF.comparaisonPrefixe.police
        const taille = bloc.role === 'tables-heading' ? TAILLE.titreTableaux : TAILLE.note
        const couleur = bloc.role === 'tables-heading' ? PALETTE_PDF.ink : PALETTE_PDF.muted
        const lignes = plierTexte(bloc.text, mesure, {
          police,
          taillePt: taille,
          largeurMax: PAGE.largeurCorps,
          casserMotsLongs: true,
        })
        const start = cy
        for (const ligne of lignes) {
          texte(doc, ligne.texte, align === 'center' ? PAGE.width / 2 : PAGE.corpsX, cy, {
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
      cy + ESPACE.sourcesHaut,
      PAGE.largeurCorps,
    )
    dessinerPied(doc, mesure, index + 1, total, urlAccueil, page.hasComparisonProof, page.comparaisonLignes)
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
